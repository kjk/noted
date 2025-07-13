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
    deleteRemoteStoreCache,
    getNotesSync,
    getLastModifiedNote,
    getNoteID,
  } from "./notesStore";
  import { Editor } from "./editor";
  import GlobalTooltip, { gtooltip } from "./lib/GlobalTooltip.svelte";
  import GitHub from "./icons/GitHub.svelte";
  import { userInfo, getLoggedUser } from "./lib/login";
  import SvgArrowDown from "./svg/SvgArrowDown.svelte";
  import CommandPalette, {
    kSelectedCommand,
    kSelectedName,
  } from "./CommandPalette.svelte";
  import browser from "./lib/browser";
  import { setEditor } from "./plug-api/silverbullet-syscall/mod";
  import { log } from "./lib/log";
  import { setNavigationCallback } from "./navigator";
  import RenameNote from "./RenameNote.svelte";

  class TabInfo {
    /** @type {Note} */
    note = null;
    title = "";
    isCurrent = false;

    constructor(title = "") {
      this.title = title;
    }
  }

  /** @type {TabInfo[]}*/
  let tabs = [];

  let commandPaletteNotes = [];
  let commandPalettePageNames = [];
  let commandPaletteCommands = ["Delete Note", "Rename Note"];
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

  let notesCount = 0;

  /** @type {HTMLElement} */
  let editorElement;
  /** @type {Editor} */
  let editor;
  let errorMsg = "";

  let showingRename = false;
  let renameTitle = "";

  $: showingRanameToggle(showingRename);

  function showingRanameToggle(showing) {
    if (editor && !showing) {
      log("showingRanameToggle: false");
      editor.focus();
    }
  }

  async function onNoteRename(newTitle) {
    log(`onNoteRename: new: ${newTitle}, old: ${renameTitle}`);
    showingRename = false;
    if (newTitle === renameTitle) {
      return;
    }
    let note = editor.currentNote;
    if (!note) {
      return;
    }

    log(`titleChanged: '${renameTitle}' => '${newTitle}'`);
    // TODO: move this end to make perceived speed faster?
    await setNoteTitle(note, newTitle);

    log("titleChanged: done");
    // TODO: a better way to update tab title? Maybe remember the tab being modified?
    let noteID = getNoteID(note);
    for (let tab of tabs) {
      if (!tab.note) {
        continue;
      }
      let tabNoteID = getNoteID(tab.note);
      if (tabNoteID === noteID) {
        tab.title = newTitle;
        break;
      }
    }
    tabs = tabs;
  }

  let flashMsg = "";

  function viewDispatch(args) {
    let kind = args.type;
    log("viewDispatch:", args);
    switch (kind) {
      case "page-loaded":
        // TODO: fix up url if doesn't represent the state exactly
        let note = args.note;
        let title = getNoteTitle(note);
        document.title = title;
        break;
    }
  }

  async function deleteCurrentNote() {
    let note = editor.currentNote;
    log("deleteCurrentNote:", note);
    let notes = await deleteNote(note);
    notesCount = len(notes);
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
      } else if (item === "Rename Note") {
        renameTitle = getNoteTitle(editor.currentNote);
        showingRename = true;
      } else {
        throwIf(true, `unknown command: ${item}`);
      }
    } else {
      throwIf(true, `unknown kind: ${kind}`);
    }
    showingCommandPalette = false;
  }

  async function runCommandPalette(startWithCommands) {
    // log("selectPage");
    let notes = await getNotes();
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

  async function createNewNote(title = "") {
    log("createNewNote");
    if (title === "") {
      title = "Untitled";
    }
    let n = await newNote(title);
    await editor.navigate(n);
    let notes = await getNotes();
    notesCount = len(notes);
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
    if (note === null) {
      // TODO: handle no notes
      note = getLastModifiedNote();
      pos = 0;
    }
    let ti = new TabInfo();
    ti.note = note;
    ti.title = getNoteTitle(note);
    ti.isCurrent = true;
    let newTabs = [ti];
    // newTabs.push(new TabInfo("another tab"));
    // newTabs.push(new TabInfo("another tab"));
    // newTabs.push(new TabInfo("another tab"));
    // newTabs.push(new TabInfo("another tab"));
    // newTabs.push(new TabInfo("another tab"));
    // newTabs.push(new TabInfo("another tab"));

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
    tabs = newTabs;
    log("tabs:", tabs);
  }

  function selectTab(idx) {
    if (tabs[idx].isCurrent) {
      return;
    }
    for (let tab of tabs) {
      tab.isCurrent = false;
    }
    tabs[idx].isCurrent = true;
    tabs = tabs;
  }

  function renameTab(idx) {
    log("renameTab:", idx);
    let note = tabs[idx].note;
    throwIf(note !== editor.currentNote);
    renameTitle = getNoteTitle(note);
    showingRename = true;
  }

  function closeTab(idx) {
    if (len(tabs) < 2) {
      return;
    }
    tabs.splice(idx, 1);
    tabs = tabs;
    // if removed current tab, set another tab as current
    for (let tab of tabs) {
      if (tab.isCurrent) {
        return;
      }
    }
    let nTabs = len(tabs);
    if (idx >= nTabs) {
      idx = nTabs - 1;
    }
    tabs[idx].isCurrent = true;
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
    let notes = await getNotes();
    notesCount = len(notes);
    log("notes:", notesCount);

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
    {#each tabs as tab, idx}
      {@const isActive = tab.isCurrent}
      {@const cls = isActive ? "active-tab" : ""}
      {@const showClose = len(tabs) > 1}
      {@const cls2 = showClose ? "close-shown" : ""}
      {@const tt = tab.title}
      <div
        use:gtooltip={tt}
        class="flex items-baseline shrink min-w-0 group ml-[-0.125rem] font-semibold bg-white hover:bg-gray-50 hover:cursor-pointer {cls}"
      >
        <button
          on:click={() => selectTab(idx)}
          on:dblclick={() => renameTab(idx)}
          class="shrink truncate ml-4"
        >
          {tab.title}
        </button>
        <button
          use:gtooltip={"close tab"}
          on:click={() => closeTab(idx)}
          class="ml-1 mr-1 invisible group-hover:visible text-white {cls2}"
        >
          *
        </button>
      </div>
    {/each}
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
      <div>{notesCount}</div>
      <div>{pluralize("note", notesCount)}</div>
      <SvgArrowDown class="w-2 h-2" />
    </div>
    <button
      use:gtooltip={newNoteShortcut}
      on:click={() => createNewNote("")}
      class="relative text-sm border ml-2 border-gray-300 hover:bg-gray-100 rounded-md py-0.5 px-2 whitespace-nowrap"
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
            alt="User avatar"
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

{#if showingRename}
  <RenameNote
    bind:open={showingRename}
    title={renameTitle}
    onRenamed={onNoteRename}
  />
{/if}

<style>
  .g {
    font-family:
      Inter,
      ui-sans-serif,
      system-ui,
      -apple-system,
      BlinkMacSystemFont,
      Segoe UI,
      Roboto,
      Helvetica Neue,
      Arial,
      Noto Sans,
      sans-serif,
      Apple Color Emoji,
      Segoe UI Emoji,
      Segoe UI Symbol,
      Noto Color Emoji;
  }

  .active-tab {
    @apply border-t border-l border-r border-gray-400 mr-[2px];
  }

  .close-shown:hover {
    @apply text-red-400;
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
</style>
