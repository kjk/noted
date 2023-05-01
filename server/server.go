package main

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/felixge/httpsnoop"
	"github.com/gorilla/securecookie"
	hutil "github.com/kjk/common/httputil"
	"github.com/sanity-io/litter"

	"github.com/kjk/common/server"
	"github.com/kjk/common/u"
	"golang.org/x/exp/slices"
)

var (
	cookieName   = "nckie" // noted cookie
	secureCookie *securecookie.SecureCookie

	cookieAuthKeyHexStr = "81615f1aed7f857b4cb9c539acb5f9b5a88c9d6c4e87a4141079490773d17f5b"
	cookieEncrKeyHexStr = "00db6337a267be94a44813335bf3bd9e35868875b896fbe3758e613fbb8ec8d4"

	httpPort    = 9236
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

	logf(ctx(), "setSecureCookie: user: '%s', email: '%s'\n", c.User, c.Email)
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
	m := map[string]string{}
	m["user"] = user.Login
	m["email"] = user.Email
	m["name"] = user.Name
	pirschSendEvent(r, "github_login", 0, m)
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
	ctx := r.Context()

	redirectURL := strings.TrimSpace(r.FormValue("redirect"))
	if redirectURL == "" {
		redirectURL = "/"
	}
	logf(ctx, "handleLoginGitHub: '%s', redirect: '%s'\n", r.RequestURI, redirectURL)
	clientID, _ := getGitHubSecrets()

	// secret value passed to auth server and then back to us
	state := genRandomID(8)
	muStore.Lock()
	loginsInProress[state] = redirectURL
	muStore.Unlock()

	cb := httpScheme(r) + r.Host + "/auth/githubcb"
	logf(ctx, "handleLogin: cb='%s'\n", cb)

	vals := url.Values{}
	vals.Add("client_id", clientID)
	vals.Add("scope", "read:user")
	vals.Add("state", state)
	vals.Add("redirect_uri", cb)

	authURL := "https://github.com/login/oauth/authorize?" + vals.Encode()
	logf(ctx, "handleLogin: doing auth 302 redirect to '%s'\n", authURL)
	http.Redirect(w, r, authURL, http.StatusFound) // 302
}

// /auth/ghlogout
func handleLogoutGitHub(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	logf(ctx, "handleLogoutGitHub()\n")
	cookie := getSecureCookie(r)
	if cookie == nil {
		logf(ctx, "handleLogoutGitHub: no cookie\n")
		serveError(w, "no cookie", http.StatusBadRequest)
		return
	}
	email := cookie.Email
	deleteSecureCookie(w)
	muStore.Lock()
	defer muStore.Unlock()
	delete(emailToUserInfo, email)

	serveText(w, http.StatusOK, "ok")
}

const errorURL = "/github_login_failed"

// /auth/user
// returns JSON with user info in the body
func handleAuthUser(w http.ResponseWriter, r *http.Request) {
	logf(ctx(), "handleAuthUser: '%s'\n", r.URL)
	v := map[string]interface{}{}
	cookie := getSecureCookie(r)
	if cookie == nil {
		v["error"] = "not logged in"
		logf(ctx(), "handleAuthUser: not logged in\n")
	} else {
		v["user"] = cookie.User
		v["login"] = cookie.User
		v["email"] = cookie.Email
		v["avatar_url"] = cookie.AvatarURL
		logf(ctx(), "handleAuthUser: logged in as '%s', '%s'\n", cookie.User, cookie.Email)
	}
	serveJSONOK(w, r, v)
}

// /auth/githubcb
// as set in:
// https://github.com/settings/applications/2175661
// https://github.com/settings/applications/2175803
func handleGithubCallback(w http.ResponseWriter, r *http.Request) {
	logf(ctx(), "handleGithubCallback: '%s'\n", r.URL)
	state := r.FormValue("state")
	redirectURL := loginsInProress[state]
	if redirectURL == "" {
		logErrorf(ctx(), "invalid oauth state, no redirect for state '%s'\n", state)
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
		logf(ctx(), "http.Post() failed with '%s'\n", err)
		// logForm(r)
		http.Redirect(w, r, errorURL+"?error="+url.QueryEscape(err.Error()), http.StatusTemporaryRedirect)
		return
	}
	var m map[string]interface{}
	err = json.NewDecoder(resp.Body).Decode(&m)
	if err != nil {
		logf(ctx(), "json.NewDecoder() failed with '%s'\n", err)
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

	logf(ctx(), "access_token: %s, token_type: %s, scope: %s\n", access_token, token_type, scope)

	_, i, err := getGitHubUserInfo(access_token)
	if err != nil {
		logf(ctx(), "getGitHubUserInfo() failed with '%s'\n", err)
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
	logf(ctx(), "github user: '%s', email: '%s'\n", cookie.User, cookie.Email)
	setSecureCookie(w, cookie)
	logf(ctx(), "handleOauthGitHubCallback: redirect: '%s'\n", redirectURL)
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

var (
	data404 []byte
)

func read404(dir string) []byte {
	if data404 != nil && !isDev() {
		return data404
	}
	path := filepath.Join(dir, "404.html")
	d, err := ioutil.ReadFile(path)
	must(err)
	data404 = d
	return d
}

// in dev, proxyHandler redirects assets to vite web server
// in prod, assets must be pre-built in web/dist directory
func makeHTTPServer(proxyHandler *httputil.ReverseProxy) *http.Server {
	makeSecureCookie()

	distDir := ""

	if proxyHandler == nil {
		distDir = "dist"
		panicIf(!u.DirExists(distDir), "dir '%s' doesn't exist", distDir)
	}

	wasBad := false
	mainHandler := func(w http.ResponseWriter, r *http.Request) {

		tryServeRedirect := func(uri string) bool {
			if uri == "/home" {
				http.Redirect(w, r, "/", http.StatusPermanentRedirect)
				return true
			}
			wasBad = server.TryServeBadClient(w, r, nil)
			return wasBad
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
			Dir:              distDir,
			SupportCleanURLS: true,
			ForceCleanURLS:   true,
			ServeCompressed:  false,
		}
		if hutil.TryServeFile(w, r, &opts) {
			return
		}

		w.Header().Set("Content-Type", "text/html")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		d := read404(distDir)
		w.WriteHeader(http.StatusNotFound)
		w.Write(d)
	}

	handlerWithMetrics := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		wasBad = false
		m := httpsnoop.CaptureMetrics(http.HandlerFunc(mainHandler), w, r)
		defer func() {
			if p := recover(); p != nil {
				logf(ctx(), "handlerWithMetrics: panicked with with %v\n", p)
				errStr := fmt.Sprintf("Error: %v", p)
				serveError(w, errStr, http.StatusInternalServerError)
				return
			}
			if isDev() {
				return
			}
			logHTTPReq(r, m.Code, m.Written, m.Duration)
			if m.Code == 200 && !wasBad {
				pirschSendHit(r)
			}
			axiomLogHTTPReq(ctx(), r, m.Code, int(m.Written), m.Duration)
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
	httpSrv := makeHTTPServer(nil)
	logf(ctx(), "runServerProd(): starting on 'http://%s', dev: %v\n", httpSrv.Addr, isDev())
	err := httpSrv.ListenAndServe()
	logf(ctx(), "httpSrv.ListenAndServe() exited with %v\n", err)
}

func runServerDev() {
	stopVite := startVite()
	defer stopVite()

	// must be same as vite.config.js
	proxyURL, err := url.Parse(proxyURLStr)
	must(err)
	proxyHandler := httputil.NewSingleHostReverseProxy(proxyURL)

	httpSrv := makeHTTPServer(proxyHandler)

	//closeHTTPLog := OpenHTTPLog("noted")
	//defer closeHTTPLog()

	logf(ctx(), "runServerDev(): starting on '%s', dev: %v\n", httpSrv.Addr, isDev())
	if isDev() && !flgNoBrowserOpen {
		time.Sleep(time.Second * 2)
		u.OpenBrowser("http://" + httpSrv.Addr)
	}
	waitFn := serverListenAndWait(httpSrv)
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
			logf(ctx(), "HTTP server shutdown gracefully\n")
		} else {
			logf(ctx(), "httpSrv.ListenAndServe error '%s'\n", err)
		}
		chServerClosed <- true
	}()

	return func() {
		// Ctrl-C sends SIGINT
		sctx, stop := signal.NotifyContext(ctx(), os.Interrupt /*SIGINT*/, os.Kill /* SIGKILL */, syscall.SIGTERM)
		defer stop()
		<-sctx.Done()

		logf(ctx(), "Got one of the signals. Shutting down http server\n")
		_ = httpSrv.Shutdown(ctx())
		select {
		case <-chServerClosed:
			// do nothing
		case <-time.After(time.Second * 5):
			// timeout
			logf(ctx(), "timed out trying to shut down http server")
		}
	}
}
