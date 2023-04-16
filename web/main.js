import "./css/base.css";
import "./css/editor.css";
import "./css/modals.css";
import "./css/theme.css";
import "./css/main.css";

import App from "./Noted.svelte";

const args = {
  target: document.getElementById("app"),
};
export const app = new App(args);
