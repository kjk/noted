import * as YAML from "js-yaml";

import { findNodeOfType, traverseTree } from "../lib/tree.js";
import { markdown, space } from "../silverbullet-syscall/mod.js";

export async function readCodeBlockPage(pageName, allowedLanguages) {
  const text = await space.readPage(pageName);
  const tree = await markdown.parseMarkdown(text);
  let codeText;
  traverseTree(tree, (t) => {
    if (t.type !== "FencedCode") {
      return false;
    }
    const codeInfoNode = findNodeOfType(t, "CodeInfo");
    if (allowedLanguages && !codeInfoNode) {
      return false;
    }
    if (
      allowedLanguages &&
      !allowedLanguages.includes(codeInfoNode.children[0].text)
    ) {
      return false;
    }
    const codeTextNode = findNodeOfType(t, "CodeText");
    if (!codeTextNode) {
      return false;
    }
    codeText = codeTextNode.children[0].text;
    return true;
  });
  return codeText;
}
/**
 *
 * @param {string} pageName
 * @param {string[]} allowedLanguages
 * @returns {Promise<any>}
 */
export async function readYamlPage(pageName, allowedLanguages = ["yaml"]) {
  const codeText = await readCodeBlockPage(pageName, allowedLanguages);
  if (codeText === void 0) {
    return void 0;
  }
  try {
    /** @type {any} */
    let res = YAML.load(codeText);
    return res;
  } catch (e) {
    console.error("YAML Page parser error", e);
    throw new Error(`YAML Error: ${e.message}`);
  }
}
export async function writeYamlPage(pageName, data, prelude = "") {
  //    noCompatMode: true,
  const text = YAML.dump(data, {});
  await space.writePage(pageName, prelude + "```yaml\n" + text + "\n```");
}
