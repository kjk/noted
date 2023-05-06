import {
  getNoteByEncodedTitle,
  getNoteByID,
  getNoteID,
  getNoteTitle,
} from "./notesStore";

import { log } from "./lib/log";
import { safeRun } from "./plugos/util";

// not great but "-" is returned by nanoid()
const idSep = "~";

/** @typedef {import("./notesStore").Note} Note */

/**
 * @param {Note} note
 * @returns {string}
 */
export function encodeNoteURL(note) {
  let title = getNoteTitle(note);
  let id = getNoteID(note);
  return encodeURIComponent(title) + idSep + id;
}

/**
 * @returns {[string, string|number]}
 */
function decodePageURL() {
  let path = location.pathname;
  log("decodePageURL: path", path);
  path = path.substring(3); // trim /n/ at the beginning
  let noteURL = globalThis.decodeURIComponent(path);
  const [title, pos] = noteURL.split("@");
  if (pos) {
    if (pos.match(/^\d+$/)) {
      return [title, +pos];
    } else {
      return [title, pos];
    }
  } else {
    return [title, 0];
  }
}

let navigationResolve = null;

/**
 * @param {Note} note
 * @param {number|string} pos
 * @param {boolean} replaceState
 */
export async function navigate(note, pos, replaceState = false) {
  let uri = "";
  if (note !== null) {
    uri = "/n/" + encodeNoteURL(note);
  }
  let noteID = getNoteID(note);
  if (replaceState) {
    window.history.replaceState({ noteID, pos }, "", uri);
  } else {
    window.history.pushState({ noteID, pos }, "", uri);
  }
  globalThis.dispatchEvent(
    new PopStateEvent("popstate", {
      state: { noteID, pos },
    })
  );
  await new Promise((resolve) => {
    navigationResolve = resolve;
  });
  navigationResolve = null;
}

let pageLoadCallback = null;

function onPopState(event) {
  log("onPopState: event", event);
  let note = null;
  /** @type {string|number} */
  let pos = 0;
  if (event?.state?.noteID) {
    note = getNoteByID(event.state.noteID);
    pos = event.state.pos;
  }
  if (!note) {
    let [title, pagePos] = decodePageURL();
    log(`onPopState: title: '${title}', pagePos: ${pagePos}`);
    note = getNoteByEncodedTitle(title);
    pos = pagePos;
  }
  log("onPopState: note", note, "pos", pos);
  safeRun(async () => {
    await pageLoadCallback(note, pos);
    if (navigationResolve) {
      navigationResolve();
    }
  });
}

export function setPageLoadCallback(cb) {
  pageLoadCallback = cb;
  if (pageLoadCallback) {
    onPopState();
  }
}

globalThis.addEventListener("popstate", onPopState);
