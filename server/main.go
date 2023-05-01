package main

import (
	"encoding/json"
	"flag"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strings"

	"github.com/go-redis/redis"
)

var (
	secretGitHub = ""
)

func getSecretsFromEnv() {
	getEnv := func(key string, val *string, minLen int) {
		v := strings.TrimSpace(os.Getenv(key))
		if len(v) < minLen {
			logf(ctx(), "Missing %s\n", key)
			return
		}
		*val = v
		// logf(ctx(), "Got %s, '%s'\n", key, v)
		logf(ctx(), "Got %s\n", key)
	}

	getEnv("NOTED_AXIOM_TOKEN", &axiomApiToken, 40)
	getEnv("NOTED_PIRSCH_SECRET", &pirschClientSecret, 64)
	getEnv("NOTED_GITHUB_SECRET", &secretGitHub, 40)
	getEnv("NOTED_UPSTASH_URL", &upstashDbURL, 20)
	getEnv("NOTED_R2_ACCESS", &r2Access, 10)
	getEnv("NOTED_R2_SECRET", &r2Secret, 10)

	// validate the
	if upstashDbURL != "" {
		_, err := redis.ParseURL(upstashDbURL)
		must(err)
	}
	if isDev() {
		upstashPrefix = "dev:"
		r2KeyPrefix = "dev/"
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
		flgDeploy          bool
		flgBuild           bool
		flgCi              bool
		flgWc              bool
		flgVisualizeBundle bool
	)
	{
		flag.BoolVar(&flgRunDev, "run-dev", false, "run the server in dev mode")
		flag.BoolVar(&flgRunProd, "run-prod", false, "run server in production")
		flag.BoolVar(&flgDeploy, "deploy", false, "start deploy on render.com")
		flag.BoolVar(&flgBuild, "build", false, "run yarn build to build frontend")
		flag.BoolVar(&flgCi, "ci", false, "true if needs to tell we're running under ci (github actions)")
		flag.BoolVar(&flgWc, "wc", false, "count lines")
		flag.BoolVar(&flgNoBrowserOpen, "no-open", false, "don't open browser when running dev server")
		flag.BoolVar(&flgVisualizeBundle, "visualize-bundle", false, "visualize bundle")
		flag.Parse()
	}

	if flgVisualizeBundle {
		cmd := exec.Command("npx", "vite-bundle-visualizer")
		cmdLog(cmd)
		must(cmd.Run())
		return
	}

	getSecretsFromEnv()

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

	if flgWc {
		doLineCount()
		return
	}

	if flgBuild {
		build()
		buildDocs()
		return
	}

	if flgDeploy {
		deploy()
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

	flag.Usage()
}

func startVite() func() {
	cmd := exec.Command("npx", "vite", "--strictPort=true", "--clearScreen=false")
	logf(ctx(), "> %s\n", cmd)
	// cmdLog(cmd)
	err := cmd.Start()
	must(err)
	return func() {
		cmd.Process.Kill()
	}
}

func cmdRunLoggedMust(cmd *exec.Cmd) {
	logf(ctx(), "> %s\n", cmd)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Stdin = os.Stdin
	err := cmd.Run()
	must(err)
}

func deploy() {
	uri := os.Getenv("NOTED_DEPLOY_URL")
	if uri == "" {
		logf(ctx(), "deply: NOTED_DEPLOY_URL env varialbe note found\n")
		return
	}
	rsp, err := http.DefaultClient.Get(uri)
	must(err)
	defer rsp.Body.Close()
	d, err := io.ReadAll(rsp.Body)
	must(err)
	logf(ctx(), "%s\n", string(d))
}

func build() {
	cmd := exec.Command("yarn", "build", "--emptyOutDir")
	cmdLog(cmd)
	must(cmd.Run())
}

func buildDocs() {
	cmd := exec.Command("yarn", "docs:build")
	cmdLog(cmd)
	must(cmd.Run())
}
