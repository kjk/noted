import { KV } from "./lib/dbutil";
import { genRandomID } from "./lib/util";

const kLogCreateNote = 1;
const kLogChangeTitle = 2;
const kLogChangeContent = 3;
const kLogChangeKind = 4;

const kNoteIdxID = 0;
const kNoteIdxTitle = 1;
const kNoteIdxKind = 2;
const kNoteIdxIsDaily = 3;
const kNoteIdxLLatestVersionSha1 = 4;
const kNoteFieldsCount = 5;

const dbContent = new KV("noted", "content");
const dbNotes = new KV("noted", "notes");

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

class Note extends Number {}

export class StoreLocal {
  /**
   * @returns {Promise<Note[]>}
   */
  async getNotes() {
    return [];
  }
}
