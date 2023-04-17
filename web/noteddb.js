import { genRandomID, len, sha1 } from "./lib/util";

import { KV } from "./lib/dbutil";

const db = new KV("noted", "keyval");

export class Note {
  // notes can have the same title so we need a unique id
  noteId = "";
  title = "";
  type = "md";
  dailyNote = false;
  immutableTitle = false;
  /** @type [string][] */ // array of sha1
  versions = [];

  constructor(title) {
    this.noteId = genRandomID(8);
    this.title = title;
  }
}

export function noteGetTite(note) {
  return note.title;
}

export function noteGetType(note) {
  return note.type;
}

export function noteGetID(note) {
  return note.noteId;
}

const keyPrefixContent = "content:"; // + sha1(content)
const keyNotes = "notes";

let cachedNotes = [];

/**
 * @returns {Promise<Note[]>}
 */
export async function getNotes() {
  if (len(cachedNotes) > 0) {
    return cachedNotes;
  }
  let res = (await db.get(keyNotes)) || [];
  console.log("getNotes:", res);
  cachedNotes = res;
  return res;
}

/**
 * @param {Note[]} notes
 */
export async function setNotes(notes) {
  console.log("setNotes:", notes);
  await db.set(keyNotes, notes);
}

export async function addNoteVersion(note, content) {
  console.log("addNoteVersion:", note, len(content));
  let hash = await sha1(content);
  let key = keyPrefixContent + hash;
  try {
    await db.add(key, content);
  } catch (e) {
    console.log(e);
  }
  note.versions.push(hash);
  await setNotes(cachedNotes);
  return cachedNotes;
}

export async function newNote(title, type = "md") {
  let note = new Note();
  note.title = title;
  note.type = type;
  cachedNotes.push(note);
  await setNotes(cachedNotes);
  return note;
}

export async function setNoteTitle(note, title) {
  console.log(`setNoteTitle: curr: '${note.title}', new: '${title}'`);
  if (note.title === title) {
    return;
  }
  note.title = title;
  await setNotes(cachedNotes);
  return cachedNotes;
}

/**
 * @param {Note} note
 * @returns {Promise<string>}
 */
export async function getNoteCurrentVersion(note) {
  console.log("getNoteCurrentVersion:", note);
  let n = len(note.versions);
  if (n === 0) {
    return "";
  }
  let hash = note.versions[n - 1];
  let key = keyPrefixContent + hash;
  /** @type {string} */
  let content = await db.get(key);
  return content;
}

// /** @type {import("svelte/store").Writable<Note[]>} */
// export let notes = makeIndexedDBStore(db, "notes", [], false, true);

// export async function addNoteVersion(note, content) {
//   console.log("addNoteVersion:", note, len(content));
//   let hash = sha1(content);
//   let key = keyPrefixContent + hash;
//   await db.add(key, content);
//   note.versions.push(hash);
//   resaveStore(notes);
// }

// export function setNoteTitle(note, title) {
//   console.log(`setNoteTitle: curr: '${note.title}', new: '${title}'`);
//   if (note.title === title) {
//     return;
//   }
//   note.title = title;
//   resaveStore(notes);
// }

// /**
//  * @param {Note} note
//  * @returns {Promise<string>}
//  */
// export async function getNoteCurrentVersion(note) {
//   console.log("getNoteCurrentVersion:", note);
//   let n = len(note.versions);
//   if (n === 0) {
//     return "";
//   }
//   let hash = note.versions[n - 1];
//   let key = keyPrefixContent + hash;
//   /** @type {string} */
//   let content = await db.get(key);
//   return content;
// }
