import { Decoration, syntaxTree } from "../deps.js";
import { HtmlWidget, decoratorStateField, isCursorInRange } from "./util.js";
import {
  directiveEndRegex,
  directiveStartRegex,
} from "../plug-api/lib/query.js";
export function directivePlugin() {
  return decoratorStateField((state) => {
    const widgets = [];
    syntaxTree(state).iterate({
      enter: ({ type, from, to, node }) => {
        const parent = node.parent;
        if (!parent) {
          return;
        }
        const cursorInRange = isCursorInRange(state, [parent.from, parent.to]);
        if (type.name === "DirectiveStart") {
          if (cursorInRange) {
            widgets.push(
              Decoration.line({ class: "sb-directive-start" }).range(from)
            );
          } else {
            const text = state.sliceDoc(from, to);
            const match = directiveStartRegex.exec(text);
            if (!match) {
              console.error("Something went wrong with this directive");
              return;
            }
            const [_fullMatch, directiveName] = match;
            widgets.push(
              Decoration.widget({
                widget: new HtmlWidget(
                  `#${directiveName}`,
                  "sb-directive-placeholder"
                ),
              }).range(from)
            );
            widgets.push(
              Decoration.line({
                class: "sb-directive-start sb-directive-start-outside",
                attributes: {
                  spellcheck: "false",
                },
              }).range(from)
            );
          }
          return true;
        }
        if (type.name === "DirectiveEnd") {
          if (cursorInRange) {
            widgets.push(
              Decoration.line({ class: "sb-directive-end" }).range(from)
            );
          } else {
            const text = state.sliceDoc(from, to);
            const match = directiveEndRegex.exec(text);
            if (!match) {
              console.error("Something went wrong with this directive");
              return;
            }
            const [_fullMatch, directiveName] = match;
            widgets.push(
              Decoration.widget({
                widget: new HtmlWidget(
                  `/${directiveName}`,
                  "sb-directive-placeholder"
                ),
              }).range(from)
            );
            widgets.push(
              Decoration.line({
                class: "sb-directive-end sb-directive-end-outside",
              }).range(from)
            );
          }
          return true;
        }
        if (type.name === "DirectiveBody") {
          const lines = state.sliceDoc(from, to).split("\n");
          let pos = from;
          for (const line of lines) {
            if (pos !== to) {
              widgets.push(
                Decoration.line({
                  class: "sb-directive-body",
                }).range(pos)
              );
            }
            pos += line.length + 1;
          }
          return true;
        }
      },
    });
    return Decoration.set(widgets, true);
  });
}
