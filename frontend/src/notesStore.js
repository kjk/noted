import { KV, createKVStoresDB } from "./lib/dbutil";
import { blobToUtf8, len, startTimer, utf8ToBlob } from "./lib/util";

import { decode } from "js-base64";
import { log } from "./lib/log";
import { nanoid } from "./lib/nanoid";

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
const kNoteIdxSize = 7;
const kNoteFieldsCount = 8;

const kNoteIDLength = 6; // was 8 at some point
const kNoteCotentIDLength = 4;

function logEntrySame(e1, e2) {
  let n = len(e1);
  if (n !== len(e2)) {
    return false;
  }
  for (let i = 0; i < n; i++) {
    if (e1[i] !== e2[i]) {
      return false;
    }
  }
  return true;
}

/**
 * @returns {string}
 */
export function genRandomNoteID() {
  return nanoid(kNoteIDLength);
}

/**
 * @param {string} noteID
 * @returns {string}
 */
function makeRandomContentID(noteID) {
  return noteID + "-" + nanoid(kNoteCotentIDLength);
}

// each log entry is an array
// first element is kind of an op
// second is time in milliseconds since epoch (jan 1 1970 UTC)
// folllowed by data for for a given kind of log entry
// for notes, the first elment of data is note id
/**
 * @param {string} title
 * @param {string} kind
 * @param {boolean} isDaily
 * @returns {any[]}
 */
function mkLogCreateNote(title, kind, isDaily = false) {
  let id = genRandomNoteID();
  return [kLogCreateNote, Date.now(), id, title, kind, isDaily];
}

/**
 * @param {string} id
 * @param {string} newTitle
 * @returns {any[]}
 */
function mkLogChangeTitle(id, newTitle) {
  return [kLogChangeTitle, Date.now(), id, newTitle];
}

/**
 * @param {string} id
 * @param {string} contentId
 * @param {number} size
 * @returns {any[]}
 */
function mkLogChangeContent(id, contentId, size) {
  return [kLogChangeContent, Date.now(), id, contentId, size];
}

/**
 * @param {string} id
 * @param {string} kind
 * @returns {any[]}
 */
function mkLogChangeKind(id, kind) {
  return [kLogChangeKind, Date.now(), id, kind];
}

/**
 * @param {string} id
 * @returns {any[]}
 */
function mkLogDeleteNote(id) {
  return [kLogDeleteNote, Date.now(), id];
}

// derives from string, valueOf() is id
export class Note extends String {}

export function isNote(o) {
  return Note.prototype.isPrototypeOf(o);
}

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
   * @param {any[]} e
   * @returns {any}
   */
  applyLog(e) {
    // log("applyLog", e);
    let op = e[0];
    let createdAt = e[1];
    let updatedAt = createdAt;
    let id = e[2];
    if (op === kLogCreateNote) {
      let title = e[3] || "";
      let kind = e[4];
      let isDaily = e[5];
      let note = new Note(id);
      let idx = len(this.notesFlattened);
      this.notesMap.set(id, idx);
      // log(
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
      log(
        `applyLog: note ${id}, op: ${op} (${opName}) not found. Was deleted?`
      );
      return;
    }

    let idx = this.notesMap.get(id);
    if (op === kLogChangeTitle) {
      let title = e[3];
      this.notesFlattened[idx + kNoteIdxTitle] = title;
      this.notesFlattened[idx + kNoteIdxUpdatedAt] = updatedAt;
    } else if (op === kLogChangeContent) {
      let contentSha1 = e[3];
      // compat: older entries didn't have size
      let size = 0;
      if (len(e) > 4) {
        size = e[4];
      }
      this.notesFlattened[idx + kNoteIdxLLatestVersionId] = contentSha1;
      this.notesFlattened[idx + kNoteIdxUpdatedAt] = updatedAt;
      this.notesFlattened[idx + kNoteIdxSize] = size;
    } else if (op === kLogChangeKind) {
      let kind = e[3];
      this.notesFlattened[idx + kNoteIdxKind] = kind;
      this.notesFlattened[idx + kNoteIdxUpdatedAt] = updatedAt;
    } else if (op === kLogDeleteNote) {
      // log("deleteNoteById:", id);
      this.notesMap.delete(id);
      // rewrite in place for perf
      let nNotes = len(this.notes);
      let curr = 0;
      for (let note of this.notes) {
        let noteID = note.valueOf();
        if (noteID === id) {
          continue;
        }
        this.notes[curr] = note;
        curr++;
      }
      this.notes.length = nNotes - 1;
      return this.notes;
    } else {
      throw new Error(`unknown log op ${op}`);
    }
  }

  getNotesSync() {
    return this.notes;
  }

  getValueAtIdx(note, idxVal) {
    let id = note.valueOf();
    let idx = this.notesMap.get(id);
    let res = this.notesFlattened[idx + idxVal];
    return res;
  }

  /**
   * @param {Note} note
   * @returns {string}
   */
  getNoteTitle(note) {
    return this.getValueAtIdx(note, kNoteIdxTitle);
  }

  /**
   * @param {Note} note
   * @returns {number}
   */
  getNoteLastModified(note) {
    return this.getValueAtIdx(note, kNoteIdxUpdatedAt);
  }

  /**
   * @param {Note} note
   * @returns {number}
   */
  getNoteSize(note) {
    return this.getValueAtIdx(note, kNoteIdxSize);
  }

  /**
   * @param {Note} note
   * @returns {string}
   */
  getNoteLatestVersionId(note) {
    return this.getValueAtIdx(note, kNoteIdxLLatestVersionId);
  }
}

// log keys are in format `log:${num}`
function sortLogKeys(keys) {
  keys.sort((a, b) => {
    let aNum = parseInt(a.substr(4));
    let bNum = parseInt(b.substr(4));
    return aNum - bNum;
  });
}

async function getKVLogs(kvLogs) {
  let keys = await kvLogs.keys();
  if (len(keys) == 0) {
    return null;
  }
  sortLogKeys(keys);
  let res = [];
  for (let key of keys) {
    // log("key:", key);
    // @ts-ignore
    let logs = await kvLogs.get(key);
    res.push([key, logs]);
  }
  return res;
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
  kvLogs;

  currKey = "log:0";
  currLogs = [];

  constructor() {
    super();
    this.db = createKVStoresDB("noted-local", ["content", "logs"]);
    this.kvContent = new KV(this.db, "content");
    this.kvLogs = new KV(this.db, "logs");
  }

  /**
   * @returns {Promise<Note[]>}
   */
  async getNotes() {
    if (len(this.notes) > 0) {
      return this.notes;
    }

    let a = await getKVLogs(this.kvLogs);
    if (a === null) {
      return [];
    }
    for (let e of a) {
      this.currKey = e[0];
      this.currLogs = e[1];
      for (let log of this.currLogs) {
        this.applyLog(log);
      }
    }
    return this.notes;
  }

  /**
   * @param {any[]} e
   * @returns {Promise<any>}
   */
  async appendAndApplyLog(e) {
    // log("appendLog:", e, "size:", len(this.currLogs));
    this.currLogs.push(e);
    // log("currLogs:", this.currLogs);
    await this.kvLogs.set(this.currKey, this.currLogs);
    let nLogs = len(this.currLogs);
    if (nLogs >= kLogEntriesPerKey) {
      let currId = parseInt(this.currKey.substring(4));
      let nextId = currId + 1;
      this.currKey = "log:" + nextId;
      log("newKey:", this.currKey);
      this.currLogs = [];
    }
    return this.applyLog(e);
  }

  async newNote(title, type = "md") {
    let e = mkLogCreateNote(title, type);
    let note = await this.appendAndApplyLog(e);
    // log("newNote:", note);
    return note;
  }

  /**
   * @param {Note} note
   * @returns {Promise<string>}
   */
  async getNoteLatestVersion(note) {
    let contentId = this.getNoteLatestVersionId(note);
    if (!contentId) {
      return null;
    }
    let res = await this.kvContent.get(contentId);
    // for compat we must handle string
    if (typeof res === "string") {
      return res;
    }
    let s = await blobToUtf8(res);
    return s;
  }

  /**
   * @param {Note} note
   * @param {string} content
   */
  async addNoteVersion(note, content) {
    let id = note.valueOf();
    let contentId = makeRandomContentID(id);
    let blob = utf8ToBlob(content);
    let size = blob.size;
    let e = mkLogChangeContent(id, contentId, size);
    await this.kvContent.set(contentId, blob);
    await this.appendAndApplyLog(e);
  }

  /**
   * @param {Note} note
   * @param {string} title
   */
  async setNoteTitle(note, title) {
    let id = note.valueOf();
    let e = mkLogChangeTitle(id, title);
    await this.appendAndApplyLog(e);
  }

  /**
   * @param {Note} note
   * @returns {Promise<Note[]>}
   */
  async deleteNote(note) {
    let id = note.valueOf();
    let e = mkLogDeleteNote(id);
    let notes = await this.appendAndApplyLog(e);
    return notes;
  }
}

export class StoreRemote extends StoreCommon {
  db;
  // database for storing content of notes
  // the key is random 12-byte id and the value is
  // string or binary content
  /** @type {KV} */
  kvContentCache;
  /** @type {KV} */
  kvLogsCache;

  constructor() {
    super();

    this.db = StoreRemote.openDB();

    this.kvContentCache = new KV(this.db, "content-cache");
    this.kvLogsCache = new KV(this.db, "logs-cache");
  }

  static openDB() {
    let db = createKVStoresDB("noted-remote", [
      "content-cache",
      "logs-cache",

      "content-temp",
      "logs-temp",
    ]);
    return db;
  }

  static async deleteCache() {
    log("StoreRemote.deleteCache");
    let db = StoreRemote.openDB();
    let kv = new KV(db, "content-cache");
    await kv.clear();
    kv = new KV(db, "logs-cache");
    await kv.clear();
    // kv = new KV(db, "content-temp")
    // await kv.clear()
    // kv = new KV(db, "logs-temp")
    // await kv.clear()
  }

  async storeGetLogs(start) {
    let elapsed = startTimer();
    if (!start) {
      start = 0;
    }
    let uri = "/api/store/getLogs?start=" + start;
    let opts = {};
    let resp = await fetch(uri, opts);
    let logs = await resp.json();
    log(`storeGetLogs: ${len(logs)} log entries, took ${elapsed()} ms`);
    return logs;
  }

  async storeAppendLog(e) {
    let elapsed = startTimer();
    let uri = "/api/store/appendLog";
    let opts = {
      method: "POST",
      body: JSON.stringify(e),
    };
    let resp = await fetch(uri, opts);
    let ok = await resp.json();
    log(`storeAppendLog: took ${elapsed()} ms`, e);
    return ok;
  }

  async storeGetContent(id) {
    let elapsed = startTimer();
    let uri = "/api/store/getContent?id=" + id;
    let opts = {};
    let resp = await fetch(uri, opts);
    let blob = await resp.blob();
    log(`storeGetContent: took ${elapsed()} ms`, id, blob.size);
    return blob;
  }

  async storeSetContent(value, id) {
    let uri = "/api/store/setContent?id=" + encodeURIComponent(id);
    let opts = {
      method: "POST",
      body: value,
    };
    let resp = await fetch(uri, opts);
    await resp.json();
  }

  async updateContentCache() {
    let elapsed = startTimer();
    let ids = await this.kvContentCache.keys();
    log(
      `updateContentCache: ${len(ids)} cached blobs for ${len(
        this.notes
      )} notes`
    );
    let existing = new Map();
    for (let id of ids) {
      existing.set(id, true);
    }
    let missing = [];

    for (let note of this.notes) {
      let contentID = this.getNoteLatestVersionId(note);
      if (!contentID) {
        log(`updateContentCache: note ${note} has no contentID`);
        continue;
      }
      if (existing.has(contentID)) {
        existing.delete(contentID);
      } else {
        missing.push(contentID);
      }
    }
    let toDelete = [...existing.keys()];
    log(
      `updateContentCache: ${len(missing)} missing blobs, ${len(
        toDelete
      )} toDelete blobs`
    );
    for (let id of toDelete) {
      await this.kvContentCache.del(id);
      log(`updateContentCache: deleted blob ${id}`);
    }
    let blobPromises = [];
    for (let id of missing) {
      let p = this.storeGetContent(id);
      blobPromises.push(p);
    }
    let n = len(missing);
    for (let i = 0; i < n; i++) {
      let blob = await blobPromises[i];
      let id = missing[i];
      await this.kvContentCache.set(id, blob);
      log(`updateContentCache: cached blob ${id} ${blob.size} bytes`);
    }
    log(`updateContentCache: took ${elapsed()} ms`);
  }

  /**
   * @returns {Promise<Note[]>}
   */
  async getNotes() {
    if (len(this.notes) > 0) {
      return this.notes;
    }

    let start = 0;
    let a = await getKVLogs(this.kvLogsCache);
    let allLogs = [];
    if (a !== null) {
      for (let e of a) {
        let logs = e[1];
        start += len(logs);
        allLogs.push(...logs);
      }
    }

    // TODO: ask for start - 1, compare last log entry we have
    // with the first one we get from the server, if they are
    // different, we need to reget everything as it means
    // we got out of sync with the server
    let logsFromServer = await this.storeGetLogs(start);
    if (start + len(logsFromServer) == 0) {
      return [];
    }
    log(`getNotes: start: ${start}, logs from server: ${len(logsFromServer)} `);
    allLogs.push(...logsFromServer);
    let elapsed = startTimer();
    for (let e of allLogs) {
      this.applyLog(e);
    }
    let logsPerKey = [];
    if (len(logsFromServer) > 0) {
      log(`getNotes: re-saving log entries in cache`);
      while (len(allLogs) > kLogEntriesPerKey) {
        let logs = allLogs.splice(0, kLogEntriesPerKey);
        logsPerKey.push(logs);
      }
      if (len(allLogs) > 0) {
        logsPerKey.push(allLogs);
      }
    }
    let keyNo = 0;
    for (let logs of logsPerKey) {
      let key = "log:" + keyNo;
      await this.kvLogsCache.set(key, logs);
      log(
        `getNotes: saved ${len(logs)} log entries in cache under key: ${key}`
      );
      keyNo++;
    }

    log(`getNotes: applyLog took ${elapsed()} ms`);
    await this.updateContentCache();
    return this.notes;
  }

  async appendAndApplyLog(e) {
    // log("appendLog:", log, "size:", len(this.currLogs));
    // log("currLogs:", this.currLogs);
    // log("appendLog:", log);
    await this.storeAppendLog(e);
    return this.applyLog(e);
  }

  async newNote(title, type = "md") {
    let e = mkLogCreateNote(title, type);
    let note = await this.appendAndApplyLog(e);
    log("newNote:", note);
    return note;
  }

  /**
   * @param {Note} note
   * @returns {Promise<string>}
   */
  async getNoteLatestVersion(note) {
    let contentId = this.getNoteLatestVersionId(note);
    if (!contentId) {
      return null;
    }
    let blob = await this.kvContentCache.get(contentId);
    if (!blob) {
      blob = await this.storeGetContent(contentId);
      this.kvContentCache.set(contentId, blob);
    }
    let s = await blobToUtf8(blob);
    return s;
  }

  async addNoteVersion(note, content) {
    let id = note.valueOf();
    let contentId = makeRandomContentID(id);
    let blob = utf8ToBlob(content);
    let size = blob.size;
    await this.storeSetContent(blob, contentId);
    let e = mkLogChangeContent(id, contentId, size);
    await this.appendAndApplyLog(e);
    await this.kvContentCache.set(contentId, blob);
  }

  async setNoteTitle(note, title) {
    let id = note.valueOf();
    let e = mkLogChangeTitle(id, title);
    await this.appendAndApplyLog(e);
  }

  /**
   * @param {Note} note
   * @returns {Promise<Note[]>}
   */
  async deleteNote(note) {
    let id = note.valueOf();
    let e = mkLogDeleteNote(id);
    let notes = await this.appendAndApplyLog(e);
    return notes;
  }
}

export function deleteRemoteStoreCache() {
  StoreRemote.deleteCache();
}

/** @type {StoreLocal | StoreRemote} */
export let store = null;

export function changeToRemoteStore() {
  store = new StoreRemote();
}

export function changeToLocalStore() {
  store = new StoreLocal();
}

/**
 * @returns {Promise<Note[]>}
 */
export async function getNotes() {
  return store.getNotes();
}

/**
 * @returns {Note[]}
 */
export function getNotesSync() {
  return store.getNotesSync();
}

/**
 *
 * @param {string} title
 * @param {string} type
 * @returns {Promise<Note>}
 */
export async function newNote(title, type = "md") {
  return store.newNote(title, type);
}

/**
 * @param {Note} note
 * @param {string} content
 */
export async function addNoteVersion(note, content) {
  let currContent = await store.getNoteLatestVersion(note);
  if (currContent == content) {
    log("skipping addVersion, content is the same");
    return;
  }
  return store.addNoteVersion(note, content);
}

/**
 * @param {Note} note
 * @returns {string}
 */
export function getNoteID(note) {
  return note.valueOf();
}

/**
 * @param {Note} note
 * @returns {string}
 */
export function getNoteTitle(note) {
  return store.getNoteTitle(note);
}

/**
 * @param {Note} note
 * @param {string} title
 */
export function setNoteTitle(note, title) {
  let currTitle = store.getNoteTitle(note);
  if (currTitle == title) {
    return;
  }
  return store.setNoteTitle(note, title);
}

/**
 * @param {Note} note
 * @returns {Promise<Note[]>}
 */
export async function deleteNote(note) {
  return store.deleteNote(note);
}

/**
 * @param {Note} note
 * @returns {Promise<string>}
 */
export async function getNoteLatestVersion(note) {
  return store.getNoteLatestVersion(note);
}

/**
 * @param {Note} note
 * @returns {number}
 */
export function getNoteLastModified(note) {
  return store.getNoteLastModified(note);
}

/**
 * @param {Note} note
 * @returns {number}
 */
export function getNoteSize(note) {
  return store.getNoteSize(note);
}

/**
 * @returns {Note}
 */
export function getLastModifiedNote() {
  let notes = getNotesSync();
  let time = 0;
  let res = null;
  for (let n of notes) {
    let t = getNoteLastModified(n);
    if (t > time) {
      time = t;
      res = n;
    }
  }
  return res;
}

const idSep = "~";

/**
 * @param {string} encodedTitle
 * @returns {[string, string]}
 */
export function parseEncodedTitle(encodedTitle) {
  let sepIdx = encodedTitle.lastIndexOf(idSep);
  if (sepIdx < 0) {
    // if there's no separator, it could be a title or a noteID
    return [encodedTitle, encodedTitle];
  }
  let title = encodedTitle.substring(0, sepIdx);
  let id = encodedTitle.substring(sepIdx + 1);
  return [title, id];
}

/**
 * @param {string} id
 * @returns {Note}
 */
export function getNoteByID(id) {
  if (!id) {
    return null;
  }
  let notes = store.getNotesSync();
  for (let n of notes) {
    if (n.valueOf() === id) {
      return n;
    }
  }
  return null;
}

/**
 * title could be ${noteID}, ${title}-${noteID}
 * @param {string} encodedTitle
 * @returns {Note}
 */
export function getNoteByEncodedTitle(encodedTitle) {
  let notes = store.getNotesSync();
  // log("getNoteByTitle:", encodedTitle, "notes: ", len(notes));

  let [title, id] = parseEncodedTitle(encodedTitle);
  let note = getNoteByID(id);
  if (note) {
    return note;
  }
  // log("getNoteByTitle: title:", title, "id:", id);
  // title could have been encoded for url
  let decodedTitle = decodeURIComponent(title);
  for (let n of notes) {
    let noteTitle = getNoteTitle(n);
    if (
      noteTitle === title ||
      noteTitle === decodedTitle ||
      noteTitle === encodedTitle
    ) {
      return n;
    }
  }
  if (decodedTitle === title || decodedTitle === encodedTitle) {
    return null;
  }
  // note: this migh return false positives
  // log("getNoteByTitle: newTitle:", decodedTitle, "id:", id);
  for (let n of notes) {
    let noteTitle = getNoteTitle(n);
    noteTitle = noteTitle.replaceAll("_", " ");
    if (noteTitle == decodedTitle) {
      return n;
    }
  }
  return null;
}

/**
 * title could be ${noteID}, ${title}-${noteID} ${title}
 * @param {string} encodedTitle
 * @returns {Note}
 */
export function getNoteByTitleOrID(encodedTitle) {
  let notes = store.getNotesSync();

  let [title, id] = parseEncodedTitle(encodedTitle);
  // log("getNoteByTitleOrID: title:", title, "id:", id, "notes:", len(notes));
  let note = getNoteByID(id);
  if (note) {
    return note;
  }
  // title could have been encoded for url
  for (let n of notes) {
    let noteTitle = getNoteTitle(n);
    if (noteTitle === title || noteTitle === encodedTitle) {
      return n;
    }
  }
  // log(`getNoteByTitleOrID: didn't find note`);
  return null;
}
