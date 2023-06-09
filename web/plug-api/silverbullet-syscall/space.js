// TODO: will need to implement methods

import { getNoteLastModified, getNotes, getNotesSync } from "../../notesStore";

import { getNoteTitle } from "../../notesStore";
import { len } from "../../lib/util";

export class Space {
  async readPage(name) {
    console.log("Space.readPage:", name);
    return "";
  }

  async writePage(name, body) {
    console.log("Space.writePage:", name);
    return {};
  }
  /*
        label: pageMeta.name,
      boost: pageMeta.lastModified,
      */

  metaForNote(note) {
    let title = getNoteTitle(note);
    let lastModified = getNoteLastModified(note);
    let meta = {
      name: title,
      lastModified: lastModified,
    };
    return meta;
  }

  listPages() {
    let notes = getNotesSync();
    let nNotes = len(notes);
    let res = new Array(nNotes);
    for (let i = 0; i < nNotes; i++) {
      let note = notes[i];
      let meta = this.metaForNote(note);
      res[i] = meta;
    }
    console.log("Space.listPages returning", res.length, "pages");
    return res;
  }

  async deletePage(name) {
    console.log("Space.deletePage:", name);
  }

  getPageMeta(name) {
    console.log("Space.getPageMeta:", name);
    let notes = getNotesSync();
    for (let note of notes) {
      let title = getNoteTitle(note);
      if (title === name) {
        let meta = this.metaForNote(note);
        return meta;
      }
    }
    return {};
  }

  async readAttachment(name) {
    console.log("Space.readAttachment:", name);
    return "";
  }
}

export default new Space();
