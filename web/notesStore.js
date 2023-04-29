import { KV, createKVStoresDB } from "./lib/dbutil";
import { blobToUtf8, len, startTimer, utf8ToBlob } from "./lib/util";

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
  return nanoid(6);
}

/**
 * @param {string} noteID
 * @returns {string}
 */
function makeRandomContentID(noteID) {
  return noteID + "-" + nanoid(4);
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

  getTitle(note) {
    return this.getValueAtIdx(note, kNoteIdxTitle);
  }

  getLastModified(note) {
    return this.getValueAtIdx(note, kNoteIdxUpdatedAt);
  }

  getSize(note) {
    return this.getValueAtIdx(note, kNoteIdxSize);
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

  async noteGetCurrentVersion(note) {
    let id = note.valueOf();
    let idx = this.notesMap.get(id);
    let contentId = this.notesFlattened[idx + kNoteIdxLLatestVersionId];
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
  async noteAddVersion(note, content) {
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
  async setTitle(note, title) {
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

    this.db = createKVStoresDB("noted-remote", [
      "content-cache",
      "logs-cache",

      "content-temp",
      "logs-temp",
    ]);

    this.kvContentCache = new KV(this.db, "content-cache");
    this.kvLogsCache = new KV(this.db, "logs-cache");
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
      let contentID = this.getCurrentVersionId(note);
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
   *
   * @param {Note} note
   * @returns {string}
   */
  getCurrentVersionId(note) {
    let id = note.valueOf();
    let idx = this.notesMap.get(id);
    let contentId = this.notesFlattened[idx + kNoteIdxLLatestVersionId];
    return contentId; // can be null
  }

  /**
   * @param {Note} note
   * @returns {Promise<string>}
   */
  async noteGetCurrentVersion(note) {
    let contentId = this.getCurrentVersionId(note);
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

  async noteAddVersion(note, content) {
    let id = note.valueOf();
    let contentId = makeRandomContentID(id);
    let blob = utf8ToBlob(content);
    let size = blob.size;
    await this.storeSetContent(blob, contentId);
    let e = mkLogChangeContent(id, contentId, size);
    await this.appendAndApplyLog(e);
    await this.kvContentCache.set(contentId, blob);
  }

  getTitle(note) {
    let id = note.valueOf();
    let idx = this.notesMap.get(id);
    return this.notesFlattened[idx + kNoteIdxTitle];
  }

  async setTitle(note, title) {
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

/** @type {StoreLocal | StoreRemote} */
export let store = null;

export function changeToRemoteStore() {
  store = new StoreRemote();
}

export function changeToLocalStore() {
  store = new StoreLocal();
}

export async function getNotes() {
  return store.getNotes();
}

export function getNotesSync() {
  return store.getNotesSync();
}

export async function newNote(title, type = "md") {
  return store.newNote(title, type);
}

export async function noteAddVersion(note, content) {
  let currContent = await store.noteGetCurrentVersion(note);
  if (currContent == content) {
    log("skipping addVersion, content is the same");
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

export function noteGetSize(note) {
  return store.getSize(note);
}
