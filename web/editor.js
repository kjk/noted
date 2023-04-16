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
import { indentUnit } from "@codemirror/language";
import { placeholder as placeholderExt } from "@codemirror/view";

/** @typedef { import("@codemirror/state").Extension} Extension */

class PageState {
  constructor(scrollTop, selection) {
    this.scrollTop = scrollTop;
    this.selection = selection;
  }
}

function getBaseExtensions2(
  basic,
  useTab,
  tabSize,
  lineWrapping,
  placeholder,
  editable
) {
  /** @type {Extension[]} */
  const res = [
    indentUnit.of(" ".repeat(tabSize)),
    EditorView.editable.of(editable),
  ];

  if (basic) res.push(basicSetup2);
  if (useTab) res.push(keymap.of([indentWithTab]));
  if (placeholder) res.push(placeholderExt(placeholder));
  if (lineWrapping) res.push(EditorView.lineWrapping);

  return res;
}
export class Editor {
  constructor() {
    this.viewDispatch = () => {};
    this.editorView = new EditorView({
      state: this.createEditorState("", false),
      parent: document.getElementById("sb-editor"),
    });
  }

  /**
   * @param {string} text
   * @param {boolean} readOnly
   * @returns {EditorState}
   */
  createEditorState(text, readOnly) {
    let basic = true;
    let useTab = true;
    let tabSize = 4;
    let lineWrapping = true;
    let placeholder = "";
    let editable = true;

    /** @type {Extension[]}*/
    const exts = [
      ...getBaseExtensions2(
        basic,
        useTab,
        tabSize,
        lineWrapping,
        placeholder,
        editable
      ),
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
}
