<script>
  /** @typedef { import("@codemirror/state").Extension} Extension */
  /** @typedef {import("./notesStore").Note} Note */

  import { debounce, len, pluralize, throwIf } from "./lib/util";
  import { onMount } from "svelte";
  import {
    noteAddVersion,
    noteGetCurrentVersion,
    getNotes,
    newNote,
    noteGetTitle,
    noteSetTitle,
    changeToRemoteStore,
    changeToLocalStore,
    noteDelete,
    noteGetLastModified,
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
  import { nanoid } from "./lib/nanoid";

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

  /** @type {Note} */
  let note;

  let title;
  /** @type {HTMLElement}*/
  let titleEl;

  let debouncedTitleChanged = debounce(titleChanged, 500);

  $: noteChanged(note);
  $: debouncedTitleChanged(title);

  async function titleChanged(title) {
    if (!title || !note) {
      return;
    }
    let prevTitle = noteGetTitle(note);
    if (prevTitle === title) {
      return;
    }
    log(`titleChanged: '${prevTitle}' => '${title}'`);
    noteSetTitle(note, title);
    notes = notes;
  }

  async function noteChanged(note) {
    if (!note) {
      return;
    }
    log("noteChanged:", note);
    title = noteGetTitle(note);
    let s = await noteGetCurrentVersion(note);
    setEditorText(s);
  }

  async function handleDocChanged(tr) {
    let s = editor.getText();
    await noteAddVersion(note, s);
  }

  let flashMsg = "";

  /**
   * @param {string} s
   */
  async function setEditorText(s) {
    // TODO: will need to change extensions based on
    // type of s
    editor.setText(s);
  }

  async function deleteCurrentNote() {
    log("deleteCurrentNote:", note);
    notes = await noteDelete(note);
    /** @type {Note} */
    let newNote = null;
    if (len(notes) === 0) {
      await createNewNote();
      return;
    }
    // TODO: this should use navigation stack
    newNote = notes[0];
    await openNote(newNote);
  }

  async function onNoteOrCommandSelected(kind, idx, item) {
    log("onNoteOrCommandSelected:", kind, idx, item);
    if (kind === kSelectedName) {
      if (idx === -1) {
        await createNewNote(item);
      } else {
        let n = notes[idx];
        await openNote(n);
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
    let nNotes = len(notes);
    commandPalettePageNames.length = nNotes;
    for (let i = 0; i < nNotes; i++) {
      let n = notes[i];
      let title = noteGetTitle(n);
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
    await openNote(n);
    if (title === "") {
      titleEl.focus();
    }
    notes = await getNotes();
  }

  async function logoutGitHub() {
    log("logoutGitHub");
    logout();
    changeToLocalStore();
    await setLastNote();
  }

  /**
   * @param {Note} n
   */
  async function openNote(n) {
    log("openNote:", n, n ? noteGetTitle(n) : "");
    if (!n) {
      note = null;
      editor.currentNote = null;
      return;
    }
    if (note === n) {
      editor.focus();
      return;
    }
    // pre-cache the note content to avoid visible switch
    await noteGetCurrentVersion(n);
    note = n;
    editor.currentNote = n;
    if (noteGetTitle(n) !== "") {
      editor.focus();
    }
  }

  async function setLastNote() {
    notes = await getNotes();
    let nNotes = len(notes);
    log("notes:", nNotes);
    if (nNotes === 0) {
      await createNewNote();
    } else {
      let currNote = notes[nNotes - 1];
      await openNote(currNote);
    }
  }

  async function setLastModifiedNote() {
    notes = await getNotes();
    let nNotes = len(notes);
    log("notes:", nNotes);
    if (nNotes === 0) {
      await createNewNote();
    } else {
      // TODO: could optimize by doing a single scan
      let currNote = pickLastModifiedNote(notes);
      await openNote(currNote);
    }
  }

  /**
   * @param {Note[]} notes
   * @returns {Note}
   */
  function pickLastModifiedNote(notes) {
    let time = 0;
    let res = null;
    for (let n of notes) {
      let t = noteGetLastModified(n);
      if (t > time) {
        time = t;
        res = n;
      }
    }
    return res;
  }

  function sortNotesByLastModified(notes) {
    let res = [...notes];
    res.sort((a, b) => {
      let aTime = noteGetLastModified(a);
      let bTime = noteGetLastModified(b);
      return aTime - bTime;
    });
    return res;
  }

  /**
   * @param {string} name
   * @returns {Promise<boolean>} true if state was restored
   */
  async function loadNoteByName(name) {
    // TODO: implement state restoration logic
    let stateWasRestored = true;
    log("loadNoteByName:", name);
    let notes = await getNotes();
    for (let n of notes) {
      let title = noteGetTitle(n);
      if (title === name) {
        await openNote(n);
        return stateWasRestored;
      }
    }
    return stateWasRestored;
  }

  async function useLocalStore() {
    log("useLocalStore");
    // TODO: clewar remote store cache
    changeToLocalStore();
  }

  async function useRemoteStore() {
    // TODO: clear local store data
    changeToRemoteStore();
  }

  onMount(async () => {
    let id = nanoid(8);
    log("Noted onMount, id:", id);

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

    editor = new Editor(editorElement);
    editor.loadPage = loadNoteByName;
    log("editor:", editor);
    setEditor(editor);
    editor.docChanged = debounce(handleDocChanged, 1000);
    document.addEventListener("keydown", onKeyDown);

    await setLastModifiedNote();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
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
      class="note-title px-2 ml-[-0.125rem] user-modify-plain text-xl font-semibold focus-within:outline-none bg-white placeholder:italic hover:bg-gray-50 border-t border-l border-r border-gray-400 rounded-t-md"
    />
    <button
      use:gtooltip={"create new note"}
      on:click={() => createNewNote("")}
      class="cursor-pointer text-xl px-2 hover:bg-gray-50"
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
            <button
              on:click={logoutGitHub}
              class="hover:bg-gray-100 py-0.5 px-4 min-w-[6rem]">Logout</button
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
