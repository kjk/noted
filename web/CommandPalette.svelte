<script context="module">
  export const kSelectedName = 1;
  export const kSelectedCommand = 2;
</script>

<script>
  import { onMount } from "svelte";
  import Overlay from "./lib/Overlay.svelte";
  import { len, clamp } from "./lib/util.js";
  import { scrollintoview } from "./actions/scrollintoview.js";
  import * as keys from "./lib/keys.js";
  import { focus } from "./actions/focus";
  import browser from "./lib/browser";

  export let open = false;
  /** @type {string[]} */
  export let names = [];
  /** @type {string[]} */
  export let commands = [];
  /** @type {string} */
  export let startSearchTem = "";
  export let allowCreateOnEnter = false;
  export let onSelected = (kind, idx, item) => {};

  /** @type {string[]}*/
  let namesLowerCase = [];
  /** @type {string[]}*/
  let commandsLowerCase = [];
  /** @type {number[]}*/
  let filteredItems = [];
  let selectedFrom = kSelectedName;

  let searchTerm = "";
  let selectedIdx = 0;

  let createShortcut = "Ctrl + Enter";
  if (browser.mac) {
    createShortcut = "⌘ + Enter";
  }

  /** @type {HTMLElement} */
  let inputEl;

  $: filterItems(searchTerm);

  /**
   * @param {string} searchTerm
   */
  function filterItems(searchTerm) {
    // current selection is invalidated after changing the list
    // in that case reset selection to first item
    let selectedItem = -1;
    let dst = filteredItems;
    if (selectedIdx >= 0 && selectedIdx < len(dst)) {
      selectedItem = dst[selectedIdx];
    }
    let prevSelectedFrom = selectedFrom;
    let s = searchTerm.trim();
    selectedFrom = kSelectedName;
    let src = namesLowerCase;
    if (s.startsWith(">")) {
      selectedFrom = kSelectedCommand;
      s = s.slice(1).trim();
      src = commandsLowerCase;
    }
    if (s === "") {
      resetFilteredItems(selectedFrom);
      selectedIdx = 0;
      // if (selectedItem !== -1 && selectedFrom === prevSelectedFrom) {
      //   selectedIdx = selectedItem;
      // }
      return;
    }

    s = s.toLowerCase();
    let idx = 0;
    let nSrc = len(src);
    for (let i = 0; i < nSrc; i++) {
      const item = src[i];
      if (!item.includes(s)) {
        continue;
      }
      dst[idx] = i;
      if (i === selectedItem) {
        selectedIdx = idx;
      }
      idx++;
    }
    dst.length = idx;
    filteredItems = dst;
  }

  /**
   * @param {KeyboardEvent} ev
   */
  function isCreateNoteShortcut(ev) {
    if (browser.mac) {
      return ev.metaKey && ev.code === "Enter";
    }
    return ev.ctrlKey && ev.code === "Enter";
  }

  /**
   * @param {KeyboardEvent} ev
   */
  function handleKeyDown(ev) {
    // console.log("handleKeyDown", ev.code);
    if (
      selectedFrom == kSelectedName &&
      allowCreateOnEnter &&
      searchTerm !== "" &&
      isCreateNoteShortcut(ev)
    ) {
      onSelected(selectedFrom, -1, searchTerm);
      ev.stopPropagation();
      ev.preventDefault();
      return;
    }

    if (ev.code === "Enter") {
      const itemIdx = filteredItems[selectedIdx];
      if (typeof itemIdx === "number" && itemIdx >= 0 && itemIdx < len(names)) {
        selectItem(itemIdx);
        ev.stopPropagation();
        ev.preventDefault();
        return;
      }
    }

    let dir = 0;
    if (keys.isNavUp(ev)) {
      dir = -1;
    }
    if (keys.isNavDown(ev)) {
      dir = 1;
    }
    if (dir === 0) {
      return;
    }
    ev.stopPropagation();
    ev.preventDefault();

    selectedIdx = clamp(selectedIdx + dir, 0, len(filteredItems) - 1);
  }

  function mouseClick(idx) {
    console.log(`mouseClick: selectedIdx: ${selectedIdx}, idx: ${idx}`);
    selectedIdx = idx;
  }

  function resetFilteredItems(kind) {
    let nMaxFiltered = Math.max(len(names), len(commands));
    filteredItems.length = nMaxFiltered;
    for (let i = 0; i < nMaxFiltered; i++) {
      filteredItems[i] = i;
    }
    let n = len(names);
    if (kind === kSelectedCommand) {
      n = len(commands);
    }
    filteredItems.length = n;
    selectedFrom = kind;
  }

  function makeLowerCased(src, dst) {
    let n = len(src);
    dst.length = n;
    for (let i = 0; i < n; i++) {
      let s = src[i];
      // TODO: temporary
      if (typeof s !== "string") {
        s = s.toString();
      }
      dst[i] = s.toLowerCase();
    }
  }

  onMount(() => {
    selectedIdx = 0;
    searchTerm = startSearchTem;
    makeLowerCased(names, namesLowerCase);
    makeLowerCased(commands, commandsLowerCase);

    let nMaxFiltered = Math.max(len(names), len(commands));
    filteredItems = Array(nMaxFiltered);
    resetFilteredItems(kSelectedName);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  });

  /**
   * @param {number} itemIdx
   */
  function selectItem(itemIdx) {
    let item = getItem(itemIdx);
    onSelected(selectedFrom, itemIdx, item);
  }

  function getItem(idx) {
    let a = names;
    if (selectedFrom === kSelectedCommand) {
      a = commands;
    }
    return a[idx] || "(no title)";
  }
</script>

<Overlay bind:open>
  <div
    class="dialog min-w-[44ch] fixed flex flex-col bg-white border shadow-md text-sm"
  >
    <!-- svelte-ignore a11y-autofocus -->

    <input
      bind:this={inputEl}
      placeholder="Search notes by title"
      class="outline-none border mx-3 mb-2 mt-3 px-2 py-1 text-sm"
      bind:value={searchTerm}
      use:focus
      autocomplete="off"
    />

    <div class="overflow-y-auto my-2">
      {#each filteredItems as itemIdx, idx}
        {@const item = getItem(itemIdx)}
        {#if idx === selectedIdx}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <div
            class="cursor-pointer px-3 py-0.5 bg-gray-100 hover:bg-gray-200"
            use:scrollintoview
            on:dblclick={() => selectItem(itemIdx)}
          >
            {item}
          </div>
        {:else}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <div
            class="cursor-pointer px-3 py-0.5 hover:bg-gray-200"
            on:dblclick={() => selectItem(itemIdx)}
            on:click={() => mouseClick(idx)}
          >
            {item}
          </div>
        {/if}
      {/each}
    </div>

    <div
      class="flex justify-between text-xs px-2 py-1 bg-gray-50 text-gray-600"
    >
      <div>&uarr; &darr; to navigate</div>
      <div>&nbsp; &crarr; to select</div>
      <div>Esc to close</div>
    </div>
    {#if selectedFrom === kSelectedName && allowCreateOnEnter && searchTerm !== ""}
      <div
        class="flex justify-between text-xs px-2 py-1 bg-gray-50 text-gray-600"
      >
        <div>{createShortcut}: crete <b>{searchTerm}</b> page</div>
      </div>
    {/if}
  </div>
</Overlay>

<style>
  .dialog {
    top: 108px;
    max-height: calc(100vh - 108px - 10vh);
    left: calc(50% - 140px);
  }
</style>
