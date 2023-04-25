import {
  EditorState,
  EditorView,
  LanguageDescription,
  LanguageSupport,
  SelectionRange,
  StreamLanguage,
  ViewPlugin,
  autocompletion,
  cLanguage,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  cppLanguage,
  csharpLanguage,
  dartLanguage,
  drawSelection,
  dropCursor,
  highlightSpecialChars,
  history,
  historyKeymap,
  indentOnInput,
  indentWithTab,
  javaLanguage,
  javascriptLanguage,
  jsonLanguage,
  keymap,
  kotlinLanguage,
  markdown,
  objectiveCLanguage,
  objectiveCppLanguage,
  postgresqlLanguage,
  protobufLanguage,
  pythonLanguage,
  runScopeHandlers,
  rustLanguage,
  scalaLanguage,
  searchKeymap,
  shellLanguage,
  sqlLanguage,
  standardKeymap,
  syntaxHighlighting,
  syntaxTree,
  tomlLanguage,
  typescriptLanguage,
  xmlLanguage,
  yamlLanguage,
} from "./deps.js";
import {
  applyLineReplace,
  insertSnippet,
  insertTemplateText,
} from "./plugs/core/template.js";
import {
  attachmentExtension,
  pasteLinkExtension,
} from "./cm_plugins/editor_paste.js";
import { len, throwIf } from "./lib/util.js";

import { PathPageNavigator } from "./navigator.js";
import { SlashCommandHook } from "./hooks/slash_command.js";
import { Space } from "./plug-api/silverbullet-syscall/space.js";
import { Tag } from "./deps.js";
import { anchorComplete } from "./plugs/core/anchor.js";
import buildMarkdown from "./markdown_parser/parser.js";
import { cleanModePlugins } from "./cm_plugins/clean.js";
import { clickNavigate } from "./plugs/core/navigate.js";
import { commandComplete } from "./plugs/core/command.js";
import customMarkdownStyle from "./style.js";
import { editorSyscalls } from "./syscalls/editor.js";
import { embedWidget } from "./plugs/core/embed.js";
import { emojiCompleter } from "./plugs/emoji/emoji.js";
import { focusEditorView } from "./lib/cmutil.js";
import { indentUnit } from "@codemirror/language";
import { inlineImagesPlugin } from "./cm_plugins/inline_image.js";
import { lineWrapper } from "./cm_plugins/line_wrapper.js";
import { noteGetTitle } from "./notesStore.js";
import { pageComplete } from "./plugs/core/page.js";
import { setEdiotrSyscall } from "./plug-api/silverbullet-syscall/editor.js";
import { smartQuoteKeymap } from "./cm_plugins/smart_quotes.js";
import { tagComplete } from "./plugs/core/tags.js";
import { unfurlCommand } from "./plugs/core/link.js";
import { wrapSelection } from "./plugs/core/text.js";

const frontMatterRegex = /^---\n(.*?)---\n/ms;

// import { CodeWidgetHook } from "./hooks/code_widget.js";

/** @typedef { import("@codemirror/state").Extension} Extension */

class PageState {
  constructor(scrollTop, selection) {
    this.scrollTop = scrollTop;
    this.selection = selection;
  }
}

class CodeWidgetHook {
  codeWidgetCallbacks;
  constructor() {
    this.codeWidgetCallbacks = new Map();
  }

  add(name, cb) {
    this.codeWidgetCallbacks.set(name, cb);
  }
}

// based on core_plug.json
let coreMdExts = {
  Hashtag: {
    firstCharacters: ["#"],
    regex: "#[^#\\d\\s\\[\\]]+\\w+",
    className: "sb-hashtag",
  },
  NakedURL: {
    firstCharacters: ["h"],
    regex:
      "https?:\\/\\/[-a-zA-Z0-9@:%._\\+~#=]{1,256}([-a-zA-Z0-9()@:%_\\+.~#?&=\\/]*)",
    className: "sb-naked-url",
  },
  NamedAnchor: {
    firstCharacters: ["$"],
    regex: "\\$[a-zA-Z\\.\\-\\/]+[\\w\\.\\-\\/]*",
    className: "sb-named-anchor",
  },
};

// based on loadMarkdownExtensions
function loadCoreMarkdownExtensions() {
  let exts = [];
  for (let [nodeType, def] of Object.entries(coreMdExts)) {
    let ext = {
      nodeType,
      tag: Tag.define(),
      firstCharCodes: def.firstCharacters.map((ch) => ch.charCodeAt(0)),
      regex: new RegExp("^" + def.regex),
      styles: def.styles,
      className: def.className,
    };
    exts.push(ext);
  }
  return exts;
}

let commands = {
  bold: {
    path: wrapSelection,
    command: {
      name: "Text: Bold",
      key: "Ctrl-b",
      mac: "Cmd-b",
      wrapper: "**",
    },
  },
  italic: {
    path: wrapSelection,
    command: {
      name: "Text: Italic",
      key: "Ctrl-i",
      mac: "Cmd-i",
      wrapper: "_",
    },
  },
  strikethrough: {
    path: wrapSelection,
    command: {
      name: "Text: Strikethrough",
      key: "Ctrl-Shift-s",
      mac: "Cmd-Shift-s",
      wrapper: "~~",
    },
  },
  marker: {
    path: wrapSelection,
    command: {
      name: "Text: Marker",
      key: "Alt-m",
      wrapper: "==",
    },
  },
  unfurlLink: {
    path: unfurlCommand,
    command: {
      name: "Link: Unfurl",
      key: "Ctrl-Shift-u",
      mac: "Cmd-Shift-u",
      contexts: ["NakedURL"],
    },
  },
};

let events = {
  pageComplete: {
    path: pageComplete,
    events: ["editor:complete"],
  },
  commandComplete: {
    path: commandComplete,
    events: ["editor:complete"],
  },
  tagComplete: {
    path: tagComplete,
    events: ["editor:complete"],
  },
  anchorComplete: {
    path: anchorComplete,
    events: ["editor:complete"],
  },
  emojiCompleter: {
    path: emojiCompleter,
    events: ["editor:complete", "minieditor:complete"],
  },
  clickNavigate: {
    path: clickNavigate,
    events: ["page:click"],
  },
};

function buildEditorCommands(commands) {
  let editorCommands = new Map();
  for (const [name, functionDef] of Object.entries(commands)) {
    throwIf(!functionDef.command, "missing command");
    const cmd = functionDef.command;
    const func = functionDef.path;
    throwIf(!func, "missing path");
    let def = {
      command: cmd,
      run: () => {
        return func(cmd);
      },
    };
    editorCommands.set(cmd.name, def);
  }
  return editorCommands;
}

let slashCommands = {
  insertFrontMatter: {
    redirect: insertTemplateText,
    slashCommand: {
      name: "front-matter",
      description: "Insert page front matter",
      value: "---\n|^|\n---\n",
    },
  },
  makeH1: {
    redirect: applyLineReplace,
    slashCommand: {
      name: "h1",
      description: "Turn line into h1 header",
      match: "^#*\\s*",
      replace: "# ",
    },
  },
  makeH2: {
    redirect: applyLineReplace,
    slashCommand: {
      name: "h2",
      description: "Turn line into h2 header",
      match: "^#*\\s*",
      replace: "## ",
    },
  },
  makeH3: {
    redirect: applyLineReplace,
    slashCommand: {
      name: "h3",
      description: "Turn line into h3 header",
      match: "^#*\\s*",
      replace: "### ",
    },
  },
  makeH4: {
    redirect: applyLineReplace,
    slashCommand: {
      name: "h4",
      description: "Turn line into h4 header",
      match: "^#*\\s*",
      replace: "#### ",
    },
  },
  insertHRTemplate: {
    redirect: insertTemplateText,
    slashCommand: {
      name: "hr",
      description: "Insert a horizontal rule",
      value: "---",
    },
  },
  insertTable: {
    redirect: insertTemplateText,
    slashCommand: {
      name: "table",
      description: "Insert a table",
      boost: -1,
      value:
        "| Header A | Header B |\n|----------|----------|\n| Cell A|^| | Cell B |\n",
    },
  },
  insertSnippet: {
    path: insertSnippet,
    command: {
      name: "Template: Insert Snippet",
    },
    slashCommand: {
      name: "snippet",
      description: "Insert a snippet",
    },
  },
  insertTodayCommand: {
    path: insertTemplateText,
    slashCommand: {
      name: "today",
      description: "Insert today's date",
      value: "{{today}}",
    },
  },
  insertTomorrowCommand: {
    path: insertTemplateText,
    slashCommand: {
      name: "tomorrow",
      description: "Insert tomorrow's date",
      value: "{{tomorrow}}",
    },
  },
};

function addSlashHooks(slashCommandHook) {
  for (let [name, def] of Object.entries(slashCommands)) {
    let cmd = def.slashCommand;
    let func = def.redirect || def.path;
    slashCommandHook.add(name, cmd, func);
  }
}

export class Editor {
  /** @type {HTMLElement} */
  editorElement;
  /** @type {EditorView} */
  editorView;
  /** @type {Function} */
  docChanged;
  mdExtensions = [];
  /** @type {Space}  */
  space;
  codeWidgetHook;
  slashCommandHook;
  viewDispatch;
  currentNote;
  editorCommands;
  loadPage = async (pageName) => {
    return false;
  };

  /**
   * @param {import("@codemirror/state").Transaction} tr
   */
  dispatchTransaction(tr) {
    this.editorView.update([tr]);

    if (tr.docChanged && this.docChanged) {
      this.docChanged(tr);
    }
  }

  constructor(editorElement) {
    throwIf(!editorElement);
    this.editorElement = editorElement;
    this.space = new Space();
    this.codeWidgetHook = new CodeWidgetHook();
    this.codeWidgetHook.add("embed", async (bodyText) => {
      return embedWidget(bodyText);
    });
    this.slashCommandHook = new SlashCommandHook(this);
    addSlashHooks(this.slashCommandHook);
    this.viewDispatch = (args) => {
      console.log("viewDispatch:", args);
    };
    this.mdExtensions = loadCoreMarkdownExtensions();
    this.editorCommands = buildEditorCommands(commands);

    this.editorView = new EditorView({
      state: this.createEditorState("", false),
      parent: editorElement,
      dispatch: (tr) => {
        this.dispatchTransaction(tr);
      },
    });

    this.pageNavigator = new PathPageNavigator(
      "", // indexPage
      "" // urlPrefix
    );

    this.pageNavigator.subscribe(async (pageName, pos) => {
      console.log("Now navigating to", pageName);
      if (!this.editorView) {
        return;
      }
      const stateRestored = await this.loadPage(pageName);
    });

    // TODO: long term we want to undo this redirection
    let syscall = editorSyscalls(this);
    setEdiotrSyscall(syscall);
  }

  async reloadPage() {
    console.log("Editor.reloadPage");
    // TODO: implement me
  }

  async navigate(name, pos, replaceState = false, newWindow = false) {
    console.log("Editor.navigate:", name, pos, replaceState, newWindow);
    // TODO: we don't have indexPage
    // if (!name) {
    //   name = this.indexPage;
    // }

    if (newWindow) {
      const win = window.open(`${location.origin}/${name}`, "_blank");
      if (win) {
        win.focus();
      }
      return;
    }

    await this.pageNavigator.navigate(name, pos, replaceState);
  }

  get currentPage() {
    let title = "";
    if (this.currentNote) {
      title = noteGetTitle(this.currentNote);
    }
    console.log(`Editor.currentPage: '${title}'`);
    return title;
  }

  /**
   * @param {string} text
   * @param {boolean} readOnly
   * @returns {EditorState}
   */
  createEditorState(text, readOnly) {
    let editor = this;
    const commandKeyBindings = [];
    for (const def of this.editorCommands.values()) {
      if (def.command.key) {
        commandKeyBindings.push({
          key: def.command.key,
          mac: def.command.mac,
          run: () => {
            console.log("commandKeyBindings.run:", def);
            if (def.command.contexts) {
              const context = this.getContext();
              if (!context || !def.command.contexts.includes(context)) {
                return false;
              }
            }
            Promise.resolve()
              .then(def.run)
              .catch((e) => {
                console.error(e);
                // this.flashNotification(
                //   `Error running command: ${e.message}`,
                //   "error"
                // );
              })
              .then(() => {
                editor.focus();
              });
            return true;
          },
        });
      }
    }

    let tabSize = 4;

    /** @type {Extension[]}*/
    const exts = [
      indentUnit.of(" ".repeat(tabSize)),
      // TODO: a different way of doing read-only
      EditorView.editable.of(!readOnly),
      keymap.of([indentWithTab]),

      markdown({
        base: buildMarkdown(this.mdExtensions),
        codeLanguages: [
          LanguageDescription.of({
            name: "yaml",
            alias: ["meta", "data", "embed"],
            support: new LanguageSupport(StreamLanguage.define(yamlLanguage)),
          }),
          LanguageDescription.of({
            name: "javascript",
            alias: ["js"],
            support: new LanguageSupport(javascriptLanguage),
          }),
          LanguageDescription.of({
            name: "typescript",
            alias: ["ts"],
            support: new LanguageSupport(typescriptLanguage),
          }),
          LanguageDescription.of({
            name: "sql",
            alias: ["sql"],
            support: new LanguageSupport(StreamLanguage.define(sqlLanguage)),
          }),
          LanguageDescription.of({
            name: "postgresql",
            alias: ["pgsql", "postgres"],
            support: new LanguageSupport(
              StreamLanguage.define(postgresqlLanguage)
            ),
          }),
          LanguageDescription.of({
            name: "rust",
            alias: ["rs"],
            support: new LanguageSupport(StreamLanguage.define(rustLanguage)),
          }),
          LanguageDescription.of({
            name: "css",
            support: new LanguageSupport(StreamLanguage.define(sqlLanguage)),
          }),
          LanguageDescription.of({
            name: "python",
            alias: ["py"],
            support: new LanguageSupport(StreamLanguage.define(pythonLanguage)),
          }),
          LanguageDescription.of({
            name: "protobuf",
            alias: ["proto"],
            support: new LanguageSupport(
              StreamLanguage.define(protobufLanguage)
            ),
          }),
          LanguageDescription.of({
            name: "shell",
            alias: ["sh", "bash", "zsh", "fish"],
            support: new LanguageSupport(StreamLanguage.define(shellLanguage)),
          }),
          LanguageDescription.of({
            name: "swift",
            support: new LanguageSupport(StreamLanguage.define(rustLanguage)),
          }),
          LanguageDescription.of({
            name: "toml",
            support: new LanguageSupport(StreamLanguage.define(tomlLanguage)),
          }),
          LanguageDescription.of({
            name: "json",
            support: new LanguageSupport(StreamLanguage.define(jsonLanguage)),
          }),
          LanguageDescription.of({
            name: "xml",
            support: new LanguageSupport(StreamLanguage.define(xmlLanguage)),
          }),
          LanguageDescription.of({
            name: "c",
            support: new LanguageSupport(StreamLanguage.define(cLanguage)),
          }),
          LanguageDescription.of({
            name: "cpp",
            alias: ["c++", "cxx"],
            support: new LanguageSupport(StreamLanguage.define(cppLanguage)),
          }),
          LanguageDescription.of({
            name: "java",
            support: new LanguageSupport(StreamLanguage.define(javaLanguage)),
          }),
          LanguageDescription.of({
            name: "csharp",
            alias: ["c#", "cs"],
            support: new LanguageSupport(StreamLanguage.define(csharpLanguage)),
          }),
          LanguageDescription.of({
            name: "scala",
            alias: ["sc"],
            support: new LanguageSupport(StreamLanguage.define(scalaLanguage)),
          }),
          LanguageDescription.of({
            name: "kotlin",
            alias: ["kt", "kts"],
            support: new LanguageSupport(StreamLanguage.define(kotlinLanguage)),
          }),
          LanguageDescription.of({
            name: "objc",
            alias: ["objective-c", "objectivec"],
            support: new LanguageSupport(
              StreamLanguage.define(objectiveCLanguage)
            ),
          }),
          LanguageDescription.of({
            name: "objcpp",
            alias: [
              "objc++",
              "objective-cpp",
              "objectivecpp",
              "objective-c++",
              "objectivec++",
            ],
            support: new LanguageSupport(
              StreamLanguage.define(objectiveCppLanguage)
            ),
          }),
          LanguageDescription.of({
            name: "dart",
            support: new LanguageSupport(StreamLanguage.define(dartLanguage)),
          }),
        ],
        addKeymap: true,
      }),
      syntaxHighlighting(customMarkdownStyle(this.mdExtensions)),
      autocompletion({
        override: [
          this.editorComplete.bind(this),
          this.slashCommandHook.slashCommandCompleter.bind(
            this.slashCommandHook
          ),
        ],
      }),
      inlineImagesPlugin(this.space),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      indentOnInput(),
      ...cleanModePlugins(this),
      EditorView.lineWrapping,
      lineWrapper([
        { selector: "ATXHeading1", class: "sb-line-h1" },
        { selector: "ATXHeading2", class: "sb-line-h2" },
        { selector: "ATXHeading3", class: "sb-line-h3" },
        { selector: "ATXHeading4", class: "sb-line-h4" },
        { selector: "ListItem", class: "sb-line-li", nesting: true },
        { selector: "Blockquote", class: "sb-line-blockquote" },
        { selector: "Task", class: "sb-line-task" },
        { selector: "CodeBlock", class: "sb-line-code" },
        { selector: "FencedCode", class: "sb-line-fenced-code" },
        { selector: "Comment", class: "sb-line-comment" },
        { selector: "BulletList", class: "sb-line-ul" },
        { selector: "OrderedList", class: "sb-line-ol" },
        { selector: "TableHeader", class: "sb-line-tbl-header" },
        { selector: "FrontMatter", class: "sb-frontmatter" },
      ]),
      keymap.of([
        ...smartQuoteKeymap,
        ...closeBracketsKeymap,
        ...standardKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...completionKeymap,
        indentWithTab,
        ...commandKeyBindings,
      ]),
      pasteLinkExtension,
      attachmentExtension(this),
      closeBrackets(),
    ];

    return EditorState.create({
      doc: text,
      extensions: exts,
    });
  }

  dispatch(change) {
    let editor = this;
    editor.editorView.dispatch(change);
  }

  prompt(message, defaultValue = "") {
    return new Promise((resolve) => {
      this.viewDispatch({
        type: "show-prompt",
        message,
        defaultValue,
        callback: (value) => {
          this.viewDispatch({ type: "hide-prompt" });
          this.focus();
          resolve(value);
        },
      });
    });
  }
  confirm(message) {
    return new Promise((resolve) => {
      this.viewDispatch({
        type: "show-confirm",
        message,
        callback: (value) => {
          this.viewDispatch({ type: "hide-confirm" });
          this.focus();
          resolve(value);
        },
      });
    });
  }

  /**
   * @param {number} pos
   * @param {boolean} center
   */
  moveCursor(pos, center = false) {
    let editor = this;
    editor.editorView.dispatch({
      selection: {
        anchor: pos,
      },
    });
    if (center) {
      editor.editorView.dispatch({
        effects: [
          EditorView.scrollIntoView(pos, {
            y: "center",
          }),
        ],
      });
    }
  }

  /**
   * returns cursor position i.e. begininng of main selection
   * @returns {number}
   */
  getCursor() {
    let editor = this;
    return editor.editorView.state.selection.main.from;
  }

  getSelection() {
    let editor = this;
    return editor.editorView.state.selection.main;
  }

  setSelection(from, to) {
    let editor = this;
    const editorView = editor.editorView;
    editorView.dispatch({
      selection: {
        anchor: from,
        head: to,
      },
    });
  }

  insertAtCursor(text) {
    let editor = this;
    const editorView = editor.editorView;
    const from = editorView.state.selection.main.from;
    editorView.dispatch({
      changes: {
        insert: text,
        from,
      },
      selection: {
        anchor: from + text.length,
      },
    });
  }

  async dispatchAppEvent(name, data) {
    console.log("Editor.dispatchAppEvent:", name, data);
    let responses = [];
    for (const [eventName, def] of Object.entries(events)) {
      let fn = def.path;
      // throwIf(!fn, `Event ${eventName} not implemented`);
      let events = def.events;
      if (events.includes(name)) {
        let result = await fn(data);
        if (result) {
          responses.push(result);
          console.log("dispatchAppEvent result:", result, "fn:", fn.name);
        }
      }
    }
    // throw new Error(`Event ${name} not found`);
    return responses;
  }

  /**
   * @returns {string}
   */
  getText() {
    let s = this.editorView?.state.sliceDoc();
    return s;
  }

  setText(s) {
    // TODO: better way
    let state = this.createEditorState(s, false);
    this.editorView.setState(state);
  }

  async completeWithEvent(context, eventName) {
    console.log("completeWithEvent eventName:", eventName);
    const editorState = context.state;
    const selection = editorState.selection.main;
    const line = editorState.doc.lineAt(selection.from);
    const linePrefix = line.text.slice(0, selection.from - line.from);
    const results = await this.dispatchAppEvent(eventName, {
      linePrefix,
      pos: selection.from,
    });
    console.log("completeWithEvent results:", results);
    if (len(results) === 0) {
      return null;
    }
    let actualResult = null;
    for (const result of results) {
      if (result) {
        if (actualResult) {
          console.error(
            "Got completion results from multiple sources, cannot deal with that"
          );
          return null;
        }
        actualResult = result;
      }
    }
    return actualResult;
  }
  editorComplete(context) {
    return this.completeWithEvent(context, "editor:complete");
  }

  focus() {
    focusEditorView(this.editorView);
  }

  // TODO: not sure if this is the right place for this
  openUrl(url) {
    const win = window.open(url, "_blank");
    if (win) {
      win.focus();
    }
  }

  getContext() {
    const state = this.editorView.state;
    const selection = state.selection.main;
    if (selection.empty) {
      return syntaxTree(state).resolveInner(selection.from).type.name;
    }
    return;
  }
}
