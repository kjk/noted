import buildMarkdown from "../../markdown_parser/parser";
import { parse } from "../../markdown_parser/parse_tree.js";
let lang = buildMarkdown([]);

export function parseMarkdown(text) {
  return parse(lang, text);
}
