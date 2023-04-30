import { markdown, space } from "../../plug-api/silverbullet-syscall/mod.js";

import Handlebars from "handlebars";
import { directiveRegex } from "./directives.js";
import { extractFrontmatter } from "../../plug-api/lib/frontmatter.js";
import { queryRegex } from "../../plug-api/lib/query.js";
import { renderToText } from "../../plug-api/lib/tree.js";
import { replaceAsync } from "../../plug-api/lib/util.js";
import { replaceTemplateVars } from "../core/template.js";
import { serverUpdateDirectives } from "./command.js";

const templateRegex = /\[\[([^\]]+)\]\]\s*(.*)\s*/;
export async function templateDirectiveRenderer(directive, pageName, arg) {
  if (typeof arg !== "string") {
    throw new Error("Template directives must be a string");
  }
  const match = arg.match(templateRegex);
  if (!match) {
    throw new Error(`Invalid template directive: ${arg}`);
  }
  const template = match[1];
  const args = match[2];
  let parsedArgs = {};
  if (args) {
    try {
      parsedArgs = JSON.parse(args);
    } catch {
      throw new Error(`Failed to parse template instantiation args: ${arg}`);
    }
  }
  let templateText = "";
  if (template.startsWith("http://") || template.startsWith("https://")) {
    try {
      const req = await fetch(template);
      templateText = await req.text();
    } catch (e) {
      templateText = `ERROR: ${e.message}`;
    }
  } else {
    templateText = await space.readPage(template);
  }
  let newBody = templateText;
  if (directive === "use") {
    const tree = await markdown.parseMarkdown(templateText);
    extractFrontmatter(tree, ["$disableDirectives"]);
    templateText = renderToText(tree);
    const templateFn = Handlebars.compile(
      replaceTemplateVars(templateText, pageName),
      { noEscape: true }
    );
    newBody = templateFn(parsedArgs);
    newBody = await serverUpdateDirectives(pageName, newBody);
  }
  return newBody.trim();
}
export function cleanTemplateInstantiations(text) {
  return replaceAsync(
    text,
    directiveRegex,
    (_fullMatch, startInst, type, _args, body, endInst) => {
      if (type === "use") {
        body = body.replaceAll(
          queryRegex,
          (_fullMatch2, _startQuery, _query, body2) => {
            return body2.trim();
          }
        );
      }
      return Promise.resolve(`${startInst}${body}${endInst}`);
    }
  );
}
