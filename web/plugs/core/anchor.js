import { editor, index } from "../../plug-api/silverbullet-syscall/mod.js";

import { collectNodesOfType } from "../../plug-api/lib/tree.js";
import { removeQueries } from "../../plug-api/lib/query.js";

export async function indexAnchors({ name: pageName, tree }) {
  removeQueries(tree);
  const anchors = [];
  collectNodesOfType(tree, "NamedAnchor").forEach((n) => {
    const aName = n.children[0].text.substring(1);
    anchors.push({
      key: `a:${pageName}:${aName}`,
      value: "" + n.from,
    });
  });
  await index.batchSet(pageName, anchors);
}

export async function anchorComplete(completeEvent) {
  const match = /\[\[([^\]@:]*@[\w\.\-\/]*)$/.exec(completeEvent.linePrefix);
  if (!match) {
    return null;
  }
  let [pageRef, anchorRef] = match[1].split("@");
  if (!pageRef) {
    pageRef = await editor.getCurrentPage();
  }
  const allAnchors = await index.queryPrefix(`a:${pageRef}:${anchorRef}`);
  return {
    from: completeEvent.pos - anchorRef.length,
    options: allAnchors.map((a) => ({
      label: a.key.split(":")[2],
      type: "anchor",
    })),
  };
}
