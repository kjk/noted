package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// log event to pirsch analytics
// /event/${name}
// body is JSON with metadata for POST / PUT or ?foo=bar keys
// if duration is included, it's dur field in metadata
func handleEvent(w http.ResponseWriter, r *http.Request) {
	uri := r.URL.Path
	name := strings.TrimPrefix(uri, "/event/")
	if name == "" {
		logErrorf(ctx(), "/event/ has no name\n")
		http.NotFound(w, r)
		return
	}

	durMs := 0
	meta := map[string]string{}
	logKV := func(k, v string) {
		if k == "dur" {
			durMs, _ = strconv.Atoi(v)
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
			logErrorf(ctx(), "dec.Decode() failed with '%s'\n", err)
		}
		for k, v := range m {
			vs := fmt.Sprintf("%s", v)
			logKV(k, vs)
		}
	}
	vals := r.Form
	for k := range vals {
		v := vals.Get(k)
		logKV(k, v)
	}
	axiomSendEvent(r, name, durMs, meta)

	content := bytes.NewReader([]byte("ok"))
	http.ServeContent(w, r, "foo.txt", time.Time{}, content)
}
