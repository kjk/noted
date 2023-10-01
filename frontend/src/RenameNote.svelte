<script>
  import Overlay from "./lib/Overlay.svelte";
  import { log } from "./lib/log";
  import { focus } from "./actions/focus";

  export let open = false;
  export let title = "";
  export let onRenamed = (newTitle) => {};

  let newTitle = title;

  function cancel() {
    log("cancel");
    onRenamed(newTitle);
  }
  function rename() {
    log("rename");
    onRenamed(newTitle);
  }
  function onKeyDown(ev) {
    if (ev.key === "Enter") {
      onRenamed(newTitle);
    }
  }
</script>

<Overlay bind:open>
  <div class="dialog flex flex-col bg-white fixed px-4 py-2">
    <div>Rename '<b>{title}</b>' to:</div>
    <input
      use:focus
      class="mt-2 border w-[40ch] px-2 py-1"
      type="text"
      bind:value={newTitle}
      on:keydown={onKeyDown}
    />
    <div class="flex gap-x-2 mt-2">
      <div class="grow" />
      <button
        class="border border-gray-300 hover:bg-gray-200 px-2 py-1"
        on:click={cancel}>Cancel</button
      >
      <button
        class="border border-gray-300 hover:bg-gray-200 px-2 py-1"
        on:click={rename}>Rename</button
      >
    </div>
  </div>
</Overlay>

<style>
  .dialog {
    left: calc(50% - 140px);
    top: 108px;
  }
</style>
