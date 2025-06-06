package main

import (
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-redis/redis"
	"github.com/kjk/common/appendstore"
)

type UserInfo struct {
	User  string
	Email string
	Store *appendstore.Store
}

var (
	users         []*UserInfo
	upstashDbURL  string
	upstashPrefix = "" // dev: if isDev

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

func contentPut(userEmail string, contentID string, r io.Reader) error {
	// Note: tried to PustObject(r) but the way minio client does multi-part
	// uploads is not compatible with r2
	d, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	timeStart := time.Now()
	defer func() {
		logf(ctx(), "  took %s\n", time.Since(timeStart))
	}()
	getContent := func(u *UserInfo, i int) error {
		if u == nil {
			return fmt.Errorf("user not found for email %s", userEmail)
		}
		// TODO: have a mutex per user to make this faster
		_, err := u.Store.AppendRecord("content", d, contentID)
		return err
	}
	err = findUserByEmailLocked(userEmail, getContent)
	return err
}

func contentGet(userEmail string, contentID string) ([]byte, error) {
	timeStart := time.Now()
	defer func() {
		logf(ctx(), "  took %s\n", time.Since(timeStart))
	}()
	var content []byte
	getContent := func(u *UserInfo, i int) error {
		if u == nil {
			return fmt.Errorf("user not found for email %s", userEmail)
		}
		// TODO: have a mutex per user to make this faster
		for _, rec := range u.Store.Records {
			if rec.Kind == "content" && rec.Meta == contentID {
				var err error
				content, err = u.Store.ReadRecord(&rec)
				return err
			}
		}
		return fmt.Errorf("content not found for user %s, contentID %s", userEmail, contentID)
	}
	err := findUserByEmailLocked(userEmail, getContent)
	return content, err
}

func getLoggedUser(r *http.Request, w http.ResponseWriter) (*UserInfo, error) {
	cookie := getSecureCookie(r)
	if cookie == nil || cookie.Email == "" {
		return nil, fmt.Errorf("user not logged in (no cookie)")
	}
	email := cookie.Email
	var userInfo *UserInfo
	getOrCreateUser := func(u *UserInfo, i int) error {
		if u == nil {
			userInfo = &UserInfo{
				Email: cookie.Email,
				User:  cookie.User,
			}

			dataDir := getDataDirMust()
			// TODO: must escape email to avoid chars not allowed in file names
			dataDir = filepath.Join(dataDir, email)
			userInfo.Store = &appendstore.Store{
				DataDir:       dataDir,
				IndexFileName: "index.txt",
				DataFileName:  "data.bin",
			}
			err := appendstore.OpenStore(userInfo.Store)
			if err != nil {
				logf(ctx(), "getLoggedUser(): failed to open store for user %s, err: %s\n", email, err)
				return err
			}
			users = append(users, userInfo)
			return nil
		}

		userInfo = u
		return nil
	}
	findUserByEmailLocked(email, getOrCreateUser)
	return userInfo, nil
}

func handleStore(w http.ResponseWriter, r *http.Request) {
	uri := r.URL.Path
	userInfo, err := getLoggedUser(r, w)
	if serveIfError(w, err) {
		logf(ctx(), "handleStore: %s, err: %s\n", uri, err)
		return
	}
	userEmail := userInfo.Email
	logf(ctx(), "handleStore: %s, userEmail: %s\n", uri, userEmail)
	if uri == "/api/store/getLogs" {
		// TODO: maybe will need to paginate
		startStr := r.URL.Query().Get("start")
		start, err := strconv.Atoi(startStr)
		if err != nil {
			start = 0
		}
		logs, err := storeGetLogs(userEmail, start)
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
		err = storeAppendLog(userEmail, logEntry)
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
		data, err := contentGet(userEmail, id)
		if serveIfError(w, err) {
			return
		}
		w.Write(data)
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
		err = contentPut(userEmail, contentID, r.Body)
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
