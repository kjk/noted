import "./css/base.css";
import "./css/editor.css";
import "./css/modals.css";
import "./css/theme.css";
import "./css/main.css";

import App from "./Noted.svelte";
import { refreshGitHubTokenIfNeeded } from "./lib/github_login";

const args = {
  target: document.getElementById("app"),
};
export const app = new App(args);

refreshGitHubTokenIfNeeded();
