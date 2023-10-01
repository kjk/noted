/** @type {string[]} */
import { emojis } from "./emoji-opt";

// humans won't scroll through hundreds of results so limit
// to a reasonable number
const kMaxResults = 64;
// perf: we re-use this array because it won't be shared
let options = new Array(kMaxResults);

export function emojiCompleter({ linePrefix, pos }) {
  const match = /:([\w]+)$/.exec(linePrefix);
  if (!match) {
    return null;
  }
  const [fullMatch, emojiName] = match;

  let nRes = 0;
  let n = emojis.length / 2;
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
      options[nRes] = opt;
      nRes++;
      if (nRes >= kMaxResults) {
        break;
      }
    }
  }

  options.length = nRes;
  return {
    from: pos - fullMatch.length,
    filter: false,
    options: options,
  };
}
