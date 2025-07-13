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
}

var (
	users []*UserInfo

	muStore sync.Mutex
)

func serveIfError(w http.ResponseWriter, err error) bool {
	if err == nil {
		return false
	}
	logErrorf("serveIfError(): %s\n", err)
	http.Error(w, err.Error(), http.StatusInternalServerError)
	return true
}

func serveError(w http.ResponseWriter, s string, code int) {
	logErrorf("%s\n", s)
	http.Error(w, s, code)
}

func storeAppendLog(u *UserInfo, v []interface{}) error {
	logf("storeAppendLog()\n")
	jsonStr, err := json.Marshal(v)
	if err != nil {
		logf("storeAppendLog(): failed to marshal '%#v', err: %s\n", v, err)
		return err
	}

	_, err = u.Store.AppendRecord("log", jsonStr, "")
	return err
}

func storeGetLogs(u *UserInfo, start int) ([][]interface{}, error) {
	if start < 0 {
		start = 0
	}
	logf("storeGetLogs(): userEmail: '%s', start: %d\n", u.Email, start)
	timeStart := time.Now()
	defer func() {
		logf("  took %s\n", time.Since(timeStart))
	}()

	logs := make([][]interface{}, 0)
	n := -1
	recs := u.Store.Records()
	for _, rec := range recs {
		if rec.Kind != "log" {
			continue
		}
		n++
		if n < start {
			continue
		}
		d, err := u.Store.ReadRecord(rec)
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
	logf("%d log entries for user %s\n", len(logs), u.Email)
	return logs, nil
}

func checkMethodPOSTorPUT(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != "POST" && r.Method != "PUT" {
		serveError(w, "only POST and PUT supported", http.StatusBadRequest)
		return false
	}
	return true
}

func contentPut(u *UserInfo, contentID string, r io.Reader) error {
	// Note: tried to PustObject(r) but the way minio client does multi-part
	// uploads is not compatible with r2
	d, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	timeStart := time.Now()
	defer func() {
		logf("  took %s\n", time.Since(timeStart))
	}()

	_, err = u.Store.AppendRecord("content", d, contentID)
	return err
}

func contentGet(u *UserInfo, contentID string) ([]byte, error) {
	timeStart := time.Now()
	defer func() {
		logf("  took %s\n", time.Since(timeStart))
	}()

	recs := u.Store.Records()
	for _, rec := range recs {
		if rec.Kind == "content" && rec.Meta == contentID {
			return u.Store.ReadRecord(rec)
		}
	}
	return nil, fmt.Errorf("content not found for user %s, contentID %s", u.Email, contentID)
}

func getLoggedUser(r *http.Request, w http.ResponseWriter) (*UserInfo, error) {
	cookie := getSecureCookie(r)
	if cookie == nil || cookie.Email == "" {
		return nil, fmt.Errorf("user not logged in (no cookie)")
	}
	email := cookie.Email
	var u *UserInfo

	getOrCreateUser := func(u *UserInfo, i int) error {
		if u != nil {
			return nil
		}
		u = &UserInfo{
			Email: cookie.Email,
			User:  cookie.User,
		}

		dataDir := getDataDirMust()
		// TODO: must escape email to avoid chars not allowed in file names
		dataDir = filepath.Join(dataDir, email)
		u.Store = &appendstore.Store{
			DataDir:       dataDir,
			IndexFileName: "index.txt",
			DataFileName:  "data.bin",
		}
		err := appendstore.OpenStore(u.Store)
		if err != nil {
			logf("getLoggedUser(): failed to open store for user %s, err: %s\n", email, err)
			return err
		}
		users = append(users, u)
		return nil
	}

	findUserByEmailLocked(email, getOrCreateUser)
	return u, nil
}

func handleStore(w http.ResponseWriter, r *http.Request) {
	uri := r.URL.Path
	u, err := getLoggedUser(r, w)
	if serveIfError(w, err) {
		logf("handleStore: %s, err: %s\n", uri, err)
		return
	}
	userEmail := u.Email
	logf("handleStore: %s, userEmail: %s\n", uri, userEmail)

	if uri == "/api/store/getLogs" {
		// TODO: maybe will need to paginate
		startStr := r.URL.Query().Get("start")
		start, err := strconv.Atoi(startStr)
		if err != nil {
			start = 0
		}
		logs, err := storeGetLogs(u, start)
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
		err = storeAppendLog(u, logEntry)
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
		data, err := contentGet(u, id)
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
		err = contentPut(u, contentID, r.Body)
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
