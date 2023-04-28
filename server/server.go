package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
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

	"github.com/kjk/common/server"
	"github.com/kjk/common/u"
	"golang.org/x/exp/slices"
)

var (
	cookieName   = "nckie" // noted cookie
	secureCookie *securecookie.SecureCookie

	httpPort    = 9236
	proxyURLStr = "http://localhost:3047"
	proxyURL    *url.URL
	// maps ouath secret to login info
	loginsInProress = map[string]string{}
)

func getGitHubSecrets() (string, string) {
	if isDev() {
		return "8adf394a86b4daa3fef8", secretGitHub
	}
	return "8ded4c0d72d9c14a388e", secretGitHub
}

type SecureCookieValue struct {
	User  string // "kjk"
	Email string // "kkowalczyk@gmail.com"
}

func setSecureCookie(w http.ResponseWriter, cookieVal *SecureCookieValue) {
	val := make(map[string]string)
	val["user"] = cookieVal.User
	val["email"] = cookieVal.Email
	if encoded, err := secureCookie.Encode(cookieName, val); err == nil {
		// TODO: set expiration (Expires    time.Time) long time in the future?
		cookie := &http.Cookie{
			Name:  cookieName,
			Value: encoded,
			Path:  "/",
		}
		http.SetCookie(w, cookie)
	} else {
		fmt.Printf("setSecureCookie(): error encoding secure cookie %s\n", err)
	}
}

const WeekInSeconds = 60 * 60 * 24 * 7

// to delete the cookie value (e.g. for logging out), we need to set an
// invalid value
func deleteSecureCookie(w http.ResponseWriter) {
	cookie := &http.Cookie{
		Name:   cookieName,
		Value:  "deleted",
		MaxAge: WeekInSeconds,
		Path:   "/",
	}
	http.SetCookie(w, cookie)
}

func getSecureCookie(r *http.Request) *SecureCookieValue {
	var ret *SecureCookieValue
	if cookie, err := r.Cookie(cookieName); err == nil {
		// detect a deleted cookie
		if cookie.Value == "deleted" {
			return nil
		}
		val := make(map[string]string)
		if err = secureCookie.Decode(cookieName, cookie.Value, &val); err != nil {
			// most likely expired cookie, so ignore. Ideally should delete the
			// cookie, but that requires access to http.ResponseWriter, so not
			// convenient for us
			//fmt.Printf("Error decoding cookie %s\n", err)
			return nil
		}
		//fmt.Printf("Got cookie %q\n", val)
		ret = &SecureCookieValue{}
		var ok bool
		if ret.User, ok = val["user"]; !ok {
			fmt.Printf("Error decoding cookie, no 'user' field\n")
			return nil
		}
	}
	return ret
}

func decodeUserFromCookie(r *http.Request) string {
	cookie := getSecureCookie(r)
	if nil == cookie {
		return ""
	}
	return cookie.User
}

var (
	pongTxt = []byte("pong")
)

func logLogin(ctx context.Context, r *http.Request, accessToken string) {
	ghToken := accessToken
	_, user, err := getGitHubUserInfo(ghToken)
	if err != nil {
		logf(ctx, "getGitHubUserInfo(%s) faled with '%s'\n", ghToken, err)
		return
	}
	logf(ctx, "logLogin: user: %#v\n", user)
	logf(ctx, "logLogin: logged in as GitHub user: %s\n", user.Login)
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
	logf(ctx, "handleLoginGitHub: '%s', redirect: '%s'\n", r.RequestURI, redirectURL)
	if redirectURL == "" {
		redirectURL = "/"
		return
	}
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
		http.Error(w, "no cookie", http.StatusBadRequest)
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
		v["email"] = cookie.Email
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
	redirect := loginsInProress[state]
	if redirect == "" {
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
	user := i.Login
	logf(ctx(), "github user: %s\n", user)
	cookie := &SecureCookieValue{}
	cookie.User = user
	setSecureCookie(w, cookie)
	logf(ctx(), "handleOauthGitHubCallback: redirect: '%s'\n", redirect)
	http.Redirect(w, r, redirect, http.StatusTemporaryRedirect)

	// can't put in the background because that cancels ctx
	logLogin(ctx(), r, access_token)
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

func permRedirect(w http.ResponseWriter, r *http.Request, newURL string) {
	http.Redirect(w, r, newURL, http.StatusPermanentRedirect)
}

// in dev, proxyHandler redirects assets to vite web server
// in prod, assets must be pre-built in web/dist directory
func makeHTTPServer(proxyHandler *httputil.ReverseProxy) *http.Server {
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
				uris := []string{"/github_success"}
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
			if slices.Contains(uris, uri) {
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

		http.NotFound(w, r)
	}

	handlerWithMetrics := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		wasBad = false
		m := httpsnoop.CaptureMetrics(http.HandlerFunc(mainHandler), w, r)
		defer func() {
			if p := recover(); p != nil {
				logf(ctx(), "handlerWithMetrics: panicked with with %v\n", p)
				errStr := fmt.Sprintf("Error: %v", p)
				http.Error(w, errStr, http.StatusInternalServerError)
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
	if isDev() {
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
	if isDev() {
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
