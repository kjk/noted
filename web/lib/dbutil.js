import { get } from "svelte/store";
import { len } from "./util";
import { openDB } from "idb";

export function createKVStoresDB(dbName, stores, ver = 1) {
  console.log("createKVStoresDB:", dbName, stores, ver);
  let dbPromise = openDB(dbName, ver, {
    upgrade(db) {
      console.log("upgrade:", dbName, stores, ver);
      if (typeof stores === "string") {
        stores = [stores];
      }
      for (let storeName of stores) {
        db.createObjectStore(storeName);
        console.log("upgrade: createObjectStore:", storeName);
      }
    },
  });
  return dbPromise;
}

export class KV {
  storeName;
  dbPromise;

  constructor(db, storeName, ver = 1) {
    this.dbPromise = db;
    this.storeName = storeName;
    // console.log("KV:", dbName, storeName);
  }

  async getDb() {
    let res = await this.dbPromise;
    // console.log(res);
    return res;
  }
  async get(key) {
    let db = await this.getDb();
    return db.get(this.storeName, key);
  }
  async set(key, val) {
    let db = await this.getDb();
    return db.put(this.storeName, val, key);
  }

  // rejects if already exists
  async add(key, val) {
    let db = await this.getDb();
    return db.add(this.storeName, val, key);
  }
  async del(key) {
    let db = await this.getDb();
    return db.delete(this.storeName, key);
  }
  async clear() {
    let db = await this.getDb();
    return db.clear(this.storeName);
  }
  async keys() {
    let db = await this.getDb();
    return db.getAllKeys(this.storeName);
  }
}

/**
 * Create a generic Svelte store persisted in IndexedDB
 * @param {string} dbKey unique IndexedDB key for storing this value
 * @param {any} initialValue
 * @param {boolean} crossTab if true, changes are visible in other browser tabs (windows)
 * @returns {any}
 */
export function makeIndexedDBStore(
  db,
  dbKey,
  initialValue,
  crossTab,
  log = false
) {
  function makeStoreMaker(dbKey, initialValue, crossTab) {
    const lsKey = "store-notify:" + dbKey;
    let curr = initialValue;
    const subscribers = new Set();

    function getCurrentValue() {
      db.get(dbKey).then((v) => {
        console.log(`getCurrentValue: key: '${dbKey}'`);
        console.log("v:", v);
        curr = v || [];
        subscribers.forEach((cb) => cb(curr));
      });
    }

    getCurrentValue();

    /**
     * @param {StorageEvent} event
     */
    function storageChanged(event) {
      if (event.storageArea === localStorage && event.key === lsKey) {
        getCurrentValue();
      }
    }
    if (crossTab) {
      window.addEventListener("storage", storageChanged, false);
    }

    function set(v) {
      if (log) {
        console.log(`db.set() key '${dbKey}', len(v): ${len(v)}`);
        console.log("v:", v);
      }
      curr = v;
      subscribers.forEach((cb) => cb(curr));
      db.set(dbKey, v).then((v) => {
        console.log("saved");
        if (crossTab) {
          const n = +localStorage.getItem(lsKey) || 0;
          localStorage.setItem(lsKey, `${n + 1}`);
        }
      });
    }

    /**
     * @param {Function} subscriber
     */
    function subscribe(subscriber) {
      subscriber(curr);
      subscribers.add(subscriber);
      function unsubscribe() {
        subscribers.delete(subscriber);
      }
      return unsubscribe;
    }

    return { set, subscribe };
  }
  return makeStoreMaker(dbKey, initialValue, crossTab);
}

/**
 * @param {import("svelte/store").Writable<any>} store
 */
export function resaveStore(store) {
  let v = get(store);
  console.log("resaveStore: Len(v)", len(v));
  store.set(v);
}
