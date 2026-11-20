<script lang="ts">
  import { Badge } from "#components/ui/badge/index.js";
  import CloudOffIcon from "@lucide/svelte/icons/cloud-off";
</script>

<Badge
  variant="outline"
  class="border-dashed text-muted-foreground"
  title="Saved offline — will sync to your Atmosphere account when back online"
>
  <CloudOffIcon aria-hidden="true" />
  Saved offline
</Badge>
