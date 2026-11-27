<script lang="ts">
  import { atproto, previousHandles } from "#lib/data/network/atproto.svelte.js";
  import { Button } from "#components/ui/button/index.js";
  import { Input } from "#components/ui/input/index.js";

  /**
   * The Atmosphere (ATProto) login form, shared by the account page and the tick popups
   * (issues #253 and #263). Renders nothing while a session is already active.
   */
  let atHandle = $state("");
  let atConnecting = $state(false);
  let atError = $state<string>();

  const knownHandles = previousHandles();

  /**
   * Autocomplete suggestions for the ATProto handle input (issue #232): the handles already used
   * on this device starting with the typed name, plus the usual `.bsky.social` completion.
   */
  const atHandleSuggestions = $derived.by(() => {
    const typed = atHandle.trim().replace(/^@/, "").toLowerCase();
    if (!typed) return [];
    const suggestions = knownHandles.filter((h) => h.toLowerCase().startsWith(typed) && h.toLowerCase() !== typed);
    const bsky = `${typed}.bsky.social`;
    if (!typed.includes(".") && !suggestions.some((h) => h.toLowerCase() === bsky)) suggestions.push(bsky);
    return suggestions.slice(0, 5);
  });

  async function connectAtProto(event: SubmitEvent) {
    event.preventDefault();
    atError = undefined;
    atConnecting = true;
    try {
      // Redirects to the user's ATProto provider; the session is activated when
      // the OAuth server redirects back to this page
      await atproto.signIn(atHandle);
      atHandle = "";
    } catch (error) {
      atError =
        error instanceof Error && error.message === "User navigated back"
          ? "Login cancelled"
          : error instanceof Error
            ? error.message
            : String(error);
    } finally {
      atConnecting = false;
    }
  }
</script>

{#if !atproto.session}
  <form class="flex flex-col gap-2" onsubmit={connectAtProto}>
    <Input
      bind:value={atHandle}
      placeholder="Handle (e.g. alice.bsky.social)"
      required
      list="atproto-handle-suggestions"
      autocomplete="username"
      autocapitalize="none"
      autocorrect="off"
      spellcheck="false"
    />
    <datalist id="atproto-handle-suggestions">
      {#each atHandleSuggestions as suggestion (suggestion)}
        <option value={suggestion}></option>
      {/each}
    </datalist>
    <Button type="submit" variant="outline" disabled={atConnecting || !atHandle.trim()}>
      {atConnecting ? "Redirecting..." : "Continue"}
    </Button>
    <p class="text-xs text-muted-foreground">
      You will be redirected to your ATProto provider to log in and authorize Bloknote. No app password needed.
    </p>
    {#if atError}
      <p class="text-xs text-destructive">{atError}</p>
    {/if}
  </form>
{/if}
