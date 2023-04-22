package main

import (
	"bytes"
	"context"
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
	hutil "github.com/kjk/common/httputil"

	"github.com/kjk/common/server"
	"github.com/kjk/common/u"
	"golang.org/x/exp/slices"
	"golang.org/x/oauth2"
)

var (
	httpPort    = 9236
	proxyURLStr = "http://localhost:3047"
)

var (
	githubEndpoint = oauth2.Endpoint{
		AuthURL:  "https://github.com/login/oauth/authorize",
		TokenURL: "https://github.com/login/oauth/access_token",
	}

	// https://github.com/settings/applications/2098699
	oauthGitHubConf = &oauth2.Config{
		ClientID:     "",
		ClientSecret: "",
		// select level of access you want https://developer.github.com/v3/oauth/#scopes
		Scopes:   []string{"user:email", "read:user"},
		Endpoint: githubEndpoint,
	}

	// random string for oauth2 API calls to protect against CSRF
	oauthSecretPrefix = "34234234-"
)

func setGitHubAuth() {
	logf(ctx(), "setGitHubAuth()\n")
	oauthGitHubConf.ClientID = "8ded4c0d72d9c14a388e"
	oauthGitHubConf.ClientSecret = secretGitHub
}

func setGitHubLocalAuth() {
	logf(ctx(), "setGitHubLocalAuth()\n")
	oauthGitHubConf.ClientID = "8adf394a86b4daa3fef8"
	oauthGitHubConf.ClientSecret = secretGitHub
}

var (
	pongTxt = []byte("pong")
)

func logLogin(ctx context.Context, r *http.Request, token *oauth2.Token) {
	ghToken := token.AccessToken
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

// /auth/githubcb
// as set in https://github.com/settings/applications/1159140
func handleGithubCallback(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	logf(ctx, "handleGithubCallback: '%s'\n", r.URL)
	state := r.FormValue("state")
	if !strings.HasPrefix(state, oauthSecretPrefix) {
		logErrorf(ctx, "invalid oauth state, expected '%s*', got '%s'\n", oauthSecretPrefix, state)
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
		return
	}

	code := r.FormValue("code")
	token, err := oauthGitHubConf.Exchange(context.Background(), code)
	if err != nil {
		logErrorf(ctx, "oauthGoogleConf.Exchange() failed with '%s'\n", err)
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
		return
	}
	logf(ctx, "token: %#v", token)
	ac := token.AccessToken
	uri := "/github_success?access_token=" + ac
	logf(ctx, "token: %#v\nuri: %s\n", token, uri)
	http.Redirect(w, r, uri, http.StatusTemporaryRedirect)

	// can't put in the background because that cancels ctx
	logLogin(ctx, r, token)
}

// /auth/ghlogin
func handleLoginGitHub(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// GitHub seems to completely ignore Redir, which makes testing locally hard
	// TODO: generate temporary oathSecret
	uri := oauthGitHubConf.AuthCodeURL(oauthSecretPrefix, oauth2.AccessTypeOnline)
	logf(ctx, "handleLoginGitHub: to '%s'\n", uri)
	http.Redirect(w, r, uri, http.StatusTemporaryRedirect)
}

// /auth/ghlogout
func handleLogoutGitHub(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	logf(ctx, "handleLogoutGitHub()\n")
	ghToken := getGitHubTokenFromRequest(r)
	if ghToken == "" {
		logf(ctx, "handleLogoutGitHub: no token\n")
		serveInternalError(w, r, "no GitHub token")
		return
	}
	serveText(w, http.StatusOK, "ok")
	muStore.Lock()
	defer muStore.Unlock()
	delete(ghTokenToUserInfo, ghToken)
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
				uris := []string{"/github_success", "/gisteditor/nogist", "/gisteditor/edit"}
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
