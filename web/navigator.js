import { safeRun } from "./plugos/util";

function encodePageUrl(name) {
  return "n/" + name.replaceAll(" ", "_");
}

function decodePageUrl(url) {
  let s = url.replaceAll("_", " ");
  if (s.startsWith("n/")) {
    s = s.slice(2);
  }
  return s;
}

export class PathPageNavigator {
  constructor(indexPage, root = "") {
    this.indexPage = indexPage;
    this.root = root;
  }
  async navigate(page, pos, replaceState = false) {
    let encodedPage = encodePageUrl(page);
    if (page === this.indexPage) {
      encodedPage = "";
    }
    if (replaceState) {
      window.history.replaceState(
        { page, pos },
        page,
        `${this.root}/${encodedPage}`
      );
    } else {
      window.history.pushState(
        { page, pos },
        page,
        `${this.root}/${encodedPage}`
      );
    }
    globalThis.dispatchEvent(
      new PopStateEvent("popstate", {
        state: { page, pos },
      })
    );
    await new Promise((resolve) => {
      this.navigationResolve = resolve;
    });
    this.navigationResolve = void 0;
  }

  subscribe(pageLoadCallback) {
    const cb = (event) => {
      const gotoPage = this.getCurrentPage();
      console.log("subscribe: gotoPage", gotoPage);
      if (!gotoPage) {
        return;
      }
      safeRun(async () => {
        await pageLoadCallback(
          this.getCurrentPage(),
          event?.state?.pos || this.getCurrentPos()
        );
        if (this.navigationResolve) {
          this.navigationResolve();
        }
      });
    };
    globalThis.addEventListener("popstate", cb);
    cb();
  }

  decodeURI() {
    const [page, pos] = decodeURI(
      location.pathname.substring(this.root.length + 1)
    ).split("@");
    if (pos) {
      if (pos.match(/^\d+$/)) {
        return [page, +pos];
      } else {
        return [page, pos];
      }
    } else {
      return [page, 0];
    }
  }

  getCurrentPage() {
    return decodePageUrl(this.decodeURI()[0]) || this.indexPage;
  }

  getCurrentPos() {
    return this.decodeURI()[1];
  }
}
