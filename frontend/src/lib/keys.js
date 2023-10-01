// https://keyjs.dev/ : to see what's what

/**
 * @param {KeyboardEvent} ev
 * @returns {boolean}
 */
export function isEsc(ev) {
  return ev.key === "Escape";
}

/**
 * @param {KeyboardEvent} ev
 * @returns {boolean}
 */
export function isEnter(ev) {
  return ev.key === "Enter";
}

/**
 * @param {KeyboardEvent} ev
 * @returns {boolean}
 */
export function isUp(ev) {
  return ev.key == "ArrowUp" || ev.key == "Up";
}

/**
 * @param {KeyboardEvent} ev
 * @returns {boolean}
 */
export function isDown(ev) {
  return ev.key == "ArrowDown" || ev.key == "Down";
}

/**
 * navigation up is: Up or Ctrl-P
 * @param {KeyboardEvent} ev
 * @returns {boolean}
 */
export function isNavUp(ev) {
  if (isUp(ev)) {
    return true;
  }
  return ev.ctrlKey && ev.code === "KeyP";
}

/**
 * navigation down is: Down or Ctrl-N
 * @param {KeyboardEvent} ev
 * @returns {boolean}
 */
export function isNavDown(ev) {
  if (isDown(ev)) {
    return true;
  }
  return ev.ctrlKey && ev.code === "KeyN";
}
