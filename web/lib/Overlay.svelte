<script>
  import { onDestroy } from "svelte";
  import { trapFocus } from "./util";

  export let open = false;
  export let closeOnEsc = true;

  let overlay = null;

  function close() {
    open = false;
  }

  /**
   * @param {MouseEvent} ev
   */
  function handleClick(ev) {
    if (ev.target == overlay) {
      // clicked on overlay => dismiss
      console.log("Overlay: handleClick: outside", ev);
      ev.stopPropagation();
      close();
    }
  }

  /**
   * @param {KeyboardEvent} e
   */
  function handleKeyDown(e) {
    // console.log("Overlay: handleKeyDown", e);
    if (closeOnEsc && e.key === "Escape") {
      close();
      return;
    }

    if (e.key === "Tab") {
      trapFocus(overlay, e);
      e.preventDefault();
      return;
    }

    // e.stopPropagation();
  }

  const previouslyFocused = /** @type {HTMLElement} */ (
    typeof document !== "undefined" && document.activeElement
  );
  if (previouslyFocused) {
    // console.log("Overlay: captured previouslyFocused:", previouslyFocused);
    onDestroy(() => {
      // console.log("Overlay: restoring focus to:", previouslyFocused);
      previouslyFocused.focus();
    });
  }
</script>

{#if open}
  <!-- svelte-ignore a11y-no-noninteractive-tabindex -->
  <div
    tabindex="0"
    class="fixed inset-0 z-50 flex bg-gray-600 bg-opacity-40 text-black"
    bind:this={overlay}
    on:click={handleClick}
    on:keydown={handleKeyDown}
  >
    <slot />
  </div>
{/if}
