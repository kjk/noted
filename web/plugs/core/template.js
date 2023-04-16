import { editor, markdown, space } from "$sb/silverbullet-syscall/mod.js";
import { extractFrontmatter } from "$sb/lib/frontmatter.js";
import { renderToText } from "$sb/lib/tree.js";
import { niceDate } from "$sb/lib/dates.js";
import { readSettings } from "$sb/lib/settings_page.js";
export async function instantiateTemplateCommand() {
  const allPages = await space.listPages();
  const { pageTemplatePrefix } = await readSettings({
    pageTemplatePrefix: "template/page/",
  });
  const selectedTemplate = await editor.filterBox(
    "Template",
    allPages
      .filter((pageMeta) => pageMeta.name.startsWith(pageTemplatePrefix))
      .map((pageMeta) => ({
        ...pageMeta,
        name: pageMeta.name.slice(pageTemplatePrefix.length),
      })),
    `Select the template to create a new page from (listing any page starting with <tt>${pageTemplatePrefix}</tt>)`
  );
  if (!selectedTemplate) {
    return;
  }
  console.log("Selected template", selectedTemplate);
  const text = await space.readPage(
    `${pageTemplatePrefix}${selectedTemplate.name}`
  );
  const parseTree = await markdown.parseMarkdown(text);
  const additionalPageMeta = extractFrontmatter(parseTree, [
    "$name",
    "$disableDirectives",
  ]);
  if (additionalPageMeta.$name) {
    additionalPageMeta.$name = replaceTemplateVars(
      additionalPageMeta.$name,
      ""
    );
  }
  const pageName = await editor.prompt(
    "Name of new page",
    additionalPageMeta.$name
  );
  if (!pageName) {
    return;
  }
  try {
    await space.getPageMeta(pageName);
    if (
      !(await editor.confirm(
        `Page ${pageName} already exists, are you sure you want to override it?`
      ))
    ) {
      return;
    }
  } catch {}
  const pageText = replaceTemplateVars(renderToText(parseTree), pageName);
  await space.writePage(pageName, pageText);
  await editor.navigate(pageName);
}
export async function insertSnippet() {
  const allPages = await space.listPages();
  const { snippetPrefix } = await readSettings({
    snippetPrefix: "snippet/",
  });
  const cursorPos = await editor.getCursor();
  const page = await editor.getCurrentPage();
  const allSnippets = allPages
    .filter((pageMeta) => pageMeta.name.startsWith(snippetPrefix))
    .map((pageMeta) => ({
      ...pageMeta,
      name: pageMeta.name.slice(snippetPrefix.length),
    }));
  const selectedSnippet = await editor.filterBox(
    "Snippet",
    allSnippets,
    `Select the snippet to insert (listing any page starting with <tt>${snippetPrefix}</tt>)`
  );
  if (!selectedSnippet) {
    return;
  }
  const text = await space.readPage(`${snippetPrefix}${selectedSnippet.name}`);
  let templateText = replaceTemplateVars(text, page);
  const carretPos = templateText.indexOf("|^|");
  templateText = templateText.replace("|^|", "");
  templateText = replaceTemplateVars(templateText, page);
  await editor.insertAtCursor(templateText);
  if (carretPos !== -1) {
    await editor.moveCursor(cursorPos + carretPos);
  }
}
export function replaceTemplateVars(s, pageName) {
  return s.replaceAll(/\{\{([^\}]+)\}\}/g, (match, v) => {
    switch (v) {
      case "today":
        return niceDate(new Date());
      case "tomorrow": {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        return niceDate(tomorrow);
      }
      case "yesterday": {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        return niceDate(yesterday);
      }
      case "lastWeek": {
        const lastWeek = new Date();
        lastWeek.setDate(lastWeek.getDate() - 7);
        return niceDate(lastWeek);
      }
      case "nextWeek": {
        const nextWeek = new Date();
        nextWeek.setDate(nextWeek.getDate() + 7);
        return niceDate(nextWeek);
      }
      case "page":
        return pageName;
    }
    return match;
  });
}
export async function quickNoteCommand() {
  const { quickNotePrefix } = await readSettings({
    quickNotePrefix: "\u{1F4E5} ",
  });
  const isoDate = new Date().toISOString();
  let [date, time] = isoDate.split("T");
  time = time.split(".")[0];
  const pageName = `${quickNotePrefix}${date} ${time}`;
  await editor.navigate(pageName);
}
export async function dailyNoteCommand() {
  const { dailyNoteTemplate, dailyNotePrefix } = await readSettings({
    dailyNoteTemplate: "template/page/Daily Note",
    dailyNotePrefix: "\u{1F4C5} ",
  });
  let dailyNoteTemplateText = "";
  try {
    dailyNoteTemplateText = await space.readPage(dailyNoteTemplate);
  } catch {
    console.warn(`No daily note template found at ${dailyNoteTemplate}`);
  }
  const date = niceDate(new Date());
  const pageName = `${dailyNotePrefix}${date}`;
  if (dailyNoteTemplateText) {
    try {
      await space.getPageMeta(pageName);
    } catch {
      await space.writePage(
        pageName,
        replaceTemplateVars(dailyNoteTemplateText, pageName)
      );
    }
    await editor.navigate(pageName);
  } else {
    await editor.navigate(pageName);
  }
}
function getWeekStartDate(monday = false) {
  const d = new Date();
  const day = d.getDay();
  let diff = d.getDate() - day;
  if (monday) {
    diff += day == 0 ? -6 : 1;
  }
  return new Date(d.setDate(diff));
}
export async function weeklyNoteCommand() {
  const { weeklyNoteTemplate, weeklyNotePrefix, weeklyNoteMonday } =
    await readSettings({
      weeklyNoteTemplate: "template/page/Weekly Note",
      weeklyNotePrefix: "\u{1F5D3}\uFE0F ",
      weeklyNoteMonday: false,
    });
  let weeklyNoteTemplateText = "";
  try {
    weeklyNoteTemplateText = await space.readPage(weeklyNoteTemplate);
  } catch {
    console.warn(`No weekly note template found at ${weeklyNoteTemplate}`);
  }
  const date = niceDate(getWeekStartDate(weeklyNoteMonday));
  const pageName = `${weeklyNotePrefix}${date}`;
  if (weeklyNoteTemplateText) {
    try {
      await space.getPageMeta(pageName);
    } catch {
      await space.writePage(
        pageName,
        replaceTemplateVars(weeklyNoteTemplateText, pageName)
      );
    }
    await editor.navigate(pageName);
  } else {
    await editor.navigate(pageName);
  }
}
export async function insertTemplateText(cmdDef) {
  const cursorPos = await editor.getCursor();
  const page = await editor.getCurrentPage();
  let templateText = cmdDef.value;
  const carretPos = templateText.indexOf("|^|");
  templateText = templateText.replace("|^|", "");
  templateText = replaceTemplateVars(templateText, page);
  await editor.insertAtCursor(templateText);
  if (carretPos !== -1) {
    await editor.moveCursor(cursorPos + carretPos);
  }
}
export async function applyLineReplace(cmdDef) {
  const cursorPos = await editor.getCursor();
  const text = await editor.getText();
  const matchRegex = new RegExp(cmdDef.match);
  let startOfLine = cursorPos;
  while (startOfLine > 0 && text[startOfLine - 1] !== "\n") {
    startOfLine--;
  }
  let currentLine = text.slice(startOfLine, cursorPos);
  const emptyLine = !currentLine;
  currentLine = currentLine.replace(matchRegex, cmdDef.replace);
  await editor.dispatch({
    changes: {
      from: startOfLine,
      to: cursorPos,
      insert: currentLine,
    },
    selection: emptyLine
      ? {
          anchor: startOfLine + currentLine.length,
        }
      : void 0,
  });
}
