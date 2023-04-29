package main

import (
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
	"math/rand"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-redis/redis"
	"github.com/kjk/minioutil"
	"github.com/minio/minio-go/v7"
)

type UserInfo struct {
	User       string
	Email      string
	lastLogKey string // log-0, log-1 etc.
}

var (
	emailToUserInfo = map[string]*UserInfo{}
	upstashDbURL    string
	upstashPrefix   = "" // dev: if isDev
	r2KeyPrefix     = "" // dev/ if isDev

	r2Endpoint = "71694ef61795ecbe1bc331d217dbd7a7.r2.cloudflarestorage.com"
	r2Bucket   = "noted"
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
		logErrorf(ctx(), "serveIfError(): %s\n", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return true
	}
	return false
}

func serveError(w http.ResponseWriter, s string, code int) {
	logErrorf(ctx(), "%s\n", s)
	http.Error(w, s, code)
}

func getLogKeyNo(s string) (int, error) {
	idx := strings.LastIndex(s, "-")
	if idx == -1 {
		return 0, fmt.Errorf("getLogKeyNo() failed to parse '%s'", s)
	}
	return strconv.Atoi(s[idx+1:])
}

// keys are of the form "log-1", "log-2", etc.
// TODO: verify they sort as we expect
func sortLogKeys(a []string) error {
	var err error
	sort.Slice(a, func(i, j int) bool {
		n1, err1 := getLogKeyNo(a[i])
		if err1 != nil {
			err = err1
		}
		n2, err1 := getLogKeyNo(a[j])
		if err1 != nil {
			err = err1
		}

		return n1 < n2
	})
	return err
}

const kMaxLogEntriesPerKey = 1024

func mkLogKey(userID string, n int) string {
	return fmt.Sprintf("%s%s:notes-log:log-%d", upstashPrefix, userID, n)
}

func mkLogKeyPrefix(userID string) string {
	return fmt.Sprintf("%s%s:notes-log:log-*", upstashPrefix, userID)
}

func storeGetLogSortedKeys(userID string) ([]string, error) {
	timeStart := time.Now()
	prefix := mkLogKeyPrefix(userID)

	c := getUpstashClient()
	res := c.Keys(prefix)
	if res.Err() != nil {
		logf(ctx(), "storeGetLogKeys(): failed with '%s'\n", res.Err())
		return nil, res.Err()
	}
	keys := res.Val()
	err := sortLogKeys(keys)
	logf(ctx(), "storeGetLog(): %d keys for prefix %s, keys: %v, took %s\n", len(keys), prefix, keys, time.Since(timeStart))
	return keys, err
}

// TODO: prevent concurrent access to the same log key
func storeAppendLog(userID string, v []interface{}) error {
	logf(ctx(), "storeAppendLog()\n")
	keys, err := storeGetLogSortedKeys(userID)
	if err != nil {
		return err
	}
	c := getUpstashClient()
	key := mkLogKey(userID, 0)
	if len(keys) > 0 {
		key = keys[len(keys)-1]
		res := c.LLen(key)
		if res.Err() != nil {
			return res.Err()
		}
		if res.Val() >= kMaxLogEntriesPerKey {
			lastKeyNo, err := getLogKeyNo(key)
			if err != nil {
				return err
			}
			key = mkLogKey(userID, lastKeyNo+1)
		}
	}
	jsonStr, err := json.Marshal(v)
	if err != nil {
		logf(ctx(), "storeAppendLog(): failed to marshal '%#v', err: %s\n", v, err)
		return err
	}
	logf(ctx(), " key: %s, v:'%s'\n", key, string(jsonStr))
	res := c.RPush(key, jsonStr)
	return res.Err()
}

func storeGetLogs(userID string, start int) ([][]interface{}, error) {
	if start < 0 {
		start = 0
	}
	logf(ctx(), "storeGetLogs(): userID: '%s', start: %d\n", userID, start)
	timeStart := time.Now()
	defer func() {
		logf(ctx(), "  took %s\n", time.Since(timeStart))
	}()
	keys, err := storeGetLogSortedKeys(userID)
	if err != nil {
		return nil, err
	}
	c := getUpstashClient()

	logs := make([][]interface{}, 0)
	if err != nil {
		return nil, err
	}
	for _, key := range keys {
		if start > 0 {
			// TODO: do pipelining. ideally do lua script that returns
			// keys and their lengths in one go, to reduce latency
			timeStart := time.Now()
			nValsRes := c.LLen(key)
			logf(ctx(), "  LLen for '%s' took %s\n", key, time.Since(timeStart))
			if nValsRes.Err() != nil {
				return nil, nValsRes.Err()
			}
			nVals := int(nValsRes.Val())
			logf(ctx(), "  key: %s, nVals: %d, start: %d\n", key, nVals, start)
			if start >= nVals {
				start -= nVals
				continue
			}
		}

		timeStart := time.Now()
		res := c.LRange(key, 0, -1)
		logf(ctx(), "  LRange for '%s' took %s\n", key, time.Since(timeStart))
		if res.Err() != nil {
			return nil, res.Err()
		}
		vals := res.Val()
		for i, jsonStr := range vals {
			if i < start {
				continue
			}
			var v []interface{}
			err := json.Unmarshal([]byte(jsonStr), &v)
			if err != nil {
				return nil, err
			}
			logs = append(logs, v)
		}
		start = 0
	}
	logf(ctx(), "%d log entries for user %s\n", len(logs), userID)
	return logs, nil
}

func checkMethodPOSTorPUT(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != "POST" && r.Method != "PUT" {
		serveError(w, "only POST and PUT supported", http.StatusBadRequest)
		return false
	}
	return true
}

func mkContentKey(userID string, contentID string) string {
	return fmt.Sprintf("%scontent/%s/%s", r2KeyPrefix, userID, contentID)
}

func contentPut(userID string, contentID string, r io.Reader) error {
	key := mkContentKey(userID, contentID)
	logf(ctx(), "contentPut() id: %s, key: %s\n", contentID, key)
	// Note: tried to PustObject(r) but the way minio client does multi-part
	// uploads is not compatible with r2
	d, err := ioutil.ReadAll(r)
	if err != nil {
		return err
	}
	timeStart := time.Now()
	defer func() {
		logf(ctx(), "  took %s\n", time.Since(timeStart))
	}()
	mc := getR2Client()
	_, err = mc.UploadData(key, d, false)
	return err
}

func contentGet(userID string, contentID string) (io.ReadCloser, error) {
	key := mkContentKey(userID, contentID)
	logf(ctx(), "contentGet(): id: %s, key: %s\n", contentID, key)
	timeStart := time.Now()
	defer func() {
		logf(ctx(), "  took %s\n", time.Since(timeStart))
	}()
	mc := getR2Client()
	obj, err := mc.Client.GetObject(ctx(), r2Bucket, key, minio.GetObjectOptions{})
	return obj, err
}

func getLoggedUser(r *http.Request, w http.ResponseWriter) (*UserInfo, error) {
	cookie := getSecureCookie(r)
	if cookie == nil || cookie.Email == "" {
		return nil, fmt.Errorf("user not logged in (no cookie)")
	}
	email := cookie.Email
	muStore.Lock()
	defer muStore.Unlock()

	userInfo, ok := emailToUserInfo[email]
	if !ok {
		userInfo = &UserInfo{
			Email: cookie.Email,
			User:  cookie.User,
		}
		emailToUserInfo[email] = userInfo
	}
	return userInfo, nil
}

func handleStore(w http.ResponseWriter, r *http.Request) {
	uri := r.URL.Path
	userInfo, err := getLoggedUser(r, w)
	if serveIfError(w, err) {
		logf(ctx(), "handleStore: %s, err: %s\n", uri, err)
		return
	}
	userID := userInfo.Email
	logf(ctx(), "handleStore: %s, userID: %s\n", uri, userID)
	if uri == "/api/store/getLogs" {
		// TODO: maybe will need to paginate
		startStr := r.URL.Query().Get("start")
		start, err := strconv.Atoi(startStr)
		if err != nil {
			start = 0
		}
		logs, err := storeGetLogs(userID, start)
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
			serveError(w, "id is required", http.StatusBadRequest)
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
		contentID := r.URL.Query().Get("id")
		if len(contentID) < 6 {
			serveError(w, "id must be at least 6 chars", http.StatusBadRequest)
		}
		err = contentPut(userID, contentID, r.Body)
		if !serveIfError(w, err) {
			res := map[string]interface{}{}
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
