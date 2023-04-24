import { KV, createKVStoresDB } from "./lib/dbutil";
import { blobToUtf8, genRandomID, len, throwIf, utf8ToBlob } from "./lib/util";

import { addToken } from "./lib/githubapi";

const kLogEntriesPerKey = 1024;

/*
This is a very optimized way of storing notes both in memory
as well as in storage.
To minimize latency notes are stored as an append-only log.
We store kLogEntriesPerKey of log entries per key in a key-value store.
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

function logOpName(op) {
  switch (op) {
    case kLogCreateNote:
      return "kLogCreateNote";
    case kLogChangeTitle:
      return "kLogChangeTitle";
    case kLogChangeContent:
      return "kLogChangeContent";
    case kLogChangeKind:
      return "kLogChangeKind";
    case kLogDeleteNote:
      return "kLogDeleteNote";
    default:
      return `unknown op ${op}`;
  }
}

const kNoteIdxID = 0;
const kNoteIdxTitle = 1;
const kNoteIdxKind = 2;
const kNoteIdxIsDaily = 3;
const kNoteIdxLLatestVersionId = 4;
const kNoteIdxCreatedAt = 5;
const kNoteIdxUpdatedAt = 6;
const kNoteFieldsCount = 7;

// each log entry is an array
// first element is kind of an op
// second is time in milliseconds since epoch (jan 1 1970 UTC)
// folllowed by data for for a given kind of log entry
// for notes, the first elment of data is note id
function mkLogCreateNote(title, kind, isDaily = false) {
  let id = genRandomID(8);
  return [kLogCreateNote, Date.now(), id, title, kind, isDaily];
}

function mkLogChangeTitle(id, newTitle) {
  return [kLogChangeTitle, Date.now(), id, newTitle];
}

function mkLogChangeContent(id, contentId) {
  return [kLogChangeContent, Date.now(), id, contentId];
}

function mkLogChangeKind(id, kind) {
  return [kLogChangeKind, Date.now(), id, kind];
}

function mkLogDeleteNote(id) {
  return [kLogDeleteNote, Date.now(), id];
}

// derives from string, valueOf() is id
export class Note extends String {}

class StoreCommon {
  // this is reconstructed from log entries
  // TODO: for even more efficiency, use array of arrays
  // to avoid re-allocations. Can pre-allocate e.g.
  // an array for 1024 notes
  /** @type {any[]} */
  notesFlattened = [];
  // maps note id to index inside notesFlattened
  /** @type {Map<Note, number>} */
  notesMap = new Map();

  /** @type {Note[]} */
  notes = [];

  /**
   * @param {string} id
   */
  deleteNoteById(id) {
    console.log("deleteNoteById:", id);
    // let idx = this.notesMap.get(id);
    // this.notesFlattened.splice(idx, 1);
    this.notesMap.delete(id);
    // TODO: make faster. we can rewrite the array in place
    this.notes = this.notes.filter((n) => n.valueOf() != id);
  }

  applyLog(log) {
    console.log("applyLog", log);
    let op = log[0];
    let createdAt = log[1];
    let updatedAt = createdAt;
    let id = log[2];
    if (op === kLogCreateNote) {
      let title = log[3] || "";
      let kind = log[4];
      let isDaily = log[5];
      let note = new Note(id);
      let idx = len(this.notesFlattened);
      this.notesMap.set(id, idx);
      // console.log(
      //   "added note",
      //   id,
      //   "at idx",
      //   idx,
      //   "title",
      //   title,
      //   "kind",
      //   kind,
      //   "isDaily",
      //   isDaily,
      //   "createdAt",
      //   createdAt,
      //   "updatedAt",
      //   updatedAt,
      //   "contentSha1",
      //   ""
      // );
      this.notesFlattened.push(
        id,
        title,
        kind,
        isDaily,
        null, // latest version id
        createdAt,
        0
      );
      this.notes.push(note);
      return note;
    }

    if (!this.notesMap.has(id)) {
      let opName = logOpName(op);
      console.log(
        `applyLog: note ${id}, op: ${op} (${opName}) not found. Was deleted?`
      );
      return;
    }

    let idx = this.notesMap.get(id);
    if (op === kLogChangeTitle) {
      let title = log[3];
      this.notesFlattened[idx + kNoteIdxTitle] = title;
      this.notesFlattened[idx + kNoteIdxUpdatedAt] = updatedAt;
    } else if (op === kLogChangeContent) {
      let contentSha1 = log[3];
      this.notesFlattened[idx + kNoteIdxLLatestVersionId] = contentSha1;
      this.notesFlattened[idx + kNoteIdxUpdatedAt] = updatedAt;
    } else if (op === kLogChangeKind) {
      let kind = log[3];
      this.notesFlattened[idx + kNoteIdxKind] = kind;
      this.notesFlattened[idx + kNoteIdxUpdatedAt] = updatedAt;
    } else if (op === kLogDeleteNote) {
      this.deleteNoteById(id);
    } else {
      throw new Error(`unknown log op ${op}`);
    }
  }

  getTitle(note) {
    let id = note.valueOf();
    let idx = this.notesMap.get(id);
    return this.notesFlattened[idx + kNoteIdxTitle];
  }

  getLastModified(note) {
    let id = note.valueOf();
    let idx = store.notesMap.get(id);
    return store.notesFlattened[idx + kNoteIdxUpdatedAt];
  }
}

export class StoreLocal extends StoreCommon {
  db;
  // database for storing content of notes
  // the key is random 12-byte id and the value is
  // string or binary content
  /** @type {KV} */
  kvContent;
  // database for storing log entries under multiple keys
  // we store kLogEntriesPerKey in each key
  /** @type {KV} */
  kvNotes;

  currKey = "log:0";
  currLogs = [];

  constructor() {
    super();
    this.db = createKVStoresDB("noted2", ["content", "notes"]);
    this.kvContent = new KV(this.db, "content");
    this.kvNotes = new KV(this.db, "notes");
  }

  /**
   * @returns {Promise<Note[]>}
   */
  async getNotes() {
    if (len(this.notes) > 0) {
      return this.notes;
    }
    let keys = await this.kvNotes.keys();
    if (len(keys) == 0) {
      return [];
    }
    sortKeys(keys);
    for (let key of keys) {
      // console.log("key:", key);
      // @ts-ignore
      this.currKey = key;
      this.currLogs = await this.kvNotes.get(key);
      for (let log of this.currLogs) {
        this.applyLog(log);
      }
    }
    return this.notes;
  }

  async appendLog(log) {
    // console.log("appendLog:", log, "size:", len(this.currLogs));
    this.currLogs.push(log);
    // console.log("currLogs:", this.currLogs);
    await this.kvNotes.set(this.currKey, this.currLogs);
    let nLogs = len(this.currLogs);
    if (nLogs >= kLogEntriesPerKey) {
      let currId = parseInt(this.currKey.substring(4));
      let nextId = currId + 1;
      this.currKey = "log:" + nextId;
      console.log("newKey:", this.currKey);
      this.currLogs = [];
    }
  }

  async newNote(title, type = "md") {
    let log = mkLogCreateNote(title, type);
    await this.appendLog(log);
    let note = this.applyLog(log);
    // console.log("newNote:", note);
    return note;
  }

  async noteGetCurrentVersion(note) {
    let id = note.valueOf();
    let idx = this.notesMap.get(id);
    let contentId = this.notesFlattened[idx + kNoteIdxLLatestVersionId];
    if (!contentId) {
      return null;
    }
    return await this.kvContent.get(contentId);
  }

  async noteAddVersion(note, content) {
    let id = note.valueOf();
    let contentId = genRandomID(12);
    let log = mkLogChangeContent(id, contentId);
    await this.kvContent.set(contentId, content);
    await this.appendLog(log);
  }

  async setTitle(note, title) {
    let id = note.valueOf();
    let log = mkLogChangeTitle(id, title);
    await this.appendLog(log);
  }

  /**
   * @param {Note} note
   * @returns {Promise<Note[]>}
   */
  async deleteNote(note) {
    let id = note.valueOf();
    let log = mkLogDeleteNote(id);
    await this.appendLog(log);
    this.deleteNoteById(id);
    return this.notes;
  }
}

export class StoreRemote extends StoreCommon {
  /** @type {Map<string, Blob>} */
  content = new Map();
  constructor() {
    super();
  }

  async storeGetLogs() {
    let uri = "/api/store/getLogs";
    let opts = addToken({});
    let resp = await fetch(uri, opts);
    let logs = await resp.json();
    return logs;
  }

  async storeAppendLog(log) {
    console.log("storeAppendLog:", log);
    let uri = "/api/store/appendLog";
    let opts = addToken({
      method: "POST",
      body: JSON.stringify(log),
    });
    let resp = await fetch(uri, opts);
    let ok = await resp.json();
    return ok;
  }

  async storeGetContent(id) {
    let uri = "/api/store/getContent?id=" + id;
    let opts = addToken({});
    let resp = await fetch(uri, opts);
    let value = await resp.blob();
    return value;
  }

  async storeSetContent(value) {
    let uri = "/api/store/setContent";
    let opts = addToken({
      method: "POST",
      body: value,
    });
    let resp = await fetch(uri, opts);
    let js = await resp.json();
    return js.id;
  }

  /**
   * @returns {Promise<Note[]>}
   */
  async getNotes() {
    if (len(this.notes) > 0) {
      return this.notes;
    }
    let logs = await this.storeGetLogs();
    if (len(logs) == 0) {
      return [];
    }
    console.log(`getNotes: ${len(logs)} log entries`);
    for (let log of logs) {
      this.applyLog(log);
    }
    return this.notes;
  }

  async appendLog(log) {
    // console.log("appendLog:", log, "size:", len(this.currLogs));
    // console.log("currLogs:", this.currLogs);
    // console.log("appendLog:", log);
    await this.storeAppendLog(log);
    return this.applyLog(log);
  }

  async newNote(title, type = "md") {
    let log = mkLogCreateNote(title, type);
    let note = await this.appendLog(log);
    console.log("newNote:", note);
    return note;
  }

  async noteGetCurrentVersion(note) {
    let id = note.valueOf();
    let idx = this.notesMap.get(id);
    let contentId = this.notesFlattened[idx + kNoteIdxLLatestVersionId];
    if (!contentId) {
      return null;
    }
    let blob;
    if (this.content.has(contentId)) {
      blob = this.content.get(contentId);
    } else {
      blob = await this.storeGetContent(contentId);
      this.content.set(contentId, blob);
    }
    let s = await blobToUtf8(blob);
    return s;
  }

  async noteAddVersion(note, content) {
    let id = note.valueOf();
    let blob = utf8ToBlob(content);
    let contentId = await this.storeSetContent(blob);
    let log = mkLogChangeContent(id, contentId);
    await this.appendLog(log);
    this.content.set(contentId, blob);
  }

  getTitle(note) {
    let id = note.valueOf();
    let idx = this.notesMap.get(id);
    return this.notesFlattened[idx + kNoteIdxTitle];
  }

  async setTitle(note, title) {
    let id = note.valueOf();
    let log = mkLogChangeTitle(id, title);
    await this.appendLog(log);
  }

  /**
   * @param {Note} note
   * @returns {Promise<Note[]>}
   */
  async deleteNote(note) {
    let id = note.valueOf();
    let log = mkLogDeleteNote(id);
    await this.appendLog(log);
    return this.notes;
  }
}

function sortKeys(keys) {
  keys.sort((a, b) => {
    let aNum = parseInt(a.substr(4));
    let bNum = parseInt(b.substr(4));
    return aNum - bNum;
  });
}

/** @type {StoreLocal | StoreRemote} */
export let store = new StoreLocal();

export function changeToRemoteStore() {
  store = new StoreRemote();
}

export function changeToLocalStore() {
  store = new StoreLocal();
}

export async function getNotes() {
  return store.getNotes();
}

export async function newNote(title, type = "md") {
  return store.newNote(title, type);
}

export async function noteAddVersion(note, content) {
  let currContent = await store.noteGetCurrentVersion(note);
  if (currContent == content) {
    console.log("skipping addVersion, content is the same");
    return;
  }
  return store.noteAddVersion(note, content);
}

export function noteGetTitle(note) {
  return store.getTitle(note);
}

export function noteSetTitle(note, title) {
  let currTitle = store.getTitle(note);
  if (currTitle == title) {
    return;
  }
  return store.setTitle(note, title);
}

export async function noteDelete(note) {
  return store.deleteNote(note);
}

export function noteGetCurrentVersion(note) {
  return store.noteGetCurrentVersion(note);
}

export function noteGetLastModified(note) {
  return store.getLastModified(note);
}
