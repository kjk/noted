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
  attachmentExtension,
  pasteLinkExtension,
} from "./cm_plugins/editor_paste.js";

import { SlashCommandHook } from "./hooks/slash_command.js";
import { Tag } from "./deps.js";
import { applyLineReplace } from "./plugs/core/template.js";
import buildMarkdown from "./markdown_parser/parser.js";
import { cleanModePlugins } from "./cm_plugins/clean.js";
import customMarkdownStyle from "./style.js";
import { editorSyscalls } from "./syscalls/editor.js";
import { embedWidget } from "./plugs/core/embed.js";
import { focusEditorView } from "./lib/cmutil.js";
import { indentUnit } from "@codemirror/language";
import { inlineImagesPlugin } from "./cm_plugins/inline_image.js";
import { lineWrapper } from "./cm_plugins/line_wrapper.js";
import { setEdiotrSyscall } from "./plug-api/silverbullet-syscall/editor.js";
import { throwIf } from "./lib/util.js";

// import { CodeWidgetHook } from "./hooks/code_widget.js";

/** @typedef { import("@codemirror/state").Extension} Extension */

class Space {
  // TODO: implement those functions
  readAttachment(arg1, arg2) {
    return "";
  }
  listPages() {
    return [];
  }
}
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
  currentPage = ""; // TODO: get rid of it
  codeWidgetHook;
  slashCommandHook;
  viewDispatch;

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
    this.viewDispatch = (args) => {
      console.log("viewDispatch:", args);
    };
    this.mdExtensions = loadCoreMarkdownExtensions();
    this.slashCommandHook.add(
      "makeH3",
      {
        name: "h3",
        description: "Turn line into h3 header",
        match: "^#*\\s*",
        replace: "### ",
      },
      applyLineReplace
    );

    this.editorView = new EditorView({
      state: this.createEditorState("", false),
      parent: editorElement,
      dispatch: (tr) => {
        this.dispatchTransaction(tr);
      },
    });

    // TODO: long term we want to undo this redirection
    let syscall = editorSyscalls(this);
    setEdiotrSyscall(syscall);
  }

  /**
   * @param {string} text
   * @param {boolean} readOnly
   * @returns {EditorState}
   */
  createEditorState(text, readOnly) {
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
}
