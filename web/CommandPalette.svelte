<script>
  import { onMount, tick } from "svelte";
  import Overlay from "./lib/Overlay.svelte";
  import { len, clamp } from "./lib/util.js";
  import { scrollintoview } from "./actions/scrollintoview.js";
  import * as keys from "./lib/keys.js";
  import { focus } from "./actions/focus";

  export let open = false;
  /** @type {string[]}*/
  export let items = [];
  export let allowCreateOnEnter = false;
  export let onSelected = (idx, item) => {};

  /** @type {string[]}*/
  let itemsLowerCase = [];
  /** @type {number[]}*/
  let filteredItems = [];
  let searchTerm = "";
  let selectedIdx = 0;
  let ignoreNextMouseEnter = false;

  /** @type {HTMLElement} */
  let inputEl;

  $: filterItems(searchTerm);

  function getMatchingItems(s) {}

  /**
   * @param {string} searchTerm
   */
  function filterItems(searchTerm) {
    // current selection is invalidated after changing the list
    // in that case reset selection to first item
    let selectedItem = -1;
    let a = filteredItems;
    if (selectedIdx >= 0 && selectedIdx < len(a)) {
      selectedItem = a[selectedIdx];
    }
    let s = searchTerm.trim();
    if (s === "") {
      resetFilteredItems();
      if (selectedItem !== -1) {
        selectedIdx = selectedItem;
      }
      return;
    }

    s = s.toLowerCase();
    let idx = 0;
    for (let i = 0; i < len(items); i++) {
      const item = itemsLowerCase[i];
      if (!item.includes(s)) {
        continue;
      }
      a[idx] = i;
      if (i === selectedItem) {
        selectedIdx = idx;
      }
      idx++;
    }
    a.length = idx;
    filteredItems = a;
  }

  /**
   * @param {KeyboardEvent} ev
   */
  function handleKeyDown(ev) {
    // console.log("handleKeyDown", ev.code);
    if (ev.code === "Enter") {
      const itemIdx = filteredItems[selectedIdx];
      if (typeof itemIdx === "number" && itemIdx >= 0 && itemIdx < len(items)) {
        selectItem(itemIdx);
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

  function resetFilteredItems() {
    let nItems = len(items);
    filteredItems.length = nItems;
    for (let i = 0; i < nItems; i++) {
      filteredItems[i] = i;
    }
  }

  onMount(() => {
    let nItems = len(items);
    itemsLowerCase = Array(nItems);
    for (let i = 0; i < nItems; i++) {
      itemsLowerCase[i] = items[i].toLowerCase();
    }
    filteredItems = Array(nItems);
    resetFilteredItems();
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  });

  /**
   * @param {number} itemIdx
   */
  function selectItem(itemIdx) {
    let item = items[itemIdx];
    onSelected(itemIdx, item);
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
      {#each filteredItems as itemIdx, idx}
        {@const item = items[itemIdx] || "(empty)"}
        {#if idx === selectedIdx}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <div
            class="cursor-pointer px-3 py-1 bg-gray-100"
            use:scrollintoview
            on:click={() => selectItem(itemIdx)}
          >
            {item}
          </div>
        {:else}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <div
            class="cursor-pointer px-3 py-1"
            on:click={() => selectItem(itemIdx)}
            on:mouseenter={() => mouseEnter(idx)}
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
