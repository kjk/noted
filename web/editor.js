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

import { basicSetup2 } from "./lib/cmexts";
import { focusEditorView } from "./lib/cmutil.js";
import { indentUnit } from "@codemirror/language";
import { throwIf } from "./lib/util.js";

/** @typedef { import("@codemirror/state").Extension} Extension */

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

  dispatchTransaction(tr) {
    this.editorView.update([tr]);

    if (tr.docChanged && this.docChanged) {
      this.docChanged(tr);
    }
  }

  constructor(editorElement) {
    throwIf(!editorElement);
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
      ...basicSetup2,
      keymap.of([indentWithTab]),
      EditorView.lineWrapping,
    ];
    // const lang = await getCMLangFromFileName(fileName);
    // if (lang) {
    //   exts.push(lang);
    // }
    return EditorState.create({
      doc: text,
      extensions: exts,
    });
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
