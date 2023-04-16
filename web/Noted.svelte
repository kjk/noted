<script>
  /** @typedef { import("@codemirror/state").Extension} Extension */

  import {
    EditorView,
    keymap,
    placeholder as placeholderExt,
  } from "@codemirror/view";
  import { EditorState } from "@codemirror/state";
  import { debounce, len, throwIf } from "./lib/util";
  import { basicSetup2 } from "./lib/cmexts";
  import { onMount } from "svelte";
  import { indentUnit } from "@codemirror/language";
  import { indentWithTab } from "@codemirror/commands";
  import { focusEditorView } from "./lib/cmutil";
  import {
    Note,
    addNoteVersion,
    getNoteCurrentVersion,
    getNotes,
    setNoteTitle,
    setNotes,
  } from "./noteddb";
  import { Editor } from "./editor";
  import GlobalTooltip, { gtooltip } from "./lib/GlobalTooltip.svelte";

  let notes = [];

  /** @type {HTMLElement} */
  let editorElement = null;
  /** @type {Editor} */
  let editor;
  let outputMsg = "";
  let statusMsg = "";
  let errorMsg = "";

  /** @type {import("./noteddb").Note} */
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
    console.log("titleChanged:", title);
    setNoteTitle(note, title);
    await setNotes(notes);
    notes = notes;
  }

  async function noteChanged(note) {
    if (!note) {
      return;
    }
    console.log("noteChanged:", note);
    title = note.title;
    let s = await getNoteCurrentVersion(note);
    setEditorText(s);
  }

  function clearOutput() {
    outputMsg = "";
    errorMsg = "";
  }

  async function handleDocChanged(tr) {
    let s = editor.getText();
    await addNoteVersion(note, s);
    await setNotes(notes);
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

  function setProcessingMessage(s) {
    statusMsg = s;
    clearErrorMessage();
  }

  function clearProcessingMessage() {
    setProcessingMessage("");
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
    if (ev.key === "Enter") {
      ev.stopPropagation();
      ev.preventDefault();
      editor.focus();
      return;
    }
  }

  async function newNote(title, type = "md") {
    let note = new Note();
    note.title = title;
    note.type = type;
    notes.push(note);
    await setNotes(notes);
    return note;
  }

  async function createNewNote() {
    console.log("createNewNote");
    note = await newNote("");
    titleEl.focus();
  }

  /**
   * @param {Note} n
   */
  function openNote(n) {
    note = n;
  }

  onMount(async () => {
    notes = await getNotes();
    let nNotes = len(notes);
    console.log("notes:", nNotes);

    editor = new Editor(editorElement);
    editor.docChanged = debounce(handleDocChanged, 1000);
    document.addEventListener("keydown", onKeyDown);

    clearProcessingMessage();

    if (nNotes === 0) {
      await createNewNote();
    } else {
      note = notes[nNotes - 1];
      for (let n of notes) {
        console.log(n.title);
      }
    }

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
    class="mx-[22px] flex items-baseline max-w-[var(--editor-width)] px-[20px]"
  >
    <div
      tabindex="0"
      use:gtooltip={"click to edit title, <b><tt>Ctrl + 1</tt></b> to switch"}
      bind:this={titleEl}
      on:keydown={onTitleKeyDown}
      contenteditable="true"
      bind:textContent={title}
      role="textbox"
      aria-multiline="false"
      class="grow px-0.5 ml-[-0.125rem] block user-modify-plain text-xl font-semibold focus-within:outline-white bg-white"
    />
    <div
      use:gtooltip={"click for a list, <b>Ctrl + K</b> to invoke"}
      class="cursor-pointer"
    >
      {len(notes)} notes
    </div>
    <button
      use:gtooltip={"<b>Ctrl + Shift + N</b>"}
      on:click={createNewNote}
      class="relative text-sm border ml-4 border-gray-500 hover:bg-gray-100 rounded-md py-0.5 px-2"
      >new note</button
    >
  </div>

  <div id="sb-main" class="overflow-auto mt-1">
    <div id="sb-editor" class="flex-grow" bind:this={editorElement} />
  </div>

  {#if len(notes) === 0}
    <div />
  {:else}
    <div class="bg-gray-50 flex items-baseline gap-x-2">
      <div>Recent notes:</div>
      {#each notes as n, i}
        {@const n2 = notes[len(notes) - 1 - i]}
        {#if i < 4}
          <button
            class="underline max-w-[6rem] truncate"
            on:click={() => openNote(n2)}>{n2.title}</button
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

{#if statusMsg != ""}
  <div class="status fixed bg-yellow-100 min-w-[12em] border px-2 py-1 text-sm">
    {statusMsg}
  </div>
{/if}

{#if errorMsg !== ""}
  <div
    class="status fixed min-w-[12em] border px-2 py-1 text-sm bg-white text-red-500 whitespace-pre"
  >
    {errorMsg}
  </div>
{/if}

{#if outputMsg !== ""}
  <div
    class="output flex flex-col fixed text-xs shadow-md border border-gray-400 rounded-lg bg-white px-1"
  >
    <div class="flex bg-gray-50 border-b mb-1 pb-1 pt-1">
      <div class="font-bold">Output</div>
      <div class="grow" />
      <button
        on:click={clearOutput}
        class="hover:bg-gray-400 text-xs hover:text-white text-gray-600 mr-1"
        >close</button
      >
    </div>
    <div class="overflow-auto">
      <pre><code>{outputMsg}</code></pre>
    </div>
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

  .output {
    max-height: 80vh;
    min-height: 12em;
    width: 50%;
    right: 1em;
    bottom: 1em;
    /* border-color: blue; */
    /* border-width: 1px; */
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
</style>