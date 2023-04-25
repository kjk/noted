// import { syscall } from "./syscall.js";

function syscall(name, ...args) {
  // let fn = syscalls[name];
  console.log("syscall:", name, args);
  throw new Error("index.js:syscall() not implemented");
  // return fn.call(this, ctx, ...args);
}

export function set(page, key, value) {
  return syscall("index.set", page, key, value);
}

export function batchSet(page, kvs) {
  return syscall("index.batchSet", page, kvs);
}

export function get(page, key) {
  return syscall("index.get", page, key);
}

export function del(page, key) {
  return syscall("index.delete", page, key);
}

// TODO:implement me. In store.dexie_browser.ts those are stored in a key/val
// db.
export async function queryPrefix(prefix) {
  console.log("index.queryPrefix", prefix);
  // return syscall("index.queryPrefix", prefix);
  /*
  {
    key,
    page, // not sure if this is required
    value: JSON.parse(value),
  }
  */
  return [];
}

export function query(query2) {
  return syscall("index.query", query2);
}

export function clearPageIndexForPage(page) {
  return syscall("index.clearPageIndexForPage", page);
}

export function deletePrefixForPage(page, prefix) {
  return syscall("index.deletePrefixForPage", page, prefix);
}

export function clearPageIndex() {
  return syscall("index.clearPageIndex");
}
