/**
 * return length of an array
 * @param {*} o
 * @returns {!number}
 */
export function len(o) {
  if (o && o.length) {
    return o.length;
  }
  return 0;
}

/**
 * @param {string} src
 * @param {*} opts
 * @returns {Promise}
 */
export function lazyLoadScript(src, opts = {}) {
  return new Promise(function (resolve, reject) {
    if (!src) {
      throw new Error("src parameter must be specified");
    }

    const defaults = {
      force: false,
      async: true,
    };

    if (typeof opts === "string") {
      opts = {
        id: opts,
      };
    }

    opts = Object.assign({}, defaults, opts);
    const script = document.createElement("script");

    const id = opts.id;
    script.src = src;
    if (id) {
      script.setAttribute("id", id);
      if (document.getElementById(id)) {
        // console.log(`already loaded ${src}`);
        resolve(document.getElementById(id));
        return;
      }
    } else {
      const sc = document.querySelector(`script[src="${src}"]`);
      if (!opts.force && sc) {
        // console.log(`already loaded ${src}`);
        resolve(sc);
        return;
      }
    }

    if (opts.async) script.setAttribute("async", "true");
    if (opts.defer) script.setAttribute("defer", "true");
    if (opts.integrity) script.setAttribute("integrity", opts.integrity);
    if (opts.type) script.setAttribute("type", opts.type);
    if (opts.text) script.setAttribute("text", opts.text);
    if (opts.charset) script.setAttribute("charset", opts.charset);
    if (opts.crossorigin) script.setAttribute("crossorigin", opts.crossorigin);

    script.onload = function (event) {
      // console.log(`loaded ${src}`);
      resolve(script);
    };
    script.onerror = function (event) {
      reject(event);
    };
    document.body.appendChild(script);
  });
}

/**
 * @param {string} src
 * @param {*} opts
 * @returns {Promise}
 */
export function lazyLoadCSS(src, opts = {}) {
  return new Promise(function (resolve, reject) {
    if (!src) {
      throw new Error("src parameter must be specified");
    }

    const defaults = {
      media: "all",
      rel: "stylesheet",
      type: "text/css",
      force: false,
    };

    const { id, media, rel, type, force } = Object.assign(
      {},
      defaults,
      typeof opts === "string"
        ? {
            id: opts,
          }
        : opts
    );

    const link = document.createElement("link");
    link.setAttribute("rel", rel);
    link.setAttribute("type", type);
    link.setAttribute("href", src);
    link.setAttribute("media", media);
    if (id) {
      if (!force && document.getElementById(id)) {
        // console.log(`already loaded ${src}`);
        resolve(document.getElementById(id));
        return;
      }
      link.setAttribute("id", id);
    } else {
      const li = document.head.querySelector(
        `link[rel="${rel}"][href="${src}"]`
      );
      if (li) {
        // console.log(`already loaded ${src}`);
        resolve(li);
        return;
      }
    }
    link.onload = function (event) {
      // console.log(`loaded ${src}`);
      resolve(link);
    };
    document.head.appendChild(link);
  });
}

/**
 * @param {number} n
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(n, min, max) {
  if (n < min) {
    return min;
  }
  if (n > max) {
    return max;
  }
  return n;
}

/**
 * "foo.txt" => ".txt"
 * @param {string} fileName
 * @returns {string}
 */
export function fileExt(fileName) {
  const idx = fileName.lastIndexOf(".");
  if (idx === -1) {
    return "";
  }
  const ext = fileName.substring(idx);
  return ext.toLowerCase();
}

/**
 * @param {string} s
 * @param {number} n
 * @returns {string}
 */
export function inflect(s, n) {
  if (n == 1) {
    return s;
  }
  return s + "s";
}

// TODO: move those t log.js
// TODO: don't log in production unless a debugging enabled
export function log(args) {
  console.log(args);
}

export function warn(args) {
  console.warn(args);
}

// TODO: this should be logged as an event
export function error(args) {
  console.error(args);
}

// returns a function that, when called, returns number of elapsed milliseconds
export function startTimer() {
  const timeStart = performance.now();
  return function () {
    return Math.round(performance.now() - timeStart);
  };
}

/**
 * @param {string} key
 */
export function getLocalStorageAsJSON(key) {
  // console.log("getLocalStorageAsJSON:", key);
  const v = localStorage.getItem(key);
  if (v) {
    // console.log("  v:", v);
    return JSON.parse(v);
  }
  return null;
}

/**
 * @param {string} key
 * @param {*} js
 */
export function setLocalStorageFromJSON(key, js) {
  const s = JSON.stringify(js);
  // console.log("setLocalStorageFromJSON:", key, "size:", len(s));
  localStorage.setItem(key, s);
}

/**
 * Reduce calls to the passed function.
 *
 * @param func - Function to debounce.
 * @param threshold - The delay to avoid recalling the function.
 * @param execAsap - If true, the Function is called at the start of the threshold, otherwise the Function is called at the end of the threshold.
 */
export function debounce(func, threshold, execAsap = false) {
  let timeout;
  return function debounced(...args) {
    const self = this;
    if (timeout) clearTimeout(timeout);
    else if (execAsap) func.apply(self, args);
    timeout = setTimeout(delayed, threshold || 100);
    function delayed() {
      if (!execAsap) func.apply(self, args);
      timeout = null;
    }
  };
}

/**
 * @param {boolean} cond
 */
export function throwIf(cond) {
  if (cond) {
    throw new Error("invalid condition");
  }
}

/**
 * "foo.txt" => ".txt"
 * "foo" => ""
 * @param {string} fileName
 * @returns {string}
 */
export function getFileExt(fileName) {
  let parts = fileName.split(".");
  let n = parts.length;
  if (n > 1) {
    return "." + parts[n - 1];
  }
  return "";
}
/**
 * foo.txt => foo-1.txt, foo-1.txt => foo-2.txt etc.
 * @param {string} s
 * @returns {string}
 */
export function genNextUniqueFileName(s) {
  /**
   * @param {string} s
   * @returns {number|null}
   */
  function toNumberOrNull(s) {
    const n = parseInt(s);
    const ns = `${n}`;
    if (s === ns) {
      return n;
    }
    return null;
  }

  let ext = "";
  let parts = s.split(".");
  let n = parts.length;
  if (n > 1) {
    ext = "." + parts[n - 1];
    s = parts.slice(0, n - 1).join(".");
  }
  parts = s.split("-");
  n = parts.length;
  if (n === 1) {
    return parts[0] + "-1" + ext;
  }
  const currSuffix = toNumberOrNull(parts[n - 1]);
  if (currSuffix === null) {
    return s + "-1" + ext;
  }
  const newSuffix = `${currSuffix + 1}`;
  parts[n - 1] = newSuffix;
  s = parts.join("-");
  return s + ext;
}

// TODO: doesn't belong here but in gisteditor
const adText = "(made with https://codeeval.dev)";
/**
 * @param {string} s
 * @returns {string}
 */
export function removeDescriptionAd(s) {
  if (!s) {
    return "";
  }
  if (!s.includes(adText)) {
    return s;
  }
  s = s.replace(adText, "");
  return s.trim();
}

export function fnNoOp() {
  // just a no-op function
  // more efficient than doing () => {} many times
}

// https://svelte.dev/examples/modal
/**
 *
 * @param {*} parent
 * @param {KeyboardEvent} e
 */
export function trapFocus(parent, e) {
  const nodes = parent.querySelectorAll("*:not([disabled])");
  const tabbable = Array.from(nodes).filter((n) => n.tabIndex >= 0);

  let index = tabbable.indexOf(document.activeElement);
  if (index === -1 && e.shiftKey) index = 0;

  index += tabbable.length + (e.shiftKey ? -1 : 1);
  index %= tabbable.length;

  tabbable[index].focus();
}

/*
// https://hidde.blog/using-javascript-to-trap-focus-in-an-element/
export function trapFocus2(parent, e) {
  // re-get focusable elements because disabled state might change
  var focusableEls = parent.querySelectorAll(
    'a[href]:not([disabled]), button:not([disabled]), textarea:not([disabled]), input[type="text"]:not([disabled]), input[type="radio"]:not([disabled]), input[type="checkbox"]:not([disabled]), select:not([disabled])'
  );
  // console.log("focusableEls:", focusableEls);
  var firstFocusableEl = focusableEls[0];
  var lastFocusableEl = focusableEls[focusableEls.length - 1];
  if (e.shiftKey) {
    if (document.activeElement === firstFocusableEl) {
      // console.log("trapped to lastFocusableEl", lastFocusableEl);
      lastFocusableEl.focus();
    }
  } else {
    if (document.activeElement === lastFocusableEl) {
      // console.log("trapped to firstFocusableEl:", firstFocusableEl);
      firstFocusableEl.focus();
    }
  }
}
*/

export function humanizeSize(n) {
  const a = [
    [1024 * 1024 * 1024 * 1024, "TB"],
    [1024 * 1024 * 1024, "GB"],
    [1024 * 1024, "MB"],
    [1024, "kB"],
  ];
  for (const el of a) {
    const size = el[0];
    if (n >= size) {
      // @ts-ignore
      let s = (n / size).toFixed(2);
      return s.replace(".00", "") + " " + el[1];
    }
  }
  return `${n} B`;
}

export function preventDefaults(e) {
  //console.log("preventDefaults");
  e.preventDefault();
  e.stopPropagation();
}

export function preventDragOnElement(el) {
  //console.log("preventDragOnElement", el);
  ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
    el.addEventListener(eventName, preventDefaults, false);
  });
}

export function undoPreventDragOnElement(el) {
  //console.log("preventDragOnElement", el);
  ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
    el.addEventListener(eventName, preventDefaults, false);
  });
}

// Wrap readEntries in a promise to make working with readEntries easier
export async function readEntriesPromise(directoryReader) {
  try {
    return await new Promise((resolve, reject) => {
      directoryReader.readEntries(resolve, reject);
    });
  } catch (err) {
    console.log(err);
  }
}

export async function collectAllDirectoryEntries(directoryReader, queue) {
  let readEntries = await readEntriesPromise(directoryReader);
  while (readEntries.length > 0) {
    queue.push(...readEntries);
    readEntries = await readEntriesPromise(directoryReader);
  }
}

export async function getAllFileEntries(dataTransferItemList) {
  let fileEntries = [];
  let queue = [];
  let n = dataTransferItemList.length;
  for (let i = 0; i < n; i++) {
    let item = dataTransferItemList[i];
    let entry = item.webkitGetAsEntry();
    queue.push(entry);
  }
  while (len(queue) > 0) {
    let entry = queue.shift();
    if (entry.isFile) {
      fileEntries.push(entry);
    } else if (entry.isDirectory) {
      let reader = entry.createReader();
      await collectAllDirectoryEntries(reader, queue);
    }
  }
  return fileEntries;
}

class FileWithPath {
  /** @type {File} */
  file;
  path = "";
  constructor(file, path) {
    this.file = file;
    this.path = path;
  }
}

/**
 * @param {FileList} files
 * @param {Function} fnAllowed
 * @returns {FileWithPath[]}
 */
export function filterFiles(files, fnAllowed) {
  /** @type {FileWithPath[]} */
  let res = [];
  for (const file of files) {
    if (fnAllowed && !fnAllowed(file.name)) {
      console.log(`${file.name} is not a supported file type`);
      continue;
    }

    let f = new FileWithPath(file, file.name);
    res.push(f);
  }
  return res;
}

/**
 * @param {DataTransfer} dt
 * @param {Function} fnAllowed
 * @returns {Promise<FileWithPath[]>}
 */
export async function filterDataTransferEntries(dt, fnAllowed) {
  let fileEntries = await getAllFileEntries(dt.items);
  // convert to File objects

  let res = [];
  for (let fe of fileEntries) {
    let path = fe.fullPath;
    if (fnAllowed && !fnAllowed(path)) {
      console.log(`${path} is not a supported file type`);
      continue;
    }
    let file = await new Promise((resolve, reject) => {
      fe.file(resolve, reject);
    });
    path = path.replace(/^\//, "");
    const f = new FileWithPath(file, path);
    res.push(f);
  }
  return res;
}

/**
 * @param {number} n
 * @returns {string}
 */
export function genRandomID(n) {
  const SHORT_ID_SYMBOLS =
    "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const nShortSymbols = len(SHORT_ID_SYMBOLS);

  let res = "";
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(Math.random() * nShortSymbols);
    const c = SHORT_ID_SYMBOLS[idx];
    res = res + c;
  }
  return res;
}

/**
 * split("a.b.c", "." 2) => ["a" "b.c"]
 * which is different from "a.b.c".split(".",2) => ["a", "b"]
 * @param {string} s
 * @param {string} sep
 * @param {number} max
 * @returns {string[]}
 */
export function splitMax(s, sep, max) {
  throwIf(max === 0);
  let parts = s.split(sep);
  if (parts.length <= max) {
    return parts;
  }
  let restParts = parts.slice(max - 1);
  let restStr = restParts.join(sep);
  parts[max - 1] = restStr;
  return parts.slice(0, max);
}

/**
 * @param {string} s
 */
export function setClipboard(s) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(s);
  }
}

export function clearClipboard() {
  setClipboard("");
}

/**
 * @returns {Promise<string>}
 */
export async function getClipboard() {
  if (navigator.clipboard) {
    let s = await navigator.clipboard.readText();
    return s;
  }
  return "";
}

/**
 * @param {string} s
 */
export async function appendClipboard(s) {
  let curr = await getClipboard();
  setClipboard(curr + s);
}
