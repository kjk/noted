package main

import (
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/kjk/common/appendstore"
)

type UserInfo struct {
	User  string
	Email string
	Store *appendstore.Store
	mu    sync.Mutex // protects Store
}

var (
	users []*UserInfo

	muStore sync.Mutex
)

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

func storeAppendLog(userEmail string, v []interface{}) error {
	logf(ctx(), "storeAppendLog()\n")
	jsonStr, err := json.Marshal(v)
	if err != nil {
		logf(ctx(), "storeAppendLog(): failed to marshal '%#v', err: %s\n", v, err)
		return err
	}

	u := findUserByEmail(userEmail)
	if u == nil {
		return fmt.Errorf("user not found for email %s", userEmail)
	}

	u.mu.Lock()
	defer u.mu.Unlock()
	_, err = u.Store.AppendRecord("log", jsonStr, "")
	return err
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
	u := findUserByEmail(userID)
	if u == nil {
		return nil, fmt.Errorf("user not found for email %s", userID)
	}
	u.mu.Lock()
	defer u.mu.Unlock()

	logs := make([][]interface{}, 0)
	n := -1
	for _, rec := range u.Store.Records {
		if rec.Kind != "log" {
			continue
		}
		n++
		if n < start {
			continue
		}
		d, err := u.Store.ReadRecord(&rec)
		if err != nil {
			return nil, fmt.Errorf("failed to read record %s: %w", rec.Meta, err)
		}
		var v []interface{}
		err = json.Unmarshal(d, &v)
		if err != nil {
			return nil, err
		}
		logs = append(logs, v)
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

	u := findUserByEmail(userEmail)
	if u == nil {
		return fmt.Errorf("user not found for email %s", userEmail)
	}
	u.mu.Lock()
	defer u.mu.Unlock()
	_, err = u.Store.AppendRecord("content", d, contentID)
	return err
}

func contentGet(userEmail string, contentID string) ([]byte, error) {
	timeStart := time.Now()
	defer func() {
		logf(ctx(), "  took %s\n", time.Since(timeStart))
	}()

	u := findUserByEmail(userEmail)
	if u == nil {
		return nil, fmt.Errorf("user not found for email %s", userEmail)
	}
	u.mu.Lock()
	defer u.mu.Unlock()
	for _, rec := range u.Store.Records {
		if rec.Kind == "content" && rec.Meta == contentID {
			return u.Store.ReadRecord(&rec)
		}
	}
	return nil, fmt.Errorf("content not found for user %s, contentID %s", userEmail, contentID)
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
