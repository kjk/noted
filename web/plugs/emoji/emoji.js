/** @type {string[]} */
import { emojis } from "./emoji-opt";
import { len } from "../../lib/util";

export function emojiCompleter({ linePrefix, pos }) {
  const match = /:([\w]+)$/.exec(linePrefix);
  if (!match) {
    return null;
  }
  const [fullMatch, emojiName] = match;

  let options = [];
  let n = len(emojis) / 2;
  for (let i = 0; i < n; i++) {
    let emoji = emojis[i * 2];
    let shortcode = emojis[i * 2 + 1];
    // @ts-ignore
    if (shortcode.includes(emojiName)) {
      let opt = {
        detail: shortcode,
        label: emoji,
        type: "emoji",
      };
      options.push(opt);
    }
  }

  return {
    from: pos - fullMatch.length,
    filter: false,
    options: options,
  };
}
