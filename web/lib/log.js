// TODO: don't log in production unless a debugging enabled
export function warn(...args) {
  console.warn(...args);
}

// TODO: this should be logged as an event
// export function error(...args) {
//   console.error(...args);
// }

export let error = console.error;

// export function log(...args) {
//   console.log(...args);
// }

export let log = console.log;
