package main

import (
	"encoding/json"
	"flag"
	"os"
	"strings"
	"time"

	"github.com/kjk/common/u"
)

var (
	secretGitHub = ""
)

// in production deployment secrets are stored in binary as secretsEnv
// when running non-prod we read secrets from secrets repo we assume
// is parallel to this repo
func loadSecrets() {
	var m map[string]string
	if len(secretsEnv) > 0 {
		logf(ctx(), "loading secrets from secretsEnv\n")
		m = u.ParseEnvMust(secretsEnv)
	} else {
		panicIf(!isWinOrMac(), "secretsEnv is empty and running on linux")
		d, err := os.ReadFile(secretsSrcPath)
		must(err)
		m = u.ParseEnvMust(d)
	}
	validateSecrets(m)

	getEnv := func(key string, val *string, minLen int) {
		v := strings.TrimSpace(m[key])
		if len(v) < minLen {
			logf(ctx(), "Missing %s\n", key)
			return
		}
		*val = v
		// logf(ctx(), "Got %s, '%s'\n", key, v)
		logf(ctx(), "Got %s\n", key)
	}

	getEnv("GITHUB_SECRET_PROD", &secretGitHub, 40)
	if isDev() {
		getEnv("GITHUB_SECRET_LOCAL", &secretGitHub, 40)
	}
}

var (
	flgRunDev        bool
	flgNoBrowserOpen bool
	dataDir          string
)

func getDataDirMust() string {
	if dataDir == "" {
		onServer := "/home/data"
		if u.DirExists(onServer) {
			dataDir = onServer + "/noted"
		} else {
			dataDir = "data"
		}
		must(os.MkdirAll(dataDir, 0755))
		logf(ctx(), "dataDir: %s\n", dataDir)
	}
	return dataDir
}

func isDev() bool {
	return flgRunDev
}

func measureDuration() func() {
	timeStart := time.Now()
	return func() {
		logf(ctx(), "took %s\n", time.Since(timeStart))
	}
}

func main() {
	var (
		flgRunProd         bool
		flgWc              bool
		flgVisualizeBundle bool
		flgDeployHetzner   bool
		flgSetupAndRun     bool
		flgBuildLocalProd  bool
		flgExtractFrontend bool
		flgUpdateGoDeps    bool
	)
	{
		flag.BoolVar(&flgRunDev, "run-dev", false, "run the server in dev mode")
		flag.BoolVar(&flgRunProd, "run-prod", false, "run server in production")
		flag.BoolVar(&flgDeployHetzner, "deploy-hetzner", false, "deploy to hetzner")
		flag.BoolVar(&flgBuildLocalProd, "build-local-prod", false, "build for production run locally")
		flag.BoolVar(&flgSetupAndRun, "setup-and-run", false, "setup and run on the server")
		flag.BoolVar(&flgExtractFrontend, "extract-frontend", false, "extract frontend files embedded as zip in the binary")
		flag.BoolVar(&flgWc, "wc", false, "count lines")
		flag.BoolVar(&flgNoBrowserOpen, "no-open", false, "don't open browser when running dev server")
		flag.BoolVar(&flgVisualizeBundle, "visualize-bundle", false, "visualize bundle")
		flag.BoolVar(&flgUpdateGoDeps, "update-go-deps", false, "update go dependencies")

		flag.Parse()
	}

	if flgVisualizeBundle {
		u.RunLoggedInDir("frontend", "npx", "vite-bundle-visualizer")
		return
	}

	loadSecrets()

	if false {
		v := []interface{}{"s", 5, "hala"}
		d, _ := json.Marshal(v)
		logf(ctx(), "v: %s\n", string(d))
		return
	}

	if flgRunDev {
		runServerDev()
		return
	}

	if flgRunProd {
		runServerProd()
		return
	}

	timeStart := time.Now()
	defer func() {
		logf(ctx(), "took: %s\n", time.Since(timeStart))
	}()

	if flgExtractFrontend {
		extractFrontend()
		return
	}

	if flgBuildLocalProd {
		buildLocalProd()
		return
	}
	if flgUpdateGoDeps {
		defer measureDuration()()
		updateGoDeps(true)
		return
	}

	if flgDeployHetzner {
		deployToHetzner()
		return
	}

	if flgSetupAndRun {
		setupAndRun()
		return
	}

	if flgWc {
		doLineCount()
		return
	}

	flag.Usage()
}

func buildDocs() {
	u.RunLoggedInDirMust("frontend", "yarn", "docs:build")
}
