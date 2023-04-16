import {
  addParentPointers,
  collectNodesMatching,
  findParentMatching,
  nodeAtPos,
  removeParentPointers,
  renderToText,
  replaceNodesMatching,
} from "./tree.js";
import wikiMarkdownLang from "../../common/markdown_parser/parser.js";
import { assertEquals, assertNotEquals } from "../../test_deps.js";
import { parse } from "../../common/markdown_parser/parse_tree.js";
const mdTest1 = `
# Heading
## Sub _heading_ cool

Hello, this is some **bold** text and *italic*. And [a link](http://zef.me).

%% My comment here
%% And second line

And an @mention

http://zef.plus

- This is a list [[PageLink]]
- With another item
- TODOs:
  - [ ] A task that's not yet done
  - [x] Hello
- And a _third_ one [[Wiki Page]] yo
`;
const mdTest2 = `
Hello

* Item 1
*

Sup`;
const mdTest3 = `
\`\`\`yaml
name: something
\`\`\`
`;
Deno.test("Test parsing", () => {
  const lang = wikiMarkdownLang([]);
  const mdTree = parse(lang, mdTest1);
  addParentPointers(mdTree);
  const wikiLink = nodeAtPos(mdTree, mdTest1.indexOf("Wiki Page"));
  assertEquals(wikiLink.type, "WikiLinkPage");
  assertNotEquals(
    findParentMatching(wikiLink, (n) => n.type === "BulletList"),
    null
  );
  const allTodos = collectNodesMatching(mdTree, (n) => n.type === "Task");
  assertEquals(allTodos.length, 2);
  assertEquals(renderToText(mdTree), mdTest1);
  removeParentPointers(mdTree);
  replaceNodesMatching(mdTree, (n) => {
    if (n.type === "Task") {
      return {
        type: "Tosk",
      };
    }
  });
  console.log(JSON.stringify(mdTree, null, 2));
  let mdTree3 = parse(lang, mdTest3);
  console.log(JSON.stringify(mdTree3, null, 2));
});
