import {
  addParentPointers,
  findNodeOfType,
  findParentMatching,
  nodeAtPos,
} from "../../plug-api/lib/tree.js";
import {
  editor,
  markdown,
  space,
  system,
} from "../../plug-api/silverbullet-syscall/mod.js";

import { log } from "../../lib/log.js";

const navigationNodeFinder = (t) =>
  [
    "WikiLink",
    "Link",
    "Image",
    "URL",
    "NakedURL",
    "Link",
    "CommandLink",
    "PageRef",
  ].includes(t.type);

async function actionClickOrActionEnter(mdTree, inNewWindow = false) {
  if (!mdTree) {
    return;
  }
  if (!navigationNodeFinder(mdTree)) {
    mdTree = findParentMatching(mdTree, navigationNodeFinder);
    if (!mdTree) {
      return;
    }
  }

  log("actionClickOrActionEnter", mdTree.type);
  switch (mdTree.type) {
    case "WikiLink": {
      let pageLink = mdTree.children[1].children[0].text;
      let pos;
      if (pageLink.includes("@")) {
        [pageLink, pos] = pageLink.split("@");
        if (pos.match(/^\d+$/)) {
          pos = +pos;
        }
      }
      if (!pageLink) {
        pageLink = await editor.getCurrentPage();
      }
      await editor.navigate(pageLink, pos, false, inNewWindow);
      break;
    }

    case "PageRef": {
      const bracketedPageRef = mdTree.children[0].text;
      await editor.navigate(
        bracketedPageRef.substring(2, bracketedPageRef.length - 2),
        0,
        false,
        inNewWindow
      );
      break;
    }

    case "NakedURL":
      await editor.openUrl(mdTree.children[0].text);
      break;

    case "Image":
    case "Link": {
      const urlNode = findNodeOfType(mdTree, "URL");
      if (!urlNode) {
        return;
      }
      let url = urlNode.children[0].text;
      if (url.length <= 1) {
        return editor.flashNotification("Empty link, ignoring", "error");
      }
      if (url.indexOf("://") === -1 && !url.startsWith("mailto:")) {
        url = decodeURIComponent(url);
        const dataUrl = await space.readAttachment(url);
        return editor.downloadFile(url, dataUrl);
      } else {
        await editor.openUrl(url);
      }
      break;
    }

    case "CommandLink": {
      const commandName = mdTree.children[1].children[0].text;
      await system.invokeCommand(commandName);
      break;
    }
  }
}

export async function linkNavigate() {
  log("linkNavigate");
  const mdTree = editor.getParsedMarkdown(true);
  let pos = await editor.getCursor();
  const newNode = nodeAtPos(mdTree, pos);
  if (!newNode) {
    log("clickNavigate: no node at pos", event.pos);
    return;
  }
  await actionClickOrActionEnter(newNode);
}

export async function clickNavigate(event) {
  if (event.altKey) {
    return;
  }
  log("clickNavigate:", event);
  const mdTree = editor.getParsedMarkdown(true);
  const newNode = nodeAtPos(mdTree, event.pos);
  if (!newNode) {
    log("clickNavigate: no node at pos", event.pos);
    return;
  }
  await actionClickOrActionEnter(newNode, event.ctrlKey || event.metaKey);
}

export async function navigateCommand(cmdDef) {
  await editor.navigate(cmdDef.page);
}
