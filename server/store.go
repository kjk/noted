package main

import (
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/go-redis/redis"
	"github.com/kjk/minioutil"
	"github.com/minio/minio-go/v7"
)

type UserInfo struct {
	email      string
	lastLogKey string // log-0, log-1 etc.
}

var (
	// TODO: temporary, until we have a proper user system
	userID = "kkowalczyk@gmail.com"

	userEmailToInfo = map[string]*UserInfo{}
	upstashDbURL    string
	upstashPrefix   = "" // dev: if isDev
	r2KeyPrefix     = "" // dev/ if isDev

	r2Endpoint = "71694ef61795ecbe1bc331d217dbd7a7.r2.cloudflarestorage.com"
	r2Bucket   = "files"
	r2Access   string
	r2Secret   string

	muStore sync.Mutex
)

func getUpstashClient() *redis.Client {
	opt, _ := redis.ParseURL(upstashDbURL)
	client := redis.NewClient(opt)
	return client
}

func testUpstash() {
	logf(ctx(), "testUpstash()\n")
	c := getUpstashClient()
	_, err := c.Ping().Result()
	must(err)
	logf(ctx(), "testUpstash() ok!\n")
}

func getR2Client() *minioutil.Client {
	conf := &minioutil.Config{
		Endpoint: r2Endpoint,
		Bucket:   r2Bucket,
		Access:   r2Access,
		Secret:   r2Secret,
	}
	client, err := minioutil.New(conf)
	must(err)
	return client
}

func listR2Files() {
	logf(ctx(), "listR2Files()\n")
	mc := getR2Client()
	nFiles := 0
	files := mc.ListObjects("/")
	for o := range files {
		logf(ctx(), "%s\n", o.Key)
		nFiles++
	}
	logf(ctx(), "nFiles: %d\n", nFiles)
}

func serveIfError(w http.ResponseWriter, err error) bool {
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return true
	}
	return false
}

// keys are of the form "log-1", "log-2", etc.
// TODO: verify they sort as we expect
func sortLogKeys(a []string) error {
	var err error
	sort.Slice(a, func(i, j int) bool {
		n1, err1 := strconv.Atoi(a[i][4:])
		if err1 != nil {
			err = err1
		}
		n2, err1 := strconv.Atoi(a[j][4:])
		if err1 != nil {
			err = err1
		}

		return n1 < n2
	})
	return err
}

const kMaxLogEntriesPerKey = 1024

func storeGetLogKeys() ([]string, error) {
	prefix := fmt.Sprintf("%s:%s:notes-log:log-*", upstashPrefix, userID)

	c := getUpstashClient()
	res := c.Keys(prefix)
	if res.Err() != nil {
		return nil, res.Err()
	}
	keys := res.Val()
	logf(ctx(), "storeGetLog() => %d keys for pref	ix %s\n", len(keys), prefix)
	err := sortLogKeys(keys)
	return keys, err
}

// TODO: prevent concurrent access to the same log key
func storeAppendLog(v []interface{}) error {
	keys, err := storeGetLogKeys()
	if err != nil {
		return err
	}
	key := "log-0"
	if len(keys) > 0 {
		key := keys[len(keys)-1]
		c := getUpstashClient()
		res := c.LLen(key)
		if res.Err() != nil {
			return res.Err()
		}
		if res.Val() >= kMaxLogEntriesPerKey {
			lastKeNo, err := strconv.Atoi(key[4:])
			if err != nil {
				return err
			}
			key = fmt.Sprintf("log-%d", lastKeNo+1)
		}
	}
	jsonStr, err := json.Marshal(v)
	if err != nil {
		return err
	}
	res := c.LPush(key, jsonStr)
	return res.Err()
}

func storeGetLog() ([][]interface{}, error) {
	keys, err := storeGetLogKeys()
	if err != nil {
		return nil, err
	}
	c := getUpstashClient()

	var logs [][]interface{}
	if err != nil {
		return nil, err
	}
	for _, key := range keys {
		res := c.LRange(key, 0, -1)
		if res.Err() != nil {
			return nil, res.Err()
		}
		vals := res.Val()
		for _, jsonStr := range vals {
			var v []interface{}
			err := json.Unmarshal([]byte(jsonStr), &v)
			if err != nil {
				return nil, err
			}
			logs = append(logs, v)
		}
	}
	logf(ctx(), "%d log entries for user %s\n", len(logs), userID)
	return logs, nil
}

func checkMethodPOSTorPUT(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != "POST" && r.Method != "PUT" {
		http.Error(w, "only POST and PUT supported", http.StatusBadRequest)
		return true
	}
	return false
}

func contentPut(r io.Reader) (string, error) {
	mc := getR2Client()
	id := genRandomID(12)
	key := fmt.Sprintf("%scontent/%s/%s", r2KeyPrefix, userID, id)
	opts := minio.PutObjectOptions{}
	_, err := mc.Client.PutObject(ctx(), r2Bucket, key, r, -1, opts)
	return id, err
}

func contentGet(id string) (io.ReadCloser, error) {
	mc := getR2Client()
	key := fmt.Sprintf("%scontent/%s/%s", r2KeyPrefix, userID, id)
	obj, err := mc.Client.GetObject(ctx(), r2Bucket, key, minio.GetObjectOptions{})
	return obj, err
}

func handleStore(w http.ResponseWriter, r *http.Request) {
	uri := r.URL.Path
	logf(ctx(), "handleStore: %s\n", uri)
	if uri == "/api/store/getLogs" {
		// TODO: maybe will need to paginate
		logs, err := storeGetLog()
		if serveIfError(w, err) {
			return
		}
		serveJSONOK(w, r, logs)
	} else if uri == "/api/store/getContent" {
		id := r.URL.Query().Get("id")
		if id == "" {
			http.Error(w, "id is required", http.StatusBadRequest)
			return
		}
		obj, err := contentGet(id)
		if serveIfError(w, err) {
			return
		}
		defer obj.Close()
		io.Copy(w, obj)
	} else if uri == "/api/store/appendLog" {
		defer r.Body.Close()
		if !checkMethodPOSTorPUT(w, r) {
			return
		}
		var logEntry []interface{}
		// validate log entry is proper JSON string
		err := json.NewDecoder(r.Body).Decode(&logEntry)
		if serveIfError(w, err) {
			return
		}
		err = storeAppendLog(logEntry)
		if !serveIfError(w, err) {
			res := map[string]interface{}{
				"ok": true,
			}
			serveJSONOK(w, r, res)
		}
	} else if uri == "/api/store/setContent" {
		defer r.Body.Close()
		if !checkMethodPOSTorPUT(w, r) {
			return
		}
		id, err := contentPut(r.Body)
		if !serveIfError(w, err) {
			res := map[string]interface{}{
				"id": id,
			}
			serveJSONOK(w, r, res)
		}
	} else {
		http.NotFound(w, r)
	}
}

const shortIDSymbols = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

var nShortSymbols = len(shortIDSymbols)

func genRandomID(n int) string {
	rand.Seed(time.Now().UnixNano())
	res := ""
	for i := 0; i < n; i++ {
		idx := rand.Intn(nShortSymbols)
		c := string(shortIDSymbols[idx])
		res = res + c
	}
	return res
}
