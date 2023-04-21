import { genRandomID, len } from "./lib/util";

import { KV } from "./lib/dbutil";

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
class Note extends String {}

export class StoreLocal {
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

  // database for storing content of notes
  // the key is random 12-byte id and the value is
  // string or binary content
  /** @type {KV} */
  dbContent;
  // database for storing log entries under multiple keys
  // we store kLogEntriesPerKey in each key
  /** @type {KV} */
  dbNotes;

  currKey = "log:0";
  currLogs = [];

  constructor() {
    this.dbContent = new KV("noted", "content");
    this.dbNotes = new KV("noted", "notes");
  }

  applyLog(log) {
    let op = log[0];
    if (op == kLogCreateNote) {
      let createdAt = log[1];
      let id = log[2];
      let title = log[3];
      let kind = log[4];
      let isDaily = log[5];
      let note = new Note(id);
      let idx = len(this.notesFlattened);
      this.notesMap.set(note, idx);
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
    } else if (op == kLogChangeTitle) {
      let updatetAt = log[1];
      let id = log[2];
      let title = log[3];
      let idx = this.notesMap.get(id);
      this.notesFlattened[idx + kNoteIdxTitle] = title;
      this.notesFlattened[idx + kNoteIdxUpdatedAt] = updatetAt;
    } else if (op == kLogChangeContent) {
      let updatetAt = log[1];
      let id = log[2];
      let contentSha1 = log[3];
      let idx = this.notesMap.get(id);
      this.notesFlattened[idx + kNoteIdxLLatestVersionId] = contentSha1;
      this.notesFlattened[idx + kNoteIdxUpdatedAt] = updatetAt;
    } else if (op == kLogChangeKind) {
      let updatetAt = log[1];
      let id = log[2];
      let kind = log[3];
      let idx = this.notesMap.get(id);
      this.notesFlattened[idx + kNoteIdxKind] = kind;
      this.notesFlattened[idx + kNoteIdxUpdatedAt] = updatetAt;
    } else if (op == kLogDeleteNote) {
      // let updatetAt = log[1];
      let id = log[2];
      // let idx = this.notesMap.get(id);
      // this.notesFlattened.splice(idx, 1);
      this.notesMap.delete(id);
      // TODO: make faster
      this.notes = this.notes.filter((n) => n.valueOf() != id);
    }
  }

  /**
   * @returns {Promise<Note[]>}
   */
  async getNotes() {
    if (len(this.notes) > 0) {
      return this.notes;
    }
    let keys = await this.dbNotes.keys();
    if (len(keys) == 0) {
      return [];
    }
    sortKeys(keys);
    for (let key of keys) {
      let logs = await this.dbNotes.get(key);
      for (let log of logs) {
        this.applyLog(log);
      }
    }
    return this.notes;
  }

  async appendLog(log) {
    this.currLogs.push(log);
    await this.dbNotes.set(this.currKey, JSON.stringify(log));
    if (len(this.currLogs) >= kLogEntriesPerKey) {
      this.currKey = "log:" + (parseInt(this.currKey.substr(4)) + 1);
      this.currLogs = [];
    }
  }

  async newNote(title, type = "md") {
    let log = mkLogCreateNote(title, type);
    await this.appendLog(log);
  }

  async noteGetCurrentVersion(note) {
    let id = note.valueOf();
    let idx = this.notesMap.get(id);
    let contentId = this.notesFlattened[idx + kNoteIdxLLatestVersionId];
    if (!contentId) {
      return null;
    }
    return await this.dbContent.get(contentId);
  }

  async noteAddVersion(note, content) {
    let id = note.valueOf();
    let contentId = genRandomID(12);
    let log = mkLogChangeContent(id, contentId);
    await this.dbContent.set(contentId, content);
    await this.appendLog(log);
  }

  async getTitle(note) {
    let id = note.valueOf();
    let idx = this.notesMap.get(id);
    return this.notesFlattened[idx + kNoteIdxTitle];
  }

  async setTitle(note, title) {
    let id = note.valueOf();
    let log = mkLogChangeTitle(id, title);
    await this.appendLog(log);
  }

  async deleteNote(note) {
    let id = note.valueOf();
    let log = mkLogDeleteNote(id);
    await this.appendLog(log);
  }
}

function sortKeys(keys) {
  keys.sort((a, b) => {
    let aNum = parseInt(a.substr(4));
    let bNum = parseInt(b.substr(4));
    return aNum - bNum;
  });
}

export const storeLocal = new StoreLocal();

export const store = storeLocal;

export function getNotes() {
  return store.getNotes();
}

export function newNote(title, type = "md") {
  return store.newNote(title, type);
}

export function noteAddVersion(note, content) {
  return store.noteAddVersion(note, content);
}

export function noteGetTitle(note) {
  return store.getTitle(note);
}

export function noteSetTitle(note, title) {
  return store.setTitle(note, title);
}

export function noteDelete(note) {
  return store.deleteNote(note);
}
