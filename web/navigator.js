import {
  getNoteByEncodedTitle,
  getNoteByID,
  getNoteID,
  getNoteTitle,
} from "./notesStore";

import { len } from "./lib/util";
import { log } from "./lib/log";
import { safeRun } from "./plugos/util";

// not great but "-" is returned by nanoid()
const idSep = "~";

/** @typedef {import("./notesStore").Note} Note */

/**
 * @param {Note} note
 * @param {boolean} justID
 * @returns {string}
 */
export function encodeNoteURL(note, justID = false) {
  let id = getNoteID(note);
  if (justID) {
    return id;
  }
  let title = getNoteTitle(note);
  return encodeURIComponent(title) + idSep + id;
}

function sanitizePos(pos) {
  if (!pos) {
    return 0;
  }
  if (pos.match(/^\d+$/)) {
    return +pos;
  }
  return pos;
}

/**
 * @returns {any[][]}
 */
function decodePageURL() {
  let path = location.pathname;
  log("decodePageURL: path", path);
  path = path.substring(3); // trim /n/ at the beginning
  let noteURL = globalThis.decodeURIComponent(path);
  let res = [];
  let [title, pos] = noteURL.split("@");
  pos = sanitizePos(pos);
  let note = getNoteByEncodedTitle(title);
  res.push([note, pos]);
  return res;
}

let navigationResolve = null;

/**
 * @param {(string|number|Note)[][]} notes
 * @param {boolean} replaceState
 */
export async function navigateToNotes(notes, replaceState = false) {
  let state = [];
  let uri = "";
  let nNotes = len(notes);
  let justID = nNotes > 1;
  for (let i = 0; i < nNotes; i++) {
    let note = /** @type{Note} */ (notes[i][0]);
    let noteID = getNoteID(note);
    let pos = notes[i][1];
    state.push([noteID, pos]);

    if (i === 0) {
      uri += "/n/";
    } else if (i === 1) {
      uri += "#";
    } else {
      uri += ";";
    }
    uri += encodeNoteURL(note, justID);
  }
  if (replaceState) {
    window.history.replaceState(state, "", uri);
  } else {
    window.history.pushState(state, "", uri);
  }
  globalThis.dispatchEvent(
    new PopStateEvent("popstate", {
      state: state,
    })
  );
  await new Promise((resolve) => {
    navigationResolve = resolve;
  });
  navigationResolve = null;
}

let navigationCallback = null;

function onPopState(event) {
  log("onPopState: event", event);
  let notes = event?.state;
  let nNotes = len(notes);
  if (nNotes > 0) {
    // in-place replace noteID with note
    for (let noteAndPos of notes) {
      let noteID = noteAndPos[0];
      let note = getNoteByID(noteID);
      noteAndPos[0] = note;
    }
  } else {
    // decode from URL
    log("onPopState: decoding from URL");
    notes = decodePageURL();
  }
  log("onPopState: notes", notes);
  safeRun(async () => {
    await navigationCallback(notes);
    if (navigationResolve) {
      navigationResolve();
    }
  });
}

export function setNavigationCallback(cb) {
  navigationCallback = cb;
  if (navigationCallback) {
    onPopState();
  }
}

globalThis.addEventListener("popstate", onPopState);
