// import { panelHtml } from "../components/panel.jsx";
import { Decoration, WidgetType, syntaxTree } from "../deps.js";
import {
  decoratorStateField,
  invisibleDecoration,
  isCursorInRange,
} from "./util.js";
class IFrameWidget extends WidgetType {
  constructor(from, to, editor, bodyText, codeWidgetCallback) {
    super();
    this.from = from;
    this.to = to;
    this.editor = editor;
    this.bodyText = bodyText;
    this.codeWidgetCallback = codeWidgetCallback;
  }
  toDOM() {
    console.log("toDOM");
    const iframe = document.createElement("iframe");
    // TODO: fix this
    // iframe.srcdoc = panelHtml;
    const messageListener = (evt) => {
      if (evt.source !== iframe.contentWindow) {
        return;
      }
      const data = evt.data;
      if (!data) {
        return;
      }
      switch (data.type) {
        case "event":
          this.editor.dispatchAppEvent(data.name, ...data.args);
          break;
        case "setHeight":
          iframe.style.height = data.height + "px";
          break;
        case "setBody":
          this.editor.editorView.dispatch({
            changes: {
              from: this.from,
              to: this.to,
              insert: data.body,
            },
          });
          break;
        case "blur":
          this.editor.editorView.dispatch({
            selection: { anchor: this.from },
          });
          this.editor.focus();
          break;
      }
    };
    iframe.onload = () => {
      globalThis.addEventListener("message", messageListener);
      iframe.onload = null;
      this.codeWidgetCallback(this.bodyText).then((widgetContent) => {
        if (widgetContent.html) {
          iframe.contentWindow.postMessage({
            type: "html",
            html: widgetContent.html,
            script: widgetContent.script,
          });
        } else if (widgetContent.url) {
          iframe.contentWindow.location.href = widgetContent.url;
          if (widgetContent.height) {
            iframe.style.height = widgetContent.height + "px";
          }
          if (widgetContent.width) {
            iframe.style.width = widgetContent.width + "px";
          }
        }
      });
    };
    return iframe;
  }
  eq(other) {
    return other instanceof IFrameWidget && other.bodyText === this.bodyText;
  }
}
export function fencedCodePlugin(editor) {
  return decoratorStateField((state) => {
    const widgets = [];
    syntaxTree(state).iterate({
      enter({ from, to, name, node }) {
        if (name === "FencedCode") {
          if (isCursorInRange(state, [from, to])) return;
          const text = state.sliceDoc(from, to);
          const [_, lang] = text.match(/^```(\w+)?/);
          const codeWidgetCallback =
            editor.codeWidgetHook.codeWidgetCallbacks.get(lang);
          if (codeWidgetCallback) {
            const lineStrings = text.split("\n");
            const lines = [];
            let fromIt = from;
            for (const line of lineStrings) {
              lines.push({
                from: fromIt,
                to: fromIt + line.length,
              });
              fromIt += line.length + 1;
            }
            const firstLine = lines[0],
              lastLine = lines[lines.length - 1];
            if (!firstLine || !lastLine) return;
            widgets.push(
              invisibleDecoration.range(firstLine.from, firstLine.to)
            );
            widgets.push(invisibleDecoration.range(lastLine.from, lastLine.to));
            widgets.push(
              Decoration.line({
                class: "sb-fenced-code-iframe",
              }).range(firstLine.from)
            );
            widgets.push(
              Decoration.line({
                class: "sb-fenced-code-hide",
              }).range(lastLine.from)
            );
            lines.slice(1, lines.length - 1).forEach((line) => {
              widgets.push(
                Decoration.line({ class: "sb-line-table-outside" }).range(
                  line.from
                )
              );
            });
            widgets.push(
              Decoration.widget({
                widget: new IFrameWidget(
                  from + lineStrings[0].length + 1,
                  to - lineStrings[lineStrings.length - 1].length - 1,
                  editor,
                  lineStrings.slice(1, lineStrings.length - 1).join("\n"),
                  codeWidgetCallback
                ),
              }).range(from)
            );
            return false;
          }
          return true;
        }
        if (name === "CodeMark") {
          const parent = node.parent;
          if (
            parent.node.name !== "InlineCode" &&
            !isCursorInRange(state, [parent.from, parent.to])
          ) {
            widgets.push(
              Decoration.line({
                class: "sb-line-code-outside",
              }).range(state.doc.lineAt(from).from)
            );
          }
        }
      },
    });
    return Decoration.set(widgets, true);
  });
}
