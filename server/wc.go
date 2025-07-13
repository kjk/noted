package main

import (
	"github.com/kjk/common/u"
)

// return false to exclude a file
func excludeFiles(s string) bool {
	return true
}

var srcFiles = u.MakeAllowedFileFilterForExts(".go", ".svelte", ".js", ".html")
var excludeDirs = u.MakeExcludeDirsFilter("node_modules", "icons", "dist")
var allFiles = u.MakeFilterAnd(excludeDirs, excludeFiles, srcFiles)

func doLineCount() int {
	stats := u.NewLineStats()
	err := stats.CalcInDir(".", allFiles, true)
	if err != nil {
		logf("doWordCount: stats.wcInDir() failed with '%s'\n", err)
		return 1
	}
	u.PrintLineStats(stats)
	return 0
}
