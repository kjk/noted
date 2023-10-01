import { applyQuery, removeQueries } from "../../plug-api/lib/query.js";
import { editor, index } from "../../plug-api/silverbullet-syscall/mod.js";

import { renderToText } from "../../plug-api/lib/tree.js";

const searchPrefix = "\u{1F50D} ";

export async function pageIndex(data) {
  removeQueries(data.tree);
  // TODO: in sileverbullet this is only available for the server and using
  // sqlite. we could use wasm build of sqlite or use client-side fulltext indexig library

  // const cleanText = renderToText(data.tree);
  // await fulltext.fullTextIndex(data.name, cleanText);
}

export async function pageUnindex(pageName) {
  // TODO: silverbullet only has this for server
  // await fulltext.fullTextDelete(pageName);
}

export async function queryProvider({ query }) {
  const phraseFilter = query.filter.find((f) => f.prop === "phrase");
  if (!phraseFilter) {
    throw Error("No 'phrase' filter specified, this is mandatory");
  }
  let results = [];
  // TODO: silverbullet only has this for server
  // let results = await fulltext.fullTextSearch(phraseFilter.value, {
  //   highlightEllipsis: "...",
  //   limit: 100,
  // });
  const allPageMap = new Map(results.map((r) => [r.name, r]));
  for (const { page, value } of await index.queryPrefix("meta:")) {
    const p = allPageMap.get(page);
    if (p) {
      for (const [k, v] of Object.entries(value)) {
        p[k] = v;
      }
    }
  }
  query.filter.splice(query.filter.indexOf(phraseFilter), 1);
  results = applyQuery(query, results);
  return results;
}

export async function searchCommand() {
  const phrase = await editor.prompt("Search for: ");
  if (phrase) {
    await editor.navigate(`${searchPrefix}${phrase}`);
  }
}
