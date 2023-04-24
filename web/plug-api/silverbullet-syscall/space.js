// TODO: will need to implement methods

import { getNotes, noteGetLastModified } from "../../notesStore";

import { len } from "../../lib/util";
import { noteGetTitle } from "../../notesStore";

export class DummySpace {
  async readPage(name) {
    console.log("DummySpace.readPage:", name);
    return "";
  }

  async writePage(name, body) {
    console.log("DummySpace.writePage:", name);
    return {};
  }
  /*
        label: pageMeta.name,
      boost: pageMeta.lastModified,
      */

  metaForNote(note) {
    let title = noteGetTitle(note);
    let lastModified = noteGetLastModified(note);
    let meta = {
      name: title,
      lastModified: lastModified,
    };
    return meta;
  }

  async listPages() {
    console.log("DummySpace.listPages");
    let notes = await getNotes();
    let nNotes = len(notes);
    let res = new Array(nNotes);
    for (let i = 0; i < nNotes; i++) {
      let note = notes[i];
      let meta = this.metaForNote(note);
      res[i] = meta;
    }
    return res;
  }

  async deletePage(name) {
    console.log("DummySpace.deletePage:", name);
  }

  async getPageMeta(name) {
    console.log("DummySpace.getPageMeta:", name);
    let notes = await getNotes();
    for (let note of notes) {
      let title = noteGetTitle(note);
      if (title === name) {
        let meta = this.metaForNote(note);
        return meta;
      }
    }
    return {};
  }
}

export default new DummySpace();
