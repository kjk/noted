// https://zelark.github.io/nano-id-cc/
// this is pretty-printed https://esm.sh/v117/nanoid@4.0.2/es2022/nanoid.mjs

var u = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
var g = (t) => crypto.getRandomValues(new Uint8Array(t)),
  h = (t, e, r) => {
    let o = (2 << (Math.log(t.length - 1) / Math.LN2)) - 1,
      n = -~((1.6 * o * e) / t.length);
    return (s = e) => {
      let l = "";
      for (;;) {
        let a = r(n),
          p = n;
        for (; p--; ) if (((l += t[a[p] & o] || ""), l.length === s)) return l;
      }
    };
  },
  i = (t, e = 21) => h(t, e, g),
  c = (t = 21) =>
    crypto
      .getRandomValues(new Uint8Array(t))
      .reduce(
        (e, r) => (
          (r &= 63),
          r < 36
            ? (e += r.toString(36))
            : r < 62
            ? (e += (r - 26).toString(36).toUpperCase())
            : r > 62
            ? (e += "-")
            : (e += "_"),
          e
        ),
        ""
      );
export {
  i as customAlphabet,
  h as customRandom,
  c as nanoid,
  g as random,
  u as urlAlphabet,
};
