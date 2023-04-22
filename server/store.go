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
	GitHubUser
	lastLogKey string // log-0, log-1 etc.
}

var (
	ghTokenToUserInfo = map[string]*UserInfo{}
	upstashDbURL      string
	upstashPrefix     = "" // dev: if isDev
	r2KeyPrefix       = "" // dev/ if isDev

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
		logf(ctx(), "serveIfError(): %s\n", err)
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

func storeGetLogKeys(userID string) ([]string, error) {
	prefix := fmt.Sprintf("%s:%s:notes-log:log-*", upstashPrefix, userID)

	c := getUpstashClient()
	res := c.Keys(prefix)
	if res.Err() != nil {
		return nil, res.Err()
	}
	keys := res.Val()
	logf(ctx(), "storeGetLog(): %d keys for prefix %s\n", len(keys), prefix)
	err := sortLogKeys(keys)
	return keys, err
}

// TODO: prevent concurrent access to the same log key
func storeAppendLog(userID string, v []interface{}) error {
	logf(ctx(), "storeAppendLog()\n")
	keys, err := storeGetLogKeys(userID)
	if err != nil {
		return err
	}
	c := getUpstashClient()
	key := "log-0"
	if len(keys) > 0 {
		key = keys[len(keys)-1]
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
	logf(ctx(), " key: %s, v:'%s'\n", key, string(jsonStr))
	res := c.LPush(key, jsonStr)
	return res.Err()
}

func storeGetLogs(userID string) ([][]interface{}, error) {
	logf(ctx(), "storeGetLogs()\n")
	timeStart := time.Now()
	defer func() {
		logf(ctx(), "  took %s\n", time.Since(timeStart))
	}()
	keys, err := storeGetLogKeys(userID)
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
		return false
	}
	return true
}

func contentPut(userID string, r io.Reader) (string, error) {
	id := genRandomID(12)
	logf(ctx(), "contentPut() id: %s\n", id)
	timeStart := time.Now()
	defer func() {
		logf(ctx(), "  took %s\n", time.Since(timeStart))
	}()
	mc := getR2Client()
	key := fmt.Sprintf("%scontent/%s/%s", r2KeyPrefix, userID, id)
	opts := minio.PutObjectOptions{}
	_, err := mc.Client.PutObject(ctx(), r2Bucket, key, r, -1, opts)
	return id, err
}

func contentGet(userID string, contentID string) (io.ReadCloser, error) {
	logf(ctx(), "contentGet(): id: %s\n", contentID)
	timeStart := time.Now()
	defer func() {
		logf(ctx(), "  took %s\n", time.Since(timeStart))
	}()
	mc := getR2Client()
	key := fmt.Sprintf("%scontent/%s/%s", r2KeyPrefix, userID, contentID)
	obj, err := mc.Client.GetObject(ctx(), r2Bucket, key, minio.GetObjectOptions{})
	return obj, err
}

func getLoggedUser(r *http.Request) (*UserInfo, error) {
	ghToken := getGitHubTokenFromRequest(r)
	if ghToken == "" {
		return nil, fmt.Errorf("user not logged in (no GitHub token)")
	}
	muStore.Lock()
	defer muStore.Unlock()
	userInfo, ok := ghTokenToUserInfo[ghToken]
	if ok {
		return userInfo, nil
	}

	muStore.Unlock()
	_, ghUser, err := getGitHubUserInfo(ghToken)

	muStore.Lock()
	if err != nil {
		return nil, err
	}
	userInfo = &UserInfo{
		GitHubUser: *ghUser,
	}
	ghTokenToUserInfo[ghToken] = userInfo
	return userInfo, nil
}

func handleStore(w http.ResponseWriter, r *http.Request) {
	uri := r.URL.Path
	userInfo, err := getLoggedUser(r)
	if serveIfError(w, err) {
		logf(ctx(), "handleStore: %s, err: %s\n", uri, err)
		return
	}
	userID := userInfo.Email
	logf(ctx(), "handleStore: %s, userID: %s\n", uri, userID)
	if uri == "/api/store/getLogs" {
		// TODO: maybe will need to paginate
		logs, err := storeGetLogs(userID)
		if serveIfError(w, err) {
			return
		}
		serveJSONOK(w, r, logs)
		return
	}

	if uri == "/api/store/appendLog" {
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
		err = storeAppendLog(userID, logEntry)
		if !serveIfError(w, err) {
			res := map[string]interface{}{
				"ok": true,
			}
			serveJSONOK(w, r, res)
		}
		return
	}

	if uri == "/api/store/getContent" {
		id := r.URL.Query().Get("id")
		if id == "" {
			http.Error(w, "id is required", http.StatusBadRequest)
			return
		}
		obj, err := contentGet(userID, id)
		if serveIfError(w, err) {
			return
		}
		defer obj.Close()
		io.Copy(w, obj)
		return
	}

	if uri == "/api/store/setContent" {
		defer r.Body.Close()
		if !checkMethodPOSTorPUT(w, r) {
			return
		}
		id, err := contentPut(userID, r.Body)
		if !serveIfError(w, err) {
			res := map[string]interface{}{
				"id": id,
			}
			serveJSONOK(w, r, res)
		}
		return
	}

	http.NotFound(w, r)
}

const shortIDSymbols = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

var nShortSymbols = len(shortIDSymbols)

func genRandomID(n int) string {
	rnd := rand.New(rand.NewSource(time.Now().UnixNano()))
	res := ""
	for i := 0; i < n; i++ {
		idx := rnd.Intn(nShortSymbols)
		c := string(shortIDSymbols[idx])
		res = res + c
	}
	return res
}
