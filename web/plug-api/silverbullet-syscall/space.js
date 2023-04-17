// TODO: will need to implement methods
export class DummySpace {
  async readPage(name) {
    console.log("DummySpace.readPage:", name);
    return "";
  }
  async writePage(name, body) {
    console.log("DummySpace.writePage:", name);
  }
  async listPages() {
    return []; // PageMeta[]
  }
  async getPageMeta(name) {
    return;
  }
}

export default new DummySpace();
