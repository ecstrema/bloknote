<script lang="ts">
  import { Button } from "#components/ui/button/index.js";
  import * as Dialog from "#components/ui/dialog/index.js";
  import { Input } from "#components/ui/input/index.js";
  import { Select } from "#components/ui/select/index.js";
  import { Textarea } from "#components/ui/textarea/index.js";
  import { getAppState } from "#lib/data/app-state.js";
  import {
    getCommonsAccessToken,
    getCommonsUsername,
    logoutCommons,
    startCommonsLogin,
    uploadCommonsFile,
  } from "#lib/data/network/commons.js";
      import { onMount } from "svelte";
  import { directCommonsImage, type CommonsImage, type ResolvedImage } from "./topo-helpers.js";

  let {
    open = $bindable(false),
    reusableImages = [],
    resolvedCategories = {},
    onadd,
  }: {
    open: boolean;
    reusableImages?: CommonsImage[];
    resolvedCategories?: Record<string, ResolvedImage | undefined>;
    onadd: (title: string) => void;
  } = $props();

  const appState = getAppState();

  let commonsLoggedIn = $state(false);
  let commonsUsername = $state("");
  let uploadFile = $state<File>();
  let uploadFilename = $state("");
  let uploadDescription = $state("");
  let uploadSource = $state("");
  let uploadAuthor = $state("");
  let uploadLicense = $state("");
  let uploadRightsConfirmed = $state(false);
  let uploading = $state(false);
  let uploadStatus = $state("");

  onMount(() => {
    const accessToken = getCommonsAccessToken();
    commonsLoggedIn = Boolean(accessToken);
    if (accessToken) {
      void getCommonsUsername(accessToken)
        .then((username) => (commonsUsername = username ?? "Account"))
        .catch(() => {
          logoutCommons();
          commonsLoggedIn = false;
        });
    }
  });

  async function loginUpload() {
    uploadStatus = "";
    try {
      await startCommonsLogin();
    } catch (error) {
      uploadStatus = error instanceof Error ? error.message : String(error);
    }
  }

  function selectUploadFile(event: Event) {
    uploadFile = (event.currentTarget as HTMLInputElement).files?.[0];
    uploadFilename = uploadFile?.name ?? "";
    uploadStatus = "";
  }

  async function submitUpload(event: SubmitEvent) {
    event.preventDefault();
    const accessToken = getCommonsAccessToken();
    if (!accessToken || !uploadFile || !uploadFilename.trim() || !uploadDescription.trim()) return;
    uploading = true;
    uploadStatus = "Uploading image…";
    try {
      const title = await uploadCommonsFile(accessToken, uploadFile, {
        filename: uploadFilename.trim(),
        description: uploadDescription.trim(),
        source: uploadSource.trim(),
        author: uploadAuthor.trim(),
        license: uploadLicense,
      });
      uploadStatus = "";
      uploadFile = undefined;
      uploadFilename = "";
      uploadDescription = "";
      uploadSource = "";
      uploadAuthor = "";
      uploadLicense = "";
      uploadRightsConfirmed = false;
      onadd(title);
      open = false;
    } catch (error) {
      uploadStatus = error instanceof Error ? error.message : String(error);
    } finally {
      uploading = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[90vh] overflow-y-auto sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Add image</Dialog.Title>
    </Dialog.Header>

    <div class="flex items-start gap-2 rounded-md bg-muted/60 p-2.5 text-xs text-muted-foreground">
      <span aria-hidden="true"  class="icon-[lucide--info] shrink-0 mt-0.5 size-3.5 shrink-0"></span>
      <span>
        Images are hosted on Wikimedia Commons under a free license and linked to this climbing feature on
        OpenStreetMap.
      </span>
    </div>

    {#if !appState.osmUser.loggedIn}
      <div class="flex flex-col gap-2">
        <p class="text-sm text-muted-foreground">Log in with OpenStreetMap to attach images to this feature.</p>
        <Button size="sm" onclick={() => appState.osmUser.login()}>Log in with OpenStreetMap</Button>
      </div>
    {:else}
      {#if reusableImages.length > 0}
        <div class="flex flex-col gap-2">
          <p class="text-xs font-medium text-muted-foreground">Use an existing image from this area</p>
          <div class="flex gap-2 overflow-x-auto pb-1">
            {#each reusableImages as img (img.normalizedTitle)}
              {@const resolved = directCommonsImage(img, resolvedCategories)}
              {#if resolved}
                <button
                  type="button"
                  class="relative h-20 w-24 shrink-0 overflow-hidden rounded-md border bg-muted hover:ring-2 hover:ring-ring"
                  onclick={() => {
                    onadd(img.title);
                    open = false;
                  }}
                >
                  <img src={resolved.src} alt="" class="h-full w-full object-cover" />
                </button>
              {/if}
            {/each}
          </div>
        </div>
      {/if}

      {#if !commonsLoggedIn}
        <div class="flex flex-col gap-2 border-t pt-3">
          <Button size="sm" variant="outline" onclick={loginUpload}>Sign in to upload an image</Button>
        </div>
      {:else}
        <div class="flex flex-col gap-3 border-t pt-3">
          <div class="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Signed in as {commonsUsername || "uploader"}</span>
            <Button
              size="xs"
              variant="ghost"
              onclick={() => {
                logoutCommons();
                commonsLoggedIn = false;
                commonsUsername = "";
              }}
            >
              Log out
            </Button>
          </div>

          <form class="grid gap-3 sm:grid-cols-2" onsubmit={submitUpload}>
            <label class="grid gap-1 text-sm sm:col-span-2">
              Image file
              <Input type="file" accept="image/*" required onchange={selectUploadFile} />
            </label>
            <label class="grid gap-1 text-sm sm:col-span-2">
              Filename
              <Input bind:value={uploadFilename} required />
            </label>
            <label class="grid gap-1 text-sm sm:col-span-2">
              Description
              <Textarea bind:value={uploadDescription} required />
            </label>
            <label class="grid gap-1 text-sm">
              Source
              <Input bind:value={uploadSource} placeholder="Own work" required />
            </label>
            <label class="grid gap-1 text-sm">
              Author
              <Input bind:value={uploadAuthor} required />
            </label>
            <label class="grid gap-1 text-sm sm:col-span-2">
              License
              <Select bind:value={uploadLicense} required>
                <option value="" disabled>Select a license</option>
                <option value="cc-by-sa-4.0">CC BY-SA 4.0</option>
                <option value="cc-by-4.0">CC BY 4.0</option>
                <option value="cc-zero">CC0</option>
              </Select>
            </label>
            <label class="flex items-start gap-2 text-xs text-muted-foreground sm:col-span-2">
              <input class="mt-0.5 size-4 shrink-0" type="checkbox" bind:checked={uploadRightsConfirmed} required />
              I have the rights to publish this image under the selected free license.
            </label>
            <div class="sm:col-span-2">
              <Button size="sm" type="submit" disabled={uploading || !uploadFile || !uploadRightsConfirmed}>
                <span class="icon-[lucide--upload] shrink-0 size-4"></span>
                {uploading ? "Uploading…" : "Upload image"}
              </Button>
            </div>
          </form>
        </div>
      {/if}

      {#if uploadStatus}
        <p class="text-sm text-muted-foreground" role="status">{uploadStatus}</p>
      {/if}
    {/if}
  </Dialog.Content>
</Dialog.Root>
