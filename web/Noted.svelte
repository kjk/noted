<script>
  /** @typedef { import("@codemirror/state").Extension} Extension */
  /** @typedef {import("./notesStore").Note} Note */

  import { debounce, len, pluralize, throwIf } from "./lib/util";
  import { onMount, onDestroy } from "svelte";
  import {
    getNotes,
    newNote,
    getNoteTitle,
    setNoteTitle,
    changeToRemoteStore,
    changeToLocalStore,
    deleteNote,
    getNoteLastModified,
    getNoteID,
    deleteRemoteStoreCache,
  } from "./notesStore";
  import { Editor } from "./editor";
  import GlobalTooltip, { gtooltip } from "./lib/GlobalTooltip.svelte";
  import GitHub from "./icons/GitHub.svelte";
  import { userInfo, logout, getLoggedUser } from "./lib/login";
  import SvgArrowDown from "./svg/SvgArrowDown.svelte";
  import CommandPalette, {
    kSelectedCommand,
    kSelectedName,
  } from "./CommandPalette.svelte";
  import browser from "./lib/browser";
  import { setEditor } from "./plug-api/silverbullet-syscall/mod";
  import { log } from "./lib/log";
  import { encodeNoteURL, setNavigationCallback } from "./navigator";

  let commandPaletteNotes = [];
  let commandPalettePageNames = [];
  let commandPaletteCommands = ["Delete Note"];
  let commadnPaletteSearchTerm = "";
  let showingCommandPalette = false;
  let onCommandPaletteSelected = (kind, idx, item) => {
    log("onCommandPaletteSelected:", kind, idx, item);
  };

  let cmdPaletteShortcut = "<tt>Ctrl + K</tt>";
  if (browser.mac) {
    cmdPaletteShortcut = "<tt>⌘ + K</tt>";
  }
  let newNoteShortcut = "<tt>Alt + N</tt>";
  if (browser.mac) {
    newNoteShortcut = "<tt>Ctrl + N</tt>";
  }

  let notes = [];

  /** @type {HTMLElement} */
  let editorElement;
  /** @type {Editor} */
  let editor;
  let errorMsg = "";

  let title;
  /** @type {HTMLElement}*/
  let titleEl;

  let debouncedTitleChanged = debounce(titleChanged, 500);

  $: debouncedTitleChanged(title);

  async function titleChanged(title) {
    if (!title || !editor) {
      return;
    }
    let note = editor.currentNote;
    if (!note) {
      return;
    }
    let prevTitle = getNoteTitle(note);
    if (prevTitle === title) {
      return;
    }
    log(`titleChanged: '${prevTitle}' => '${title}'`);
    setNoteTitle(note, title);
    // notes = notes;
  }

  let flashMsg = "";

  function viewDispatch(args) {
    let kind = args.type;
    log("viewDispatch:", args);
    switch (kind) {
      case "page-loaded":
        // TODO: fix up url if doesn't represent the state exactly
        let note = args.note;
        title = getNoteTitle(note);
        document.title = title;
        break;
    }
  }

  async function deleteCurrentNote() {
    let note = editor.currentNote;
    log("deleteCurrentNote:", note);
    notes = await deleteNote(note);
    editor.navigate(null);
  }

  async function onNoteOrCommandSelected(kind, idx, item) {
    log("onNoteOrCommandSelected:", kind, idx, item);
    if (kind === kSelectedName) {
      if (idx === -1) {
        await createNewNote(item);
      } else {
        let n = commandPaletteNotes[idx];
        await editor.navigate(n);
      }
    } else if (kind === kSelectedCommand) {
      log("command:", item);
      if (item === "Delete Note") {
        await deleteCurrentNote();
      }
    } else {
      throwIf(true, `unknown kind: ${kind}`);
    }
    showingCommandPalette = false;
  }

  async function runCommandPalette(startWithCommands) {
    // log("selectPage");
    commandPaletteNotes = sortNotesByLastModified(notes);
    // in-place replace note by its title
    let nNotes = len(commandPaletteNotes);
    commandPalettePageNames.length = nNotes;
    for (let i = 0; i < nNotes; i++) {
      let n = commandPaletteNotes[i];
      let title = getNoteTitle(n);
      commandPalettePageNames[i] = title;
    }
    onCommandPaletteSelected = onNoteOrCommandSelected;
    commadnPaletteSearchTerm = "";
    if (startWithCommands) {
      commadnPaletteSearchTerm = ">";
    }
    showingCommandPalette = true;
  }

  async function selectCommand() {
    runCommandPalette(true);
  }

  async function selectPage() {
    runCommandPalette(false);
  }

  /**
   * @param {KeyboardEvent} ev
   */
  function isShowSelectPageOrCommandShortcut(ev) {
    if (browser.mac && ev.metaKey && ev.code === "KeyK") {
      return true;
    }
    if (browser.windows && ev.ctrlKey && ev.code === "KeyK") {
      return true;
    }
    return false;
  }

  /**
   * @param {KeyboardEvent} ev
   */
  function isNewPageShortcut(ev) {
    if (browser.mac && ev.altKey && ev.code === "KeyN") {
      return true;
    }
    if (browser.windows && ev.altKey && ev.code === "KeyN") {
      return true;
    }
    return false;
  }

  /**
   * @param {KeyboardEvent} ev
   */
  function onKeyDown(ev) {
    let handled = false;
    if (isShowSelectPageOrCommandShortcut(ev)) {
      if (ev.shiftKey) {
        selectCommand();
      } else {
        selectPage();
      }
      handled = true;
    }

    if (isNewPageShortcut(ev)) {
      createNewNote();
      handled = true;
    }

    if (handled) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  }

  /**
   * @param {KeyboardEvent} ev
   */
  function onTitleKeyDown(ev) {
    if (ev.key === "Enter" || ev.key === "Escape") {
      ev.stopPropagation();
      ev.preventDefault();
      editor.focus();
      return;
    }
    if (ev.key === "ArrowDown") {
      ev.stopPropagation();
      ev.preventDefault();
      // TODO: set cursor to start of editor
      editor.moveCursor(0);
      editor.focus();
      return;
    }
  }

  async function createNewNote(title = "") {
    log("createNewNote");
    let n = await newNote(title);
    await editor.navigate(n);
    if (title === "") {
      titleEl.focus();
    }
    notes = await getNotes();
  }

  /**
   * returns a copy of notes sorted by last modified
   * notes most recently modified are first
   * @param {Note[]} notes
   * @returns {Note[]}
   */
  function sortNotesByLastModified(notes) {
    let res = [...notes];
    res.sort((a, b) => {
      let aTime = getNoteLastModified(a);
      let bTime = getNoteLastModified(b);
      return bTime - aTime;
    });
    return res;
  }

  async function useLocalStore() {
    log("useLocalStore");
    // TODO: clewar remote store cache
    changeToLocalStore();
  }

  async function useRemoteStore() {
    changeToRemoteStore();
    deleteRemoteStoreCache();
  }

  function flashNotification(msg, type) {
    // TODO: implement me and more asdf
    log("flashNotification:", msg, type);
  }

  async function onNavigate(notes) {
    log("onNavigate: notes", notes);
    if (!editor || !editor.editorView) {
      return;
    }
    let first = notes[0];
    let note = first[0];
    let pos = first[1];
    const stateRestored = await editor.loadPage(note);
    if (pos) {
      if (typeof pos === "string") {
        log("Navigating to anchor", pos);
        const posLookup = 0;
        // const posLookup = await this.system.localSyscall(
        //   "core",
        //   "index.get",
        //   [pageName, `a:${pageName}:${pos}`]
        // );
        if (!posLookup) {
          return editor.flashNotification(
            `Could not find anchor @${pos}`,
            "error"
          );
        } else {
          pos = +posLookup;
        }
      }
      editor.editorView.dispatch({
        selection: { anchor: pos },
        scrollIntoView: true,
      });
    } else if (!stateRestored) {
      editor.setCursorPastFrontMatter();
    }
  }

  onMount(async () => {
    log("Noted.onMount, id:");

    let user = await getLoggedUser();
    log("user:", user);
    if (user == null) {
      await useLocalStore();
    } else {
      await useRemoteStore();
    }
    notes = await getNotes();
    let nNotes = len(notes);
    log("notes:", nNotes);

    log("Noted.onMount: editor:", editor);
    if (!editor) {
      // in dev onMounted() is called multiple times
      // and we crete and init editor multiple times
      // which subscribes for PageNavigator which
      // creates multiple listeners for "popstate"
      // which adds bogus logging
      editor = new Editor(editorElement, null);
      log("editor:", editor);
      editor.flashNotification = flashNotification;
      editor.viewDispatch = viewDispatch;
      setEditor(editor);
      await editor.init();
    }
    setNavigationCallback(onNavigate);
    document.addEventListener("keydown", onKeyDown);
  });

  onDestroy(() => {
    console.log("Noted.onDestroy");
    document.removeEventListener("keydown", onKeyDown);
  });
</script>

<GlobalTooltip />

<div id="sb-root" class="g grid grid-rows-[auto_1fr_auto] h-screen px-4 py-2">
  <div
    class="mx-[22px] flex items-center max-w-[var(--editor-width)] px-[20px]"
  >
    <div
      tabindex="0"
      use:gtooltip={"click to edit title"}
      bind:this={titleEl}
      on:keydown={onTitleKeyDown}
      contenteditable="true"
      placeholder="note title..."
      bind:textContent={title}
      role="textbox"
      aria-multiline="false"
      class="note-title px-2 ml-[-0.125rem] user-modify-plain text-lg font-semibold focus-within:outline-none bg-white placeholder:italic hover:bg-gray-50 border-t border-l border-r border-gray-400 rounded-t-md"
    />
    <button
      use:gtooltip={"create new note"}
      on:click={() => createNewNote("")}
      class="cursor-pointer text-lg px-2 hover:bg-gray-50"
    >
      +
    </button>
    <div class="grow text-xl">&nbsp;</div>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <div
      on:click|preventDefault|stopPropagation={selectPage}
      use:gtooltip={cmdPaletteShortcut}
      class="cursor-pointer text-sm flex items-center gap-x-2 hover:bg-gray-100 px-2 py-0.5"
    >
      <div>{len(notes)}</div>
      <div>{pluralize("note", len(notes))}</div>
      <SvgArrowDown class="w-2 h-2" />
    </div>
    <button
      use:gtooltip={newNoteShortcut}
      on:click={() => createNewNote("")}
      class="relative text-sm border ml-2 border-gray-300 hover:bg-gray-100 rounded-md py-0.5 px-2"
      >new note</button
    >

    {#if $userInfo}
      <div
        class="relative group flex items-center gap-x-2 hover:bg-gray-100 cursor-pointer px-2 ml-2 py-1"
      >
        {#if $userInfo.avatar_url}
          <img
            class="avatar"
            src={$userInfo.avatar_url}
            width="20"
            height="20"
            alt="kjk"
          />
        {/if}
        <div class="text-sm">{$userInfo.login}</div>
        <div class="mt-1 text-gray-700">
          <SvgArrowDown class="w-2 h-2" />
          <div
            class="hidden absolute text-sm flex-col border shadow left-0 top-full py-2 z-20 group-hover:flex bg-white"
          >
            <a
              href="/auth/ghlogout"
              class="hover:bg-gray-100 py-0.5 px-4 min-w-[6rem]">Logout</a
            >
          </div>
        </div>
      </div>
    {:else}
      <a
        use:gtooltip={"LogIn with GitHub"}
        href="/auth/ghlogin"
        class="relative flex items-center text-sm border ml-2 border-gray-500 hover:bg-gray-100 rounded-md py-0.5 px-2"
        ><GitHub class="mt-[1px]" />
        <div class="ml-1.5">login</div></a
      >
    {/if}
  </div>

  <div id="sb-main" class="overflow-hidden mt-1">
    <div
      id="sb-editor"
      class="flex-grow overflow-auto"
      bind:this={editorElement}
    />
  </div>
</div>

{#if errorMsg !== ""}
  <div
    class="status fixed min-w-[12em] border px-2 py-1 text-sm bg-white text-red-500 whitespace-pre"
  >
    {errorMsg}
  </div>
{/if}

{#if flashMsg !== ""}
  <div class="fixed flash-msg bg-yellow-100 border px-2 py-1 text-sm">
    {flashMsg}
  </div>
{/if}

{#if showingCommandPalette}
  <CommandPalette
    names={commandPalettePageNames}
    commands={commandPaletteCommands}
    onSelected={onCommandPaletteSelected}
    startSearchTem={commadnPaletteSearchTerm}
    bind:open={showingCommandPalette}
    allowCreateOnEnter={true}
  />
{/if}

<style>
  .g {
    font-family: Inter, ui-sans-serif, system-ui, -apple-system,
      BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans,
      sans-serif, Apple Color Emoji, Segoe UI Emoji, Segoe UI Symbol,
      Noto Color Emoji;
  }

  .flash-msg {
    top: 52px;
    right: 8px;
  }

  .status {
    left: 4px;
    bottom: 4px;
  }
  /* have to undo some of the taildwindcss reset */

  /* :global(.codemirror-wrapper) {
    height: 100%;
    background-color: transparent;
  }
  :global(.cm-editor) {
    overflow: hidden;
    height: 100%;
  }

  .codemirror-wrapper :global(.cm-focused) {
    outline: none;
  } */

  .user-modify-plain {
    -webkit-user-modify: read-write-plaintext-only;
  }
  .note-title[placeholder]:empty::before {
    content: attr(placeholder);
    @apply text-gray-400 italic font-normal;
  }

  /* .note-title[placeholder]:empty:focus::before {
    content: "";
  } */
</style>
