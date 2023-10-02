package main

import (
	"encoding/json"
	"flag"
	"os"
	"strings"
	"time"

	"github.com/go-redis/redis"
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

	getEnv("AXIOM_TOKEN", &axiomApiToken, 40)
	getEnv("PIRSCH_SECRET", &pirschClientSecret, 64)
	getEnv("GITHUB_SECRET_PROD", &secretGitHub, 40)
	getEnv("UPSTASH_URL", &upstashDbURL, 20)
	getEnv("R2_ACCESS", &r2Access, 10)
	getEnv("R2_SECRET", &r2Secret, 10)

	if upstashDbURL != "" {
		_, err := redis.ParseURL(upstashDbURL)
		must(err)
	}
	if isDev() {
		getEnv("GITHUB_SECRET_LOCAL", &secretGitHub, 40)
		upstashPrefix = "dev:"
		r2KeyPrefix = "dev/"
		pirschClientSecret = ""
	}
}

var (
	flgRunDev        bool
	flgNoBrowserOpen bool
)

func isDev() bool {
	return flgRunDev
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

	if false {
		listR2Files()
		testUpstash()
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
