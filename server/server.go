package main

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/felixge/httpsnoop"
	"github.com/gorilla/securecookie"
	hutil "github.com/kjk/common/httputil"
	"github.com/sanity-io/litter"

	"github.com/kjk/common/u"
	"golang.org/x/exp/slices"
)

var (
	cookieName   = "nckie" // noted cookie
	secureCookie *securecookie.SecureCookie

	cookieAuthKeyHexStr = "81615f1aed7f857b4cb9c539acb5f9b5a88c9d6c4e87a4141079490773d17f5b"
	cookieEncrKeyHexStr = "00db6337a267be94a44813335bf3bd9e35868875b896fbe3758e613fbb8ec8d4"

	proxyURLStr = "http://localhost:3047"
	// maps ouath secret to login info
	loginsInProress = map[string]string{}
)

func makeSecureCookie() {
	cookieAuthKey, err := hex.DecodeString(cookieAuthKeyHexStr)
	panicIfErr(err)
	cookieEncrKey, err := hex.DecodeString(cookieEncrKeyHexStr)
	panicIfErr(err)
	secureCookie = securecookie.New(cookieAuthKey, cookieEncrKey)
}

func getGitHubSecrets() (string, string) {
	if isDev() {
		return "8adf394a86b4daa3fef8", secretGitHub
	}
	return "8ded4c0d72d9c14a388e", secretGitHub
}

type SecureCookieValue struct {
	User      string // "kjk"
	Email     string // "kkowalczyk@gmail.com"
	Name      string // Krzysztof Kowalczyk
	AvatarURL string
}

func setSecureCookie(w http.ResponseWriter, c *SecureCookieValue) {
	panicIf(c.User == "", "setSecureCookie: empty user")
	panicIf(c.Email == "", "setSecureCookie: empty email")

	logf("setSecureCookie: user: '%s', email: '%s'\n", c.User, c.Email)
	if encoded, err := secureCookie.Encode(cookieName, c); err == nil {
		// TODO: set expiration (Expires    time.Time) long time in the future?
		cookie := &http.Cookie{
			Name:  cookieName,
			Value: encoded,
			Path:  "/",
		}
		http.SetCookie(w, cookie)
	} else {
		panicIfErr(err)
	}
}

// TODO: make it even longer?
const MonthInSeconds = 60 * 60 * 24 * 31

// to delete the cookie value (e.g. for logging out), we need to set an
// invalid value
func deleteSecureCookie(w http.ResponseWriter) {
	cookie := &http.Cookie{
		Name:   cookieName,
		Value:  "deleted",
		MaxAge: MonthInSeconds,
		Path:   "/",
	}
	http.SetCookie(w, cookie)
}

func getSecureCookie(r *http.Request) *SecureCookieValue {
	var ret SecureCookieValue
	cookie, err := r.Cookie(cookieName)
	if err != nil {
		return nil
	}
	// detect a deleted cookie
	if cookie.Value == "deleted" {
		return nil
	}
	err = secureCookie.Decode(cookieName, cookie.Value, &ret)
	if err != nil {
		// most likely expired cookie, so ignore. Ideally should delete the
		// cookie, but that requires access to http.ResponseWriter, so not
		// convenient for us
		return nil
	}
	panicIf(ret.User == "", "getSecureCookie: empty user")
	panicIf(ret.Email == "", "getSecureCookie: empty email")
	return &ret
}

var (
	pongTxt = []byte("pong")
)

func logLogin(ctx context.Context, r *http.Request, user *GitHubUser) {
	if user == nil || isDev() {
		return
	}
}

func httpScheme(r *http.Request) string {
	isLocal := strings.HasPrefix(r.Host, "localhost") || strings.HasPrefix(r.Host, "127.0.0.1")
	if isLocal {
		return "http://"
	}
	return "https://"
}

// /auth/ghlogin
func handleLoginGitHub(w http.ResponseWriter, r *http.Request) {
	redirectURL := strings.TrimSpace(r.FormValue("redirect"))
	if redirectURL == "" {
		redirectURL = "/"
	}
	logf("handleLoginGitHub: '%s', redirect: '%s'\n", r.RequestURI, redirectURL)
	clientID, _ := getGitHubSecrets()

	// secret value passed to auth server and then back to us
	state := genRandomID(8)
	muStore.Lock()
	loginsInProress[state] = redirectURL
	muStore.Unlock()

	cb := httpScheme(r) + r.Host + "/auth/githubcb"
	logf("handleLogin: cb='%s'\n", cb)

	vals := url.Values{}
	vals.Add("client_id", clientID)
	vals.Add("scope", "read:user")
	vals.Add("state", state)
	vals.Add("redirect_uri", cb)

	authURL := "https://github.com/login/oauth/authorize?" + vals.Encode()
	logf("handleLogin: doing auth 302 redirect to '%s'\n", authURL)
	http.Redirect(w, r, authURL, http.StatusFound) // 302
}

// use if fn() needs to modify users slice under lock
func doUserOpByEmail(email string, fn func(*UserInfo, int) error) error {
	muStore.Lock()
	defer muStore.Unlock()

	for i, u := range users {
		if u.Email == email {
			return fn(u, i)
		}
	}
	return fn(nil, -1)
}

// /auth/ghlogout
func handleLogoutGitHub(w http.ResponseWriter, r *http.Request) {
	logf("handleLogoutGitHub()\n")
	cookie := getSecureCookie(r)
	if cookie == nil {
		logf("handleLogoutGitHub: already logged out\n")
		http.Redirect(w, r, "/", http.StatusFound) // 302
		return
	}
	email := cookie.Email
	deleteSecureCookie(w)

	removeUserFn := func(u *UserInfo, i int) error {
		if i >= 0 {
			users = append(users[:i], users[i+1:]...)
		}
		return nil
	}
	doUserOpByEmail(email, removeUserFn)
	http.Redirect(w, r, "/", http.StatusFound) // 302
}

const errorURL = "/github_login_failed"

// /auth/user
// returns JSON with user info in the body
func handleAuthUser(w http.ResponseWriter, r *http.Request) {
	logf("handleAuthUser: '%s'\n", r.URL)
	v := map[string]interface{}{}
	cookie := getSecureCookie(r)
	if cookie == nil {
		v["error"] = "not logged in"
		logf("handleAuthUser: not logged in\n")
	} else {
		v["user"] = cookie.User
		v["login"] = cookie.User
		v["email"] = cookie.Email
		v["avatar_url"] = cookie.AvatarURL
		logf("handleAuthUser: logged in as '%s', '%s'\n", cookie.User, cookie.Email)
	}
	serveJSONOK(w, r, v)
}

// /auth/githubcb
// as set in:
// https://github.com/settings/applications/2175661
// https://github.com/settings/applications/2175803
func handleGithubCallback(w http.ResponseWriter, r *http.Request) {
	logf("handleGithubCallback: '%s'\n", r.URL)
	state := r.FormValue("state")
	redirectURL := loginsInProress[state]
	if redirectURL == "" {
		logErrorf("invalid oauth state, no redirect for state '%s'\n", state)
		uri := "/github_login_failed?err=" + url.QueryEscape("invalid oauth state")
		http.Redirect(w, r, uri, http.StatusTemporaryRedirect)
		return
	}

	// https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#2-users-are-redirected-back-to-your-site-by-github
	code := r.FormValue("code")
	vals := url.Values{}
	clientId, clientSecret := getGitHubSecrets()
	vals.Add("client_id", clientId)
	vals.Add("client_secret", clientSecret)
	vals.Add("code", code)
	// redirectURL := httpScheme(r) + r.Host + "/oauthgithubcb2"
	// vals.Add("redirect_uri", redirectURL)
	uri := "https://github.com/login/oauth/access_token?" + vals.Encode()
	hdrs := map[string]string{
		"Accept": "application/json",
	}
	resp, err := postWithHeaders(uri, hdrs)
	if err != nil {
		logf("http.Post() failed with '%s'\n", err)
		// logForm(r)
		http.Redirect(w, r, errorURL+"?error="+url.QueryEscape(err.Error()), http.StatusTemporaryRedirect)
		return
	}
	var m map[string]interface{}
	err = json.NewDecoder(resp.Body).Decode(&m)
	if err != nil {
		logf("json.NewDecoder() failed with '%s'\n", err)
		// logForm(r)
		http.Redirect(w, r, errorURL+"?error="+url.QueryEscape(err.Error()), http.StatusTemporaryRedirect)
	}

	errorStr := mapStr(m, "error")
	if errorStr != "" {
		http.Redirect(w, r, errorURL+"?error="+url.QueryEscape(errorStr), http.StatusTemporaryRedirect)
		return
	}

	access_token := mapStr(m, "access_token")
	token_type := mapStr(m, "token_type")
	scope := mapStr(m, "scope")

	logf("access_token: %s, token_type: %s, scope: %s\n", access_token, token_type, scope)

	_, i, err := getGitHubUserInfo(access_token)
	if err != nil {
		logf("getGitHubUserInfo() failed with '%s'\n", err)
		http.Redirect(w, r, errorURL+"?error="+url.QueryEscape(err.Error()), http.StatusTemporaryRedirect)
		return
	}
	litter.Dump(i)
	cookie := &SecureCookieValue{}
	cookie.User = i.Login
	cookie.Email = i.Email
	cookie.Name = i.Name
	cookie.AvatarURL = i.AvatarURL
	litter.Dump(cookie)
	logf("github user: '%s', email: '%s'\n", cookie.User, cookie.Email)
	setSecureCookie(w, cookie)
	logf("handleOauthGitHubCallback: redirect: '%s'\n", redirectURL)
	http.Redirect(w, r, redirectURL, http.StatusTemporaryRedirect)

	// can't put in the background because that cancels ctx
	logLogin(ctx(), r, i)
}

func mapStr(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func postWithHeaders(uri string, hdrs map[string]string) (*http.Response, error) {
	req, err := http.NewRequest("POST", uri, nil)
	if err != nil {
		return nil, err
	}
	for k, v := range hdrs {
		req.Header.Add(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	return resp, err
}

func read404(fsys fs.FS) []byte {
	d, err := fs.ReadFile(fsys, "404.html")
	must(err)
	return d
}

// log event
// /event/${name}
// body is JSON with metadata for POST / PUT or ?foo=bar keys
// if duration is included, it's dur field in metadata
func handleEvent(w http.ResponseWriter, r *http.Request) {
	uri := r.URL.Path
	name := strings.TrimPrefix(uri, "/event/")
	if name == "" {
		logErrorf("/event/ has no name\n")
		http.NotFound(w, r)
		return
	}

	//durMs := 0
	meta := map[string]string{}
	logKV := func(k, v string) {
		if k == "dur" {
			//durMs, _ = strconv.Atoi(v)
			return
		}
		if v != "" {
			meta[k] = v
		}
	}

	if r.Method == http.MethodPost || r.Method == http.MethodPut {
		var m map[string]interface{}
		dec := json.NewDecoder(r.Body)
		err := dec.Decode(&meta)
		if err != nil {
			// ignore but log
			logErrorf("dec.Decode() failed with '%s'\n", err)
		} else {
			for k, v := range m {
				vs := fmt.Sprintf("%s", v)
				logKV(k, vs)
			}
		}
	}
	vals := r.Form
	for k := range vals {
		v := vals.Get(k)
		logKV(k, v)
	}

	// TODO: send event
	content := bytes.NewReader([]byte("ok"))
	http.ServeContent(w, r, "foo.txt", time.Time{}, content)
}

// in dev, proxyHandler redirects assets to vite web server
// in prod, assets must be pre-built in web/dist directory
func makeHTTPServer(proxyHandler *httputil.ReverseProxy, fsys fs.FS) *http.Server {
	makeSecureCookie()

	mainHandler := func(w http.ResponseWriter, r *http.Request) {

		tryServeRedirect := func(uri string) bool {
			if uri == "/home" {
				http.Redirect(w, r, "/", http.StatusPermanentRedirect)
				return true
			}
			return false
		}
		uri := r.URL.Path

		switch uri {
		case "/ping", "/ping.txt":
			content := bytes.NewReader(pongTxt)
			http.ServeContent(w, r, "foo.txt", time.Time{}, content)
			return
		case "/auth/ghlogin":
			handleLoginGitHub(w, r)
			return
		case "/auth/ghlogout":
			handleLogoutGitHub(w, r)
			return
		case "/auth/githubcb":
			handleGithubCallback(w, r)
			return
		case "/auth/user":
			handleAuthUser(w, r)
			return
		}

		if strings.HasPrefix(uri, "/event/") {
			handleEvent(w, r)
			return
		}

		if strings.HasPrefix(uri, "/api/store/") {
			handleStore(w, r)
			return
		}

		if tryServeRedirect(uri) {
			return
		}

		if proxyHandler != nil {
			transformRequestForProxy := func() {
				uris := []string{}
				shouldProxyURI := slices.Contains(uris, uri)
				if !shouldProxyURI {
					return
				}
				newPath := uri + ".html"
				newURI := strings.Replace(r.URL.String(), uri, newPath, 1)
				var err error
				r.URL, err = url.Parse(newURI)
				must(err)
			}

			transformRequestForProxy()
			proxyHandler.ServeHTTP(w, r)
			return
		} else {
			// those are actually index.html to change r.URL
			// to force that codepath
			uris := []string{"/github_login_failed"}
			if slices.Contains(uris, uri) || strings.HasPrefix(uri, "/n/") {
				var err error
				r.URL, err = url.Parse("/")
				must(err)
			}
		}

		opts := hutil.ServeFileOptions{
			FS:               fsys,
			SupportCleanURLS: true,
			ForceCleanURLS:   true,
			ServeCompressed:  false,
		}
		if hutil.TryServeURLFromFS(w, r, &opts) {
			return
		}

		w.Header().Set("Content-Type", "text/html")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		d := read404(fsys)
		w.WriteHeader(http.StatusNotFound)
		w.Write(d)
	}

	handlerWithMetrics := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		m := httpsnoop.CaptureMetrics(http.HandlerFunc(mainHandler), w, r)
		defer func() {
			if p := recover(); p != nil {
				logf("handlerWithMetrics: panicked with with %v\n", p)
				errStr := fmt.Sprintf("Error: %v", p)
				serveError(w, errStr, http.StatusInternalServerError)
				return
			}
			if isDev() {
				return
			}
			logHTTPReq(r, m.Code, m.Written, m.Duration)
		}()
	})

	httpSrv := &http.Server{
		ReadTimeout:  120 * time.Second,
		WriteTimeout: 120 * time.Second,
		IdleTimeout:  120 * time.Second,
		Handler:      http.HandlerFunc(handlerWithMetrics),
	}
	httpAddr := fmt.Sprintf(":%d", httpPort)
	if isDev() || isWinOrMac() {
		httpAddr = "localhost" + httpAddr
	}
	httpSrv.Addr = httpAddr
	return httpSrv
}

func runServerProd() {
	var fsys fs.FS
	fromZip := len(frontendZipData) > 0
	if fromZip {
		var err error
		fsys, err = u.NewMemoryFSForZipData(frontendZipData)
		must(err)
		sizeStr := u.FormatSize(int64(len(frontendZipData)))
		logf("runServerProd(): will serve files from embedded zip of size '%v'\n", sizeStr)
	} else {
		panicIf(isLinux(), "if running on Linux, must use frontendZipDataa")
		rebuildFrontend()
		panicIf(!u.DirExists(frontEndBuildDir), "dir '%s' doesn't exist", frontEndBuildDir)
		fsys = os.DirFS(frontEndBuildDir)
	}

	httpSrv := makeHTTPServer(nil, fsys)
	logf("runServerProd(): starting on 'http://%s', dev: %v\n", httpSrv.Addr, isDev())
	waitFn := serverListenAndWait(httpSrv)
	if isWinOrMac() {
		time.Sleep(time.Second * 2)
		u.OpenBrowser("http://" + httpSrv.Addr)
	}
	waitFn()
}

func runServerDev() {
	rebuildFrontend()

	killBun, err := startLoggedInDir("frontend", "bun", "run", "dev")
	must(err)
	defer killBun()

	// must be same as vite.config.js
	proxyURL, err := url.Parse(proxyURLStr)
	must(err)
	proxyHandler := httputil.NewSingleHostReverseProxy(proxyURL)

	fsys := os.DirFS(frontEndBuildDir)
	httpSrv := makeHTTPServer(proxyHandler, fsys)

	//closeHTTPLog := OpenHTTPLog("noted")
	//defer closeHTTPLog()

	logf("runServerDev(): starting on '%s', dev: %v\n", httpSrv.Addr, isDev())
	waitFn := serverListenAndWait(httpSrv)
	if isWinOrMac() && !flgNoBrowserOpen {
		time.Sleep(time.Second * 2)
		u.OpenBrowser("http://" + httpSrv.Addr)
	}
	waitFn()
}

func serverListenAndWait(httpSrv *http.Server) func() {
	chServerClosed := make(chan bool, 1)
	go func() {
		err := httpSrv.ListenAndServe()
		// mute error caused by Shutdown()
		if err == http.ErrServerClosed {
			err = nil
		}
		if err == nil {
			logf("HTTP server shutdown gracefully\n")
		} else {
			logf("httpSrv.ListenAndServe error '%s'\n", err)
		}
		chServerClosed <- true
	}()

	return func() {
		// Ctrl-C sends SIGINT
		sctx, stop := signal.NotifyContext(ctx(), os.Interrupt /*SIGINT*/, os.Kill /* SIGKILL */, syscall.SIGTERM)
		defer stop()
		<-sctx.Done()

		logf("Got one of the signals. Shutting down http server\n")
		_ = httpSrv.Shutdown(ctx())
		select {
		case <-chServerClosed:
			// do nothing
		case <-time.After(time.Second * 5):
			// timeout
			logf("timed out trying to shut down http server")
		}
	}
}
