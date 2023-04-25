export * as markdown from "./markdown.js";
export { default as space } from "./space.js";
export * as editor from "./editor.js";
export * as index from "./index.js";

let editor;

export function setEditor(e) {
  editor = e;
}

class System {
  async listCommands() {
    console.log("System.listCommands");
    let allCommands = {};
    for (let [cmd, def] of editor.editorCommands) {
      allCommands[cmd] = def.command;
    }
    return allCommands;
  }

  async invokeCommand(commandName) {
    console.log("System.invokeCommand:", commandName);
  }
}

export let system = new System();
