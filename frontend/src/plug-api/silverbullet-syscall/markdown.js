import buildMarkdown from "../../markdown_parser/parser";
import { parse } from "../../markdown_parser/parse_tree.js";

let lang = buildMarkdown([]);

/**
 * @param { import("@codemirror/language").Language } l
 */
export function setMarkdownLang(l) {
  lang = l;
}

export function parseMarkdown(text) {
  return parse(lang, text);
}
