import {
  EditorState,
  EditorView,
  LanguageDescription,
  LanguageSupport,
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

import { CodeWidgetHook } from "./hooks/code_widget.js";
import buildMarkdown from "./markdown_parser/parser.js";
import { cleanModePlugins } from "./cm_plugins/clean.js";
import customMarkdownStyle from "./style.js";
import { focusEditorView } from "./lib/cmutil.js";
import { indentUnit } from "@codemirror/language";
import { inlineImagesPlugin } from "./cm_plugins/inline_image.js";
import { throwIf } from "./lib/util.js";

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

  dispatchTransaction(tr) {
    this.editorView.update([tr]);

    if (tr.docChanged && this.docChanged) {
      this.docChanged(tr);
    }
  }

  constructor(editorElement) {
    throwIf(!editorElement);
    this.space = new Space();
    this.codeWidgetHook = new CodeWidgetHook();
    this.editorElement = editorElement;

    // this.viewDispatch = () => {};
    this.editorView = new EditorView({
      state: this.createEditorState("", false),
      parent: editorElement,
      dispatch: (tr) => {
        this.dispatchTransaction(tr);
      },
    });
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
      }),
      syntaxHighlighting(customMarkdownStyle(this.mdExtensions)),
      inlineImagesPlugin(this.space),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      indentOnInput(),
      ...cleanModePlugins(this),
      EditorView.lineWrapping,
    ];

    return EditorState.create({
      doc: text,
      extensions: exts,
    });
  }

  async dispatchAppEvent(name, data) {
    console.log("Editor.dispatchAppEvent:", name, data);
  }
  /**
   * @returns {string}
   */
  getText() {
    let s = this.editorView.state.sliceDoc();
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
}
