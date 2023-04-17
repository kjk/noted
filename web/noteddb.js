import { genRandomID, len, sha1, throwIf } from "./lib/util";

import { KV } from "./lib/dbutil";

const db = new KV("noted", "keyval");

export class Note {
  // notes can have the same title so we need a unique id
  noteId = "";
  title = "";
  type = "md";
  dailyNote = false;
  immutableTitle = false;
  /** @type {string[]} */ // array of sha1
  versions = [];

  constructor(title) {
    this.noteId = genRandomID(8);
    this.title = title;
  }
}

/**
 * @param {Note2} n
 * @returns {Note}
 */
function toNote(n) {
  let idx = n.valueOf();
  return realNotes[idx];
}

export class Note2 extends Number {
  get title() {
    let n = toNote(this);
    return n.title;
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

/** @type {Note2[]} */
let cachedNotes = [];

/**  @type { Note[]} */
let realNotes = [];

/**
 * @returns {Promise<Note2[]>}
 */
export async function getNotes() {
  if (len(cachedNotes) > 0) {
    return cachedNotes;
  }
  /** @types {Note[]} */
  let res = (await db.get(keyNotes)) || [];
  console.log("getNotes:", res);
  realNotes = res;
  let n = len(realNotes);
  throwIf(len(cachedNotes) > 0);
  for (let i = 0; i < n; i++) {
    let n = new Note2(i);
    cachedNotes.push(n);
  }
  return cachedNotes;
}

/**
 * @param {Note[]} notes
 */
async function saveNotes(notes) {
  console.log("setNotes:", notes);
  await db.set(keyNotes, notes);
}

/**
 *
 * @param {Note2} n
 * @param {string} content
 * @returns {Promise<Note2[]>}
 */
export async function addNoteVersion(n, content) {
  let note = toNote(n);
  console.log("addNoteVersion:", note, len(content));
  let hash = await sha1(content);
  let key = keyPrefixContent + hash;
  try {
    await db.add(key, content);
  } catch (e) {
    console.log(e);
  }
  note.versions.push(hash);
  await saveNotes(realNotes);
  return cachedNotes;
}

/**
 *
 * @param {string} title
 * @param {string} type
 * @returns {Promise<Note2>}
 */
export async function newNote(title, type = "md") {
  let note = new Note();
  note.title = title;
  note.type = type;
  let idx = len(realNotes);
  let n = new Note2(idx);
  realNotes.push(note);
  await saveNotes(realNotes);
  cachedNotes.push(n);
  return n;
}

/**
 *
 * @param {Note2} n
 * @param {string} title
 * @returns {Promise<Note2[]>}
 */
export async function setNoteTitle(n, title) {
  let note = realNotes[n.valueOf()];
  console.log(`setNoteTitle: curr: '${note.title}', new: '${title}'`);
  if (note.title === title) {
    return;
  }
  note.title = title;
  await saveNotes(realNotes);
  return cachedNotes;
}

/**
 * @param {Note2} n
 * @returns {Promise<string>}
 */
export async function getNoteCurrentVersion(n) {
  let note = toNote(n);
  console.log("getNoteCurrentVersion:", note);
  let nNotes = len(note.versions);
  if (nNotes === 0) {
    return "";
  }
  let hash = note.versions[nNotes - 1];
  let key = keyPrefixContent + hash;
  /** @type {string} */
  let content = await db.get(key);
  return content;
}
