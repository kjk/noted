package main

import (
	"flag"
	"io"
	"net/http"
	"os"
	"os/exec"
)

var (
	secretGitHub      = ""
	secretGitHubLocal = ""
)

func getSecretsFromEnv() {
	axiomApiToken = os.Getenv("NOTED_AXIOM_TOKEN")
	if len(axiomApiToken) != 41 {
		logf(ctx(), "Axiom token missing or invalid length\n")
		axiomApiToken = ""
	} else {
		logf(ctx(), "Got axiom token\n")
	}
	pirschClientSecret = os.Getenv("NOTED_PIRSCH_SECRET")
	if len(pirschClientSecret) != 64 {
		logf(ctx(), "Pirsch secret missing or invalid length\n")
		pirschClientSecret = ""
	} else {
		logf(ctx(), "Got pirsch token\n")
	}
	secretGitHub = os.Getenv("NOTED_GITHUB_SECRET")
	if len(secretGitHub) != 40 {
		logf(ctx(), "GitHub secret missing or invalid length\n")
		secretGitHub = ""
	} else {
		logf(ctx(), "Got GitHub secret\n")
	}
	secretGitHubLocal = os.Getenv("NOTED_GITHUB_SECRET_LOCAL")
	if len(secretGitHubLocal) != 40 {
		logf(ctx(), "GitHub Local secret missing or invalid length\n")
		secretGitHubLocal = ""
	} else {
		logf(ctx(), "Got GitHub local secret\n")
	}
	upstashDb = os.Getenv("NOTED_UPSTASH_DB")
	if len(upstashDb) < 10 {
		logf(ctx(), "NOTED_UPSTASH_DB missing\n")
		upstashDb = ""
	} else {
		logf(ctx(), "Got NOTED_UPSTASH_DB")
	}
	upstashDbPwd = os.Getenv("NOTED_UPSTASH_DB_PWD")
	if len(upstashDbPwd) < 10 {
		logf(ctx(), "NOTED_UPSTASH_DB_PWD missing\n")
		upstashDbPwd = ""
	} else {
		logf(ctx(), "Got NOTED_UPSTASH_DB_PWD")
	}

	r2Access = os.Getenv("NOTED_R2_ACCESS")
	if len(r2Access) < 10 {
		logf(ctx(), "NOTED_R2_ACCESS missing\n")
		r2Access = ""
	} else {
		logf(ctx(), "Got NOTED_R2_ACCESS")
	}

	r2Secret = os.Getenv("NOTED_R2_SECRET")
	if len(r2Secret) < 10 {
		logf(ctx(), "NOTED_R2_SECRET missing\n")
		r2Secret = ""
	} else {
		logf(ctx(), "Got NOTED_R2_SECRET")
	}
}

var (
	flgRunDev bool
)

func isDev() bool {
	return flgRunDev
}

func main() {
	var (
		flgRunProd bool
		flgDeploy  bool
		flgBuild   bool
		flgCi      bool
		flgWc      bool
	)
	{
		flag.BoolVar(&flgRunDev, "run-dev", false, "run the server in dev mode")
		flag.BoolVar(&flgRunProd, "run-prod", false, "run server in production")
		flag.BoolVar(&flgDeploy, "deploy", false, "start deploy on render.com")
		flag.BoolVar(&flgBuild, "build", false, "run yarn build to build frontend")
		flag.BoolVar(&flgCi, "ci", false, "true if needs to tell we're running under ci (github actions)")
		flag.BoolVar(&flgWc, "wc", false, "count lines")
		flag.Parse()
	}

	getSecretsFromEnv()

	setGitHubAuth()
	if isDev() {
		setGitHubAuthDev()
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
	cmdLog(cmd)
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
