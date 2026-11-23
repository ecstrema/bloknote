<script lang="ts">
  import { getAppState } from "#lib/data/app-state.js";
  import { Button } from "#components/ui/button/index.js";
    
  const appState = getAppState();

  function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
  }

  function onKeydown(event: KeyboardEvent) {
    if (!appState.osmUser.loggedIn || isEditableTarget(event.target)) return;
    const mod = event.metaKey || event.ctrlKey;
    if (!mod || event.altKey) return;

    const key = event.key.toLowerCase();
    if (key === "z" && !event.shiftKey) {
      if (!appState.undoStack.canUndo) return;
      event.preventDefault();
      appState.undoStack.undo();
    } else if ((key === "z" && event.shiftKey) || (key === "y" && !event.shiftKey)) {
      if (!appState.undoStack.canRedo) return;
      event.preventDefault();
      appState.undoStack.redo();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if appState.osmUser.loggedIn && (appState.undoStack.canUndo || appState.undoStack.canRedo)}
  <div class="flex items-center gap-1">
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={!appState.undoStack.canUndo}
      onclick={() => appState.undoStack.undo()}
      aria-label="Undo"
      title="Undo (Ctrl+Z)"
    >
      <span class="icon-[lucide--undo-2] shrink-0 size-4"></span>
    </Button>
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={!appState.undoStack.canRedo}
      onclick={() => appState.undoStack.redo()}
      aria-label="Redo"
      title="Redo (Ctrl+Shift+Z)"
    >
      <span class="icon-[lucide--redo-2] shrink-0 size-4"></span>
    </Button>
  </div>
{/if}
