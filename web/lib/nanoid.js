// based on https://github.com/ai/nanoid/blob/main/non-secure/index.js

// urlAlphabet has 63 chars so we get size^63 random numbers
// rough numbers:
// 63 ^ 4 = 15,752,961 == 15.7 million
// 63 ^ 5 = 992,436,543 == 992 million
// 63 ^ 6 = 62,523,502,209 == 62 billion
// 63 ^ 7 = 3,938,980,639,167== 3.9 trillion
// 63 ^ 8 = 248,155,780,267,521 == 248 trillion

// This alphabet uses `A-Za-z0-9_-` symbols.
// The order of characters is optimized for better gzip and brotli compression.
// References to the same file (works both for gzip and brotli):
// `'use`, `andom`, and `rict'`
// References to the brotli default dictionary:
// `-26T`, `1983`, `40px`, `75px`, `bush`, `jack`, `mind`, `very`, and `wolf`

let urlAlphabet =
  "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
const nAlphabet = urlAlphabet.length;

export let nanoid = (size = 21) => {
  let rand = crypto.getRandomValues(new Uint8Array(size));
  let id = "";
  for (let i = 0; i < size; i++) {
    let idx = rand[i] & nAlphabet;
    id += urlAlphabet[idx];
  }
  return id;
};
