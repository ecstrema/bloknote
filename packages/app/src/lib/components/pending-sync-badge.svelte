<script lang="ts">
  import { Badge } from "#components/ui/badge/index.js";
</script>

<Badge
  variant="outline"
  class="border-dashed text-muted-foreground"
  title="Saved offline — will sync to your Atmosphere account when back online"
>
  <span aria-hidden="true" class="icon-[lucide--cloud-off] shrink-0 size-4"></span>
  Saved offline
</Badge>
