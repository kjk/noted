import { KV } from "./lib/dbutil";
import { genRandomID } from "./lib/util";

/*
This is a very optimized way of storing notes both in memory
as well as in storage.
To minimize latency notes are stored as an append-only log.
We store 1024 of log entries per key in a key-value store.
This is espeically important for a remote store, like Redis (upstash)
but probably is also important for using indexedb.
We reconstruct current state of notes in memory by re-playing the log.
In memory we store notes as a large array.
*/

const kLogCreateNote = 1;
const kLogChangeTitle = 2;
const kLogChangeContent = 3;
const kLogChangeKind = 4;
const kLogDeleteNote = 5;

const kNoteIdxID = 0;
const kNoteIdxTitle = 1;
const kNoteIdxKind = 2;
const kNoteIdxIsDaily = 3;
const kNoteIdxLLatestVersionSha1 = 4;
const kNoteFieldsCount = 5;

const dbContent = new KV("noted", "content");
const dbNotes = new KV("noted", "notes");

// each log entry is an array
// first element is kind of an op
// second is time in milliseconds since epoch (jan 1 1970 UTC)
// folllowed by data for for a given kind of log entry
// for notes, the first elment of data is note id
function mkLogCreateNote(title, kind, isDaily = false) {
  let id = genRandomID(8);
  return [kLogCreateNote, Date.now(), id, title, kind, isDaily];
}

function mkLogChangedTitle(id, newTitle) {
  return [kLogChangeTitle, Date.now(), id, newTitle];
}

function mkLogChangeContent(id, contentSha1) {
  return [kLogChangeContent, Date.now(), id, contentSha1];
}

function mkLogChangeKind(id, kind) {
  return [kLogChangeKind, Date.now(), id, kind];
}

function mkLogDeleteNote(id) {
  return [kLogDeleteNote, Date.now(), id];
}

// derives from string, valueOf() is id
class Note extends String {}

export class StoreLocal {
  // this is [key, logEntry[]]
  /** @type {[string, any[]][]} */
  log = [];
  // this is reconstructed from log entries
  // TODO: for even more efficiency, use array of arrays
  // to avoid re-allocations. Can pre-allocate e.g.
  // an array for 1024 notes
  /** @type {any[]} */
  notesFlattened = [];
  // maps note id to index inside notesFlattened
  /** @type {Map<string, number>} */
  notesMap = new Map();

  constructor() {}
  /**
   * @returns {Promise<Note[]>}
   */
  async getNotes() {
    return [];
  }
}
