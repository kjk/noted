import { editor } from "$sb/silverbullet-syscall/mod.js";
export async function quoteSelection() {
  let text = await editor.getText();
  const selection = await editor.getSelection();
  let from = selection.from;
  while (from >= 0 && text[from] !== "\n") {
    from--;
  }
  from++;
  if (text[from] === ">" && text[from + 1] === " ") {
    text = text.slice(from + 2, selection.to);
    text = text.replaceAll("\n> ", "\n");
  } else {
    text = text.slice(from, selection.to);
    text = `> ${text.replaceAll("\n", "\n> ")}`;
  }
  await editor.replaceRange(from, selection.to, text);
}
export async function listifySelection() {
  let text = await editor.getText();
  const selection = await editor.getSelection();
  if (selection.to == 0 && selection.from == 0) {
    await editor.insertAtCursor("* ");
    return;
  }
  let from = selection.from;
  if (text[from] == "\n") {
    from--;
  }
  while (from >= 0 && text[from] !== "\n") {
    from--;
  }
  from++;
  text = text.slice(from, selection.to);
  text = `* ${text.replaceAll(/\n(?!\n)/g, "\n* ")}`;
  await editor.replaceRange(from, selection.to, text);
}
export async function numberListifySelection() {
  let text = await editor.getText();
  const selection = await editor.getSelection();
  let from = selection.from;
  while (from >= 0 && text[from] !== "\n") {
    from--;
  }
  from++;
  text = text.slice(from, selection.to);
  let counter = 1;
  text = `1. ${text.replaceAll(/\n(?!\n)/g, () => {
    counter++;
    return `
${counter}. `;
  })}`;
  await editor.replaceRange(from, selection.to, text);
}
export async function linkSelection() {
  const text = await editor.getText();
  const selection = await editor.getSelection();
  const textSelection = text.slice(selection.from, selection.to);
  let linkedText = `[]()`;
  let pos = 1;
  if (textSelection.length > 0) {
    try {
      new URL(textSelection);
      linkedText = `[](${textSelection})`;
    } catch {
      linkedText = `[${textSelection}]()`;
      pos = linkedText.length - 1;
    }
  }
  await editor.replaceRange(selection.from, selection.to, linkedText);
  await editor.moveCursor(selection.from + pos);
}
export function wrapSelection(cmdDef) {
  return insertMarker(cmdDef.wrapper);
}
async function insertMarker(marker) {
  const text = await editor.getText();
  const selection = await editor.getSelection();
  if (selection.from === selection.to) {
    if (markerAt(selection.from)) {
      await editor.moveCursor(selection.from + marker.length);
    } else {
      await editor.insertAtCursor(marker + marker);
      await editor.moveCursor(selection.from + marker.length);
    }
  } else {
    let from = selection.from;
    let to = selection.to;
    let hasMarker = markerAt(from);
    if (!markerAt(from)) {
      from = selection.from - marker.length;
      to = selection.to + marker.length;
      hasMarker = markerAt(from);
    }
    if (!hasMarker) {
      await editor.replaceRange(
        selection.from,
        selection.to,
        marker + text.slice(selection.from, selection.to) + marker
      );
      await editor.setSelection(
        selection.from + marker.length,
        selection.to + marker.length
      );
    } else {
      await editor.replaceRange(
        from,
        to,
        text.substring(from + marker.length, to - marker.length)
      );
      await editor.setSelection(from, to - marker.length * 2);
    }
  }
  function markerAt(pos) {
    for (let i = 0; i < marker.length; i++) {
      if (text[pos + i] !== marker[i]) {
        return false;
      }
    }
    return true;
  }
}
