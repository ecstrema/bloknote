<script lang="ts">
  import { dev } from "$app/env";
  import { onMount } from "svelte";
  import { Button } from "#components/ui/button/index.js";
  import * as Dialog from "#components/ui/dialog/index.js";

  const DISMISS_KEY = "bloknote:pre-alpha-dismissed";

  let open = $state(false);

  onMount(() => {
    // The warning targets end users of the deployed site: local development runs skip it
    open = !dev && !localStorage.getItem(DISMISS_KEY);
  });

  /** Any way of closing the dialog (button, X, Escape, outside click) counts as a dismissal */
  function onOpenChange(next: boolean) {
    open = next;
    if (!next) localStorage.setItem(DISMISS_KEY, "true");
  }
</script>

<Dialog.Root {open} {onOpenChange}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2">
        <span class="icon-[lucide--triangle-alert] size-5 shrink-0 text-destructive"></span>
        Pre-alpha software
      </Dialog.Title>
      <Dialog.Description>
        Bloknote is in very early development and might break at any time: data can be incomplete
        or wrong, and features can change or disappear without notice.
      </Dialog.Description>
    </Dialog.Header>
    <Dialog.Footer>
      <Button onclick={() => onOpenChange(false)}>I understand</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
