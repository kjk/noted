import { Vim, vimGetCm } from "../deps.js";

/**
 *
 * @param {import("../editor.js").Editor} editor
 * @returns
 */
export function editorSyscalls(editor) {
  const syscalls = {
    "editor.getCurrentPage": () => {
      return editor.currentPage;
    },
    "editor.getText": () => {
      return editor.getText();
    },
    "editor.getCursor": () => {
      return editor.getCursor();
    },
    "editor.getSelection": () => {
      return editor.getSelection();
    },
    "editor.save": () => {
      throw new Error("editor.save is deprecated");
      return editor.save(true);
    },
    "editor.navigate": async (
      _ctx,
      name,
      pos,
      replaceState = false,
      newWindow = false
    ) => {
      await editor.navigate(name, pos, replaceState, newWindow);
    },
    "editor.reloadPage": async () => {
      await editor.reloadPage();
    },
    "editor.openUrl": (_ctx, url) => {
      editor.openUrl(url);
    },
    "editor.downloadFile": (_ctx, filename, dataUrl) => {
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = filename;
      link.click();
    },
    "editor.flashNotification": (_ctx, message, type = "info") => {
      editor.flashNotification(message, type);
    },
    "editor.filterBox": (
      _ctx,
      label,
      options,
      helpText = "",
      placeHolder = ""
    ) => {
      return editor.filterBox(label, options, helpText, placeHolder);
    },
    "editor.showPanel": (_ctx, id, mode, html, script) => {
      editor.viewDispatch({
        type: "show-panel",
        id,
        config: { html, script, mode },
      });
    },
    "editor.hidePanel": (_ctx, id) => {
      editor.viewDispatch({
        type: "hide-panel",
        id,
      });
    },
    "editor.insertAtPos": (_ctx, text, pos) => {
      editor.editorView.dispatch({
        changes: {
          insert: text,
          from: pos,
        },
      });
    },
    "editor.replaceRange": (_ctx, from, to, text) => {
      editor.editorView.dispatch({
        changes: {
          insert: text,
          from,
          to,
        },
      });
    },
    "editor.moveCursor": (_ctx, pos, center = false) => {
      editor.moveCursor(pos, center);
    },
    "editor.setSelection": (_ctx, from, to) => {
      editor.setSelection(from, to);
    },
    "editor.insertAtCursor": (_ctx, text) => {
      editor.insertAtCursor(text);
    },
    "editor.dispatch": (_ctx, change) => {
      editor.dispatch(change);
    },
    "editor.prompt": (_ctx, message, defaultValue = "") => {
      return editor.prompt(message, defaultValue);
    },
    "editor.confirm": (_ctx, message) => {
      return editor.confirm(message);
    },
    "editor.getUiOption": (_ctx, key) => {
      return editor.viewState.uiOptions[key];
    },
    "editor.setUiOption": (_ctx, key, value) => {
      editor.viewDispatch({
        type: "set-ui-option",
        key,
        value,
      });
    },
    "editor.vimEx": (_ctx, exCommand) => {
      const cm = vimGetCm(editor.editorView);
      return Vim.handleEx(cm, exCommand);
    },
  };
  return syscalls;
}
