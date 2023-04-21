package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"

	"github.com/go-redis/redis"
	"github.com/kjk/minioutil"
)

var (
	upstashDbURL string

	r2Endpoint = "71694ef61795ecbe1bc331d217dbd7a7.r2.cloudflarestorage.com"
	r2Bucket   = "files"
	r2Access   string
	r2Secret   string

	inMemStoreNotes   = map[string]string{}
	inMemStoreContent = map[string]string{}
	muStore           sync.Mutex
)

func getUpstashClient() *redis.Client {
	opt, _ := redis.ParseURL(upstashDbURL)
	client := redis.NewClient(opt)
	return client
}

func testUpstash() {
	logf(ctx(), "testUpstash()\n")
	c := getUpstashClient()
	_, err := c.Ping().Result()
	must(err)
	logf(ctx(), "testUpstash() ok!\n")
}

func getR2Client() *minioutil.Client {
	conf := &minioutil.Config{
		Endpoint: r2Endpoint,
		Bucket:   r2Bucket,
		Access:   r2Access,
		Secret:   r2Secret,
	}
	client, err := minioutil.New(conf)
	must(err)
	return client
}

func listR2Files() {
	logf(ctx(), "listR2Files()\n")
	mc := getR2Client()
	nFiles := 0
	files := mc.ListObjects("/")
	for o := range files {
		logf(ctx(), "%s\n", o.Key)
		nFiles++
	}
	logf(ctx(), "nFiles: %d\n", nFiles)
}

func serveIfError(w http.ResponseWriter, err error) bool {
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return true
	}
	return false
}

func handleStore(w http.ResponseWriter, r *http.Request) {
	uri := r.URL.Path
	storeName := r.URL.Query().Get("store")
	// key := r.URL.Query().Get("key")
	if uri == "/api/kv/keys" {
		keys, err := storeKeys(storeName)
		if serveIfError(w, err) {
			return
		}
		keysJSON, err := json.Marshal(keys)
		if serveIfError(w, err) {
			return
		}
		fmt.Fprint(w, keysJSON)
	} else if uri == "/api/kv/getJSON" {
	} else if uri == "/api/kv/getBlob" {
	} else if uri == "/api/kv/setJSON" {
	} else if uri == "/api/kv/setBlob" {
	} else {
		http.NotFound(w, r)
	}
}

func storeKeys(storeName string) ([]string, error) {
	// storeName is the name of the store, e.g. "users"
	// returns a list of keys, e.g. ["users", "users:1", "users:2"]
	return nil, fmt.Errorf("not implemented")
}

func storeGet(storeName, key string) (interface{}, error) {
	// storeName is the name of the store, e.g. "users"
	// key is the key, e.g. "users:1"
	// returns the value, e.g. {"id": 1, "name": "bob"}
	return nil, fmt.Errorf("not implemented")
}

func storeSet(storeName, key string, value interface{}) error {
	// storeName is the name of the store, e.g. "users"
	// key is the key, e.g. "users:1"
	// value is the value, e.g. {"id": 1, "name": "bob"}
	return fmt.Errorf("not implemented")
}
