<script>
  /** @typedef { import("@codemirror/state").Extension} Extension */
  /** @typedef {import("./notesStore").Note} Note */

  import { debounce, len, pluralize } from "./lib/util";
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
  } from "./notesStore";
  import { Editor } from "./editor";
  import GlobalTooltip, { gtooltip } from "./lib/GlobalTooltip.svelte";
  import GitHub from "./icons/GitHub.svelte";
  import {
    githubUserInfo,
    logout,
    openLoginWindow,
    setOnGitHubLogin,
  } from "./lib/github_login";
  import SvgArrowDown from "./svg/SvgArrowDown.svelte";
  import { refreshGitHubTokenIfNeeded } from "./lib/github_login";

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
    console.log(`titleChanged: '${prevTitle}' => '${title}'`);
    noteSetTitle(note, title);
    notes = notes;
  }

  async function noteChanged(note) {
    if (!note) {
      return;
    }
    console.log("noteChanged:", note);
    title = noteGetTitle(note);
    let s = await noteGetCurrentVersion(note);
    setEditorText(s);
  }

  function clearOutput() {
    errorMsg = "";
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

  function setErrorMessage(s) {
    errorMsg = s;
  }
  function clearErrorMessage() {
    setErrorMessage("");
  }

  /**
   * @param {KeyboardEvent} ev
   */
  function onKeyDown(ev) {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
    } else if ((ev.ctrlKey || ev.metaKey) && ev.key === "s") {
    } else if (ev.key === "Escape") {
      clearOutput();
    } else {
      return;
    }

    ev.preventDefault();
    ev.stopPropagation();
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

  async function createNewNote() {
    console.log("createNewNote");
    note = await newNote("");
    titleEl.focus();
  }

  async function loginGitHub() {
    console.log("loginGitHub");
    openLoginWindow();
  }

  async function logoutGitHub() {
    console.log("logoutGitHub");
    logout();
    changeToLocalStore();
    await setLastNote();
  }

  /**
   * @param {Note} n
   */
  function openNote(n) {
    note = n;
  }

  async function setLastNote() {
    notes = await getNotes();
    let nNotes = len(notes);
    console.log("notes:", nNotes);
    if (nNotes === 0) {
      await createNewNote();
      notes = await getNotes();
    } else {
      note = notes[nNotes - 1];
      for (let n of notes) {
        let title = noteGetTitle(n);
        console.log(title);
      }
    }
  }

  async function doOnGitHubLogin() {
    console.log("doOnGitHubLogin");
    note = null;
    changeToRemoteStore();
    await setLastNote();
  }

  onMount(async () => {
    console.log("onMount");
    setOnGitHubLogin(doOnGitHubLogin);
    refreshGitHubTokenIfNeeded();

    notes = await getNotes();
    let nNotes = len(notes);
    console.log("notes:", nNotes);

    editor = new Editor(editorElement);
    console.log("editor:", editor);
    editor.docChanged = debounce(handleDocChanged, 1000);
    document.addEventListener("keydown", onKeyDown);

    await setLastNote();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // TODO: probably not needed as we aggresively save on changes
      // setNotes(notes);
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
      class="note-title grow px-0.5 ml-[-0.125rem] block user-modify-plain text-xl font-semibold focus-within:outline-white bg-white placeholder:italic"
    />
    <div
      use:gtooltip={"click for a list, <b>Ctrl + K</b> to invoke"}
      class="cursor-pointer text-sm flex items-center gap-x-2 hover:bg-gray-100 px-2 py-0.5"
    >
      <div>{len(notes)}</div>
      <div>{pluralize("note", len(notes))}</div>
      <SvgArrowDown class="w-2 h-2" />
    </div>
    <button
      use:gtooltip={"<b>Ctrl + Shift + N</b>"}
      on:click={createNewNote}
      class="relative text-sm border ml-2 border-gray-300 hover:bg-gray-100 rounded-md py-0.5 px-2"
      >new note</button
    >

    {#if $githubUserInfo}
      <div
        class="relative group flex items-center gap-x-2 hover:bg-gray-100 cursor-pointer px-2 ml-2 py-1"
      >
        <img
          class="avatar"
          src={$githubUserInfo.avatar_url}
          width="20"
          height="20"
          alt="kjk"
        />
        <div class="text-sm">{$githubUserInfo.login}</div>
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
      <button
        use:gtooltip={"LogIn with GitHub"}
        on:click={loginGitHub}
        class="relative flex items-center text-sm border ml-2 border-gray-500 hover:bg-gray-100 rounded-md py-0.5 px-2"
        ><GitHub class="mt-[1px]" />
        <div class="ml-1.5">login</div></button
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

  {#if len(notes) === 0}
    <div />
  {:else}
    <div class="bg-gray-50 flex items-baseline gap-x-2">
      <div>Recent notes:</div>
      {#each notes as n, i}
        {@const n2 = notes[len(notes) - 1 - i]}
        {@const title = noteGetTitle(n2)}
        {#if i < 4}
          <button
            class="underline max-w-[6rem] truncate"
            on:click={() => openNote(n2)}>{title}</button
          >
          {#if i < 3}
            <!-- <div>&bull;</div> -->
          {/if}
        {/if}
      {/each}
      {#if len(notes) > 3}
        {@const n = len(notes) - 3}
        <div class="flex">
          <div>and</div>
          <button class="underline ml-1">{n} more</button>
        </div>
      {/if}
    </div>
  {/if}
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
