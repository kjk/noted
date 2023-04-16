import {
  markdown,
  StreamLanguage,
  Strikethrough,
  styleTags,
  tags as t,
  TaskList,
  yamlLanguage,
} from "../deps.js";
import * as ct from "./customtags.js";
import {
  mdExtensionStyleTags,
  mdExtensionSyntaxConfig,
} from "./markdown_ext.js";
export const pageLinkRegex = /^\[\[([^\]\|]+)(\|([^\]]+))?\]\]/;
const WikiLink = {
  defineNodes: [
    { name: "WikiLink", style: ct.WikiLinkTag },
    { name: "WikiLinkPage", style: ct.WikiLinkPageTag },
    { name: "WikiLinkAlias", style: ct.WikiLinkPageTag },
    { name: "WikiLinkMark", style: t.processingInstruction },
  ],
  parseInline: [
    {
      name: "WikiLink",
      parse(cx, next, pos) {
        let match;
        if (
          next != 91 ||
          !(match = pageLinkRegex.exec(cx.slice(pos, cx.end)))
        ) {
          return -1;
        }
        const [fullMatch, page, pipePart, label] = match;
        const endPos = pos + fullMatch.length;
        let aliasElts = [];
        if (pipePart) {
          const pipeStartPos = pos + 2 + page.length;
          aliasElts = [
            cx.elt("WikiLinkMark", pipeStartPos, pipeStartPos + 1),
            cx.elt(
              "WikiLinkAlias",
              pipeStartPos + 1,
              pipeStartPos + 1 + label.length
            ),
          ];
        }
        return cx.addElement(
          cx.elt("WikiLink", pos, endPos, [
            cx.elt("WikiLinkMark", pos, pos + 2),
            cx.elt("WikiLinkPage", pos + 2, pos + 2 + page.length),
            ...aliasElts,
            cx.elt("WikiLinkMark", endPos - 2, endPos),
          ])
        );
      },
      after: "Emphasis",
    },
  ],
};
export const commandLinkRegex = /^\{\[([^\]\|]+)(\|([^\]]+))?\]\}/;
const CommandLink = {
  defineNodes: [
    { name: "CommandLink", style: { "CommandLink/...": ct.CommandLinkTag } },
    { name: "CommandLinkName", style: ct.CommandLinkNameTag },
    { name: "CommandLinkAlias", style: ct.CommandLinkNameTag },
    { name: "CommandLinkMark", style: t.processingInstruction },
  ],
  parseInline: [
    {
      name: "CommandLink",
      parse(cx, next, pos) {
        let match;
        if (
          next != 123 ||
          !(match = commandLinkRegex.exec(cx.slice(pos, cx.end)))
        ) {
          return -1;
        }
        const [fullMatch, command, pipePart, label] = match;
        const endPos = pos + fullMatch.length;
        let aliasElts = [];
        if (pipePart) {
          const pipeStartPos = pos + 2 + command.length;
          aliasElts = [
            cx.elt("CommandLinkMark", pipeStartPos, pipeStartPos + 1),
            cx.elt(
              "CommandLinkAlias",
              pipeStartPos + 1,
              pipeStartPos + 1 + label.length
            ),
          ];
        }
        return cx.addElement(
          cx.elt("CommandLink", pos, endPos, [
            cx.elt("CommandLinkMark", pos, pos + 2),
            cx.elt("CommandLinkName", pos + 2, pos + 2 + command.length),
            ...aliasElts,
            cx.elt("CommandLinkMark", endPos - 2, endPos),
          ])
        );
      },
      after: "Emphasis",
    },
  ],
};
const HighlightDelim = { resolve: "Highlight", mark: "HighlightMark" };
export const Highlight = {
  defineNodes: [
    {
      name: "Highlight",
      style: { "Highlight/...": ct.Highlight },
    },
    {
      name: "HighlightMark",
      style: t.processingInstruction,
    },
  ],
  parseInline: [
    {
      name: "Highlight",
      parse(cx, next, pos) {
        if (next != 61 || cx.char(pos + 1) != 61) return -1;
        return cx.addDelimiter(HighlightDelim, pos, pos + 2, true, true);
      },
      after: "Emphasis",
    },
  ],
};
class CommentParser {
  nextLine() {
    return false;
  }
  finish(cx, leaf) {
    cx.addLeafElement(
      leaf,
      cx.elt("Comment", leaf.start, leaf.start + leaf.content.length, [
        ...cx.parser.parseInline(leaf.content.slice(3), leaf.start + 3),
      ])
    );
    return true;
  }
}
export const Comment = {
  defineNodes: [{ name: "Comment", block: true }],
  parseBlock: [
    {
      name: "Comment",
      leaf(_cx, leaf) {
        return /^%%\s/.test(leaf.content) ? new CommentParser() : null;
      },
      after: "SetextHeading",
    },
  ],
};
const directiveStart = /^\s*<!--\s*#([a-z]+)\s*(.*?)-->\s*/;
const directiveEnd = /^\s*<!--\s*\/(.*?)-->\s*/;
import { parser as directiveParser } from "./parse-query.js";
import { Table } from "./table_parser.js";
const highlightingDirectiveParser = directiveParser.configure({
  props: [
    styleTags({
      Name: t.variableName,
      String: t.string,
      Number: t.number,
      PageRef: ct.WikiLinkTag,
      "Where Limit Select Render Order OrderDirection And": t.keyword,
    }),
  ],
});
export const Directive = {
  defineNodes: [
    { name: "Directive", block: true, style: ct.DirectiveTag },
    { name: "DirectiveStart", style: ct.DirectiveStartTag, block: true },
    { name: "DirectiveEnd", style: ct.DirectiveEndTag },
    { name: "DirectiveBody", block: true },
  ],
  parseBlock: [
    {
      name: "Directive",
      parse: (cx, line) => {
        const match = directiveStart.exec(line.text);
        if (!match) {
          return false;
        }
        const frontStart = cx.parsedPos;
        const [fullMatch, directive, arg] = match;
        const elts = [];
        if (directive === "query") {
          const queryParseTree = highlightingDirectiveParser.parse(arg);
          elts.push(
            cx.elt(
              "DirectiveStart",
              cx.parsedPos,
              cx.parsedPos + line.text.length + 1,
              [cx.elt(queryParseTree, frontStart + fullMatch.indexOf(arg))]
            )
          );
        } else {
          elts.push(
            cx.elt(
              "DirectiveStart",
              cx.parsedPos,
              cx.parsedPos + line.text.length + 1
            )
          );
        }
        cx.nextLine();
        const startPos = cx.parsedPos;
        let endPos = startPos;
        let text = "";
        let lastPos = cx.parsedPos;
        let nesting = 0;
        while (true) {
          if (directiveEnd.exec(line.text) && nesting === 0) {
            break;
          }
          text += line.text + "\n";
          endPos += line.text.length + 1;
          if (directiveStart.exec(line.text)) {
            nesting++;
          }
          if (directiveEnd.exec(line.text)) {
            nesting--;
          }
          cx.nextLine();
          if (cx.parsedPos === lastPos) {
            return false;
          }
          lastPos = cx.parsedPos;
        }
        const directiveBodyTree = cx.parser.parse(text);
        elts.push(
          cx.elt("DirectiveBody", startPos, endPos, [
            cx.elt(directiveBodyTree, startPos),
          ])
        );
        endPos = cx.parsedPos + line.text.length;
        elts.push(
          cx.elt("DirectiveEnd", cx.parsedPos, cx.parsedPos + line.text.length)
        );
        cx.nextLine();
        cx.addElement(cx.elt("Directive", frontStart, endPos, elts));
        return true;
      },
      before: "HTMLBlock",
    },
  ],
};
const yamlLang = StreamLanguage.define(yamlLanguage);
export const FrontMatter = {
  defineNodes: [
    { name: "FrontMatter", block: true },
    { name: "FrontMatterMarker" },
    { name: "FrontMatterCode" },
  ],
  parseBlock: [
    {
      name: "FrontMatter",
      parse: (cx, line) => {
        if (cx.parsedPos !== 0) {
          return false;
        }
        if (line.text !== "---") {
          return false;
        }
        const frontStart = cx.parsedPos;
        const elts = [
          cx.elt(
            "FrontMatterMarker",
            cx.parsedPos,
            cx.parsedPos + line.text.length + 1
          ),
        ];
        cx.nextLine();
        const startPos = cx.parsedPos;
        let endPos = startPos;
        let text = "";
        let lastPos = cx.parsedPos;
        do {
          text += line.text + "\n";
          endPos += line.text.length + 1;
          cx.nextLine();
          if (cx.parsedPos === lastPos) {
            return false;
          }
          lastPos = cx.parsedPos;
        } while (line.text !== "---");
        const yamlTree = yamlLang.parser.parse(text);
        elts.push(
          cx.elt("FrontMatterCode", startPos, endPos, [
            cx.elt(yamlTree, startPos),
          ])
        );
        endPos = cx.parsedPos + line.text.length;
        elts.push(
          cx.elt(
            "FrontMatterMarker",
            cx.parsedPos,
            cx.parsedPos + line.text.length
          )
        );
        cx.nextLine();
        cx.addElement(cx.elt("FrontMatter", frontStart, endPos, elts));
        return true;
      },
      before: "HorizontalRule",
    },
  ],
};
export default function buildMarkdown(mdExtensions) {
  return markdown({
    extensions: [
      WikiLink,
      CommandLink,
      FrontMatter,
      Directive,
      TaskList,
      Comment,
      Highlight,
      Strikethrough,
      Table,
      ...mdExtensions.map(mdExtensionSyntaxConfig),
      {
        props: [
          styleTags({
            Task: ct.TaskTag,
            TaskMarker: ct.TaskMarkerTag,
            Comment: ct.CommentTag,
            "TableDelimiter SubscriptMark SuperscriptMark StrikethroughMark":
              t.processingInstruction,
            "TableHeader/...": t.heading,
            TableCell: t.content,
            CodeInfo: ct.CodeInfoTag,
            HorizontalRule: ct.HorizontalRuleTag,
          }),
          ...mdExtensions.map((mdExt) =>
            styleTags(mdExtensionStyleTags(mdExt))
          ),
        ],
      },
    ],
  }).language;
}
