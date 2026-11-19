<script lang="ts">
  import { cn, type WithElementRef } from "#lib/utils.js";
  import type { HTMLAttributes } from "svelte/elements";

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLUListElement>> = $props();
</script>

<ul
  bind:this={ref}
  data-slot="sidebar-menu-sub"
  data-sidebar="menu-sub"
  class={cn(
    "border-sidebar-border ms-2.5 translate-x-px gap-0 border-l ps-1 py-0 group-data-[collapsible=icon]:hidden flex min-w-0 flex-col",
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</ul>
