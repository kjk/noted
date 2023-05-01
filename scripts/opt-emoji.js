let pathSrc = "./web/plugs/emoji/emoji.json";
//let pathDst = "./web/plugs/emoji/emoji-opt2.js";
let pathDst = "./emoji-opt2.js";

let data = await Deno.readTextFile(pathSrc);
let emojis = JSON.parse(data);

let res = ["export let emojiNames = ["];

let emojisStr = "";

let prevEmoji = "";
let prevName = "";

let nDups = 0;

for (let e of emojis) {
  let emoji = e[0];
  let name = e[1];
  if (name === prevName) {
    console.log("skipping duplicate", emoji, name);
    console.log("              prev", prevEmoji, prevName);
    nDups++;
    continue;
  }
  prevEmoji = emoji;
  prevName = name;

  emojisStr += emoji;
  res.push(`"${name}",`);
}
res.push("];");

let s = res.join("\n");
s += '\n\nexport let emojis = "' + emojisStr + '";\n';

let d = new TextEncoder("utf-8").encode(s);

await Deno.writeFile(pathDst, d);

console.log("wrote", pathDst, "skipped", nDups, "duplicates");
