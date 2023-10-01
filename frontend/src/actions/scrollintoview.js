export function scrollintoview(node) {
  // TODO: test on Safari
  // https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollIntoView
  let opts = { behavior: "smooth", block: "nearest" };
  node.scrollIntoView(opts);
}
