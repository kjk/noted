<script>
  import { onMount, tick } from "svelte";
  import Overlay from "./lib/Overlay.svelte";
  import { len, clamp } from "./lib/util.js";
  import { scrollintoview } from "./actions/scrollintoview.js";
  import * as keys from "./lib/keys.js";
  import { focus } from "./actions/focus";

  export let open = false;
  export let items = [];
  export let allowCreateOnEnter = false;
  export let onSelected = (idx, item) => {};

  let filteredItems = items;
  let searchTerm = "";
  let selectedIdx = 0;
  let ignoreNextMouseEnter = false;

  /** @type {HTMLElement} */
  let inputEl;

  function getMatchingItems(s) {
    if (s === "") {
      return items;
    }
    s = s.toLowerCase();
    const a = [];
    for (let lng of items) {
      const lng2 = lng.toLowerCase();
      if (lng2.includes(s)) {
        a.push(lng);
      }
    }
    return a;
  }

  function filterItems(searchTerm) {
    // current selection is invalidated after changing the list
    // in that case reset selection to first item
    // TODO: could be smarter about which item to select (i.e. if
    // previously selected is in the new list, preserve it)
    const nPrev = len(filteredItems);
    filteredItems = getMatchingItems(searchTerm);
    if (nPrev !== len(filteredItems)) {
      selectedIdx = 0;
    }
  }

  $: filterItems(searchTerm);

  /**
   * @param {KeyboardEvent} ev
   */
  function handleKeyDown(ev) {
    // console.log("handleKeyDown", ev.code);
    if (ev.code === "Enter") {
      const item = filteredItems[selectedIdx];
      if (typeof item === "string") {
        selectItem(item);
        return;
      }
      if (allowCreateOnEnter && searchTerm !== "") {
        onSelected(-1, searchTerm);
        return;
      }
      return;
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
    // changing selected element triggers mouseenter
    // on the element so we have to supress it
    ignoreNextMouseEnter = true;
  }

  function mouseEnter(idx) {
    if (ignoreNextMouseEnter) {
      ignoreNextMouseEnter = false;
      return;
    }
    selectedIdx = idx;
  }

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  });

  function selectItem(item) {
    let idx = items.indexOf(item);
    onSelected(idx, item);
  }
</script>

<Overlay bind:open>
  <div
    class="dialog min-w-[44ch] fixed flex flex-col bg-white border shadow-md"
  >
    <!-- svelte-ignore a11y-autofocus -->

    <input
      bind:this={inputEl}
      class="outline-none border mx-3 mb-2 mt-3 px-2 py-1 text-sm"
      bind:value={searchTerm}
      use:focus
      autocomplete="off"
    />

    <div class="overflow-y-auto my-2">
      {#each filteredItems as item, idx}
        {@const item2 = item || "(empty)"}
        {#if idx === selectedIdx}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <div
            class="cursor-pointer px-3 py-1 bg-gray-100"
            use:scrollintoview
            on:click={() => selectItem(item)}
          >
            {item2}
          </div>
        {:else}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <div
            class="cursor-pointer px-3 py-1"
            on:click={() => selectItem(item)}
            on:mouseenter={() => mouseEnter(idx)}
          >
            {item2}
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
    {#if allowCreateOnEnter && searchTerm !== ""}
      <div
        class="flex justify-between text-xs px-2 py-1 bg-gray-50 text-gray-600"
      >
        <div>Enter: crete <b>{searchTerm}</b> page</div>
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
