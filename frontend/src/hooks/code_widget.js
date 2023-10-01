// in markdown code blocks (```$lang) maps the language to a function
// that returns html rendering of the code block.
// used for markdown and embed
// could use for csv files and maybe more (plotting? calculator?)

export class CodeWidgetHook {
  codeWidgetCallbacks;
  constructor() {
    this.codeWidgetCallbacks = new Map();
  }

  add(name, cb) {
    this.codeWidgetCallbacks.set(name, cb);
  }
}
