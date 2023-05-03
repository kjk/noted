import "./css/base.css";
import "./css/editor.css";
import "./css/modals.css";
import "./css/theme.css";
import "/fonts/inter.css";
import "./css/main.css";

import App from "./Noted.svelte";
import GithubLoginFailed from "./GithubLoginFailed.svelte";

const args = {
  target: document.getElementById("app"),
};

export let app;

if (window.location.pathname === "/github_login_failed") {
  console.log("Github login failed");
  // @ts-ignore
  app = new GithubLoginFailed(args);
} else {
  // @ts-ignore
  app = new App(args);
}
