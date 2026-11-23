<script lang="ts">
  import { resolve } from "$app/paths";
  import { Button } from "#components/ui/button/index.js";
</script>

<Button href={resolve("/settings")} variant="outline" size="icon-lg" aria-label="Profile & settings">
  <span class="icon-[lucide--user-round] shrink-0 size-4"></span>
</Button>
