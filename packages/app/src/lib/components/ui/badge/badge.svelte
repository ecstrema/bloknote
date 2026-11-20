<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { cn } from "#lib/utils.js";

  let {
    class: className,
    variant = "default",
    children,
    "data-slot": dataSlot = "badge",
    ...restProps
  }: HTMLAttributes<HTMLSpanElement> & {
    variant?: "default" | "secondary" | "destructive" | "outline";
    children?: Snippet;
  } = $props();
</script>

<span
  data-slot={dataSlot}
  class={cn(
    "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium transition-[color,box-shadow] [&>svg]:pointer-events-none [&>svg]:size-3",
    variant === "default" && "border-transparent bg-primary text-primary-foreground",
    variant === "secondary" && "border-transparent bg-secondary text-secondary-foreground",
    variant === "destructive" && "border-transparent bg-destructive text-white",
    variant === "outline" && "text-foreground",
    className,
  )}
  {...restProps}
>
  {@render children?.()}
</span>
