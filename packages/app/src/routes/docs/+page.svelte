<script lang="ts">
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { building } from "$app/env";
  import { goto } from "$app/navigation";
  import BloknoteLogo from "#components/bloknote-logo.svelte";
  import { Button } from "#components/ui/button/index.js";

  type DocSectionId = "how-it-works" | "osm" | "wikimedia" | "lexicons";

  const sections: { id: DocSectionId; title: string }[] = [
    { id: "how-it-works", title: "How Bloknote works" },
    { id: "osm", title: "OpenStreetMap integration" },
    { id: "wikimedia", title: "Wikimedia Commons" },
    { id: "lexicons", title: "ATProto Lexicons" },
  ];

  function parseSection(value: string | null): DocSectionId {
    return sections.some((s) => s.id === value) ? (value as DocSectionId) : "how-it-works";
  }

  let active = $state<DocSectionId>(building ? "how-it-works" : parseSection(page.url.searchParams.get("section")));

  function selectSection(id: DocSectionId) {
    active = id;
    if (building) return;
    const url = new URL(page.url.href);
    url.searchParams.set("section", id);
    void goto(url, { state: page.state, shallow: true, replace: true });
  }
</script>

<svelte:head>
  <title>Documentation | Bloknote</title>
</svelte:head>

<div class="min-h-screen bg-background text-foreground">
  <header class="border-b">
    <div class="mx-auto flex h-14 max-w-5xl items-center justify-between px-5 sm:px-8">
      <a href={resolve("/")} class="inline-flex items-center gap-2 font-semibold tracking-tight">
        <BloknoteLogo />
        <span>Bloknote</span>
      </a>
      <nav class="flex items-center gap-4 text-sm text-muted-foreground">
        <a href={resolve("/world/[...slug]", { slug: "" })} class="hover:text-foreground">Browse climbs</a>
        <a href={resolve("/settings")} class="hover:text-foreground">Settings</a>
      </nav>
    </div>
  </header>

  <div class="mx-auto grid max-w-5xl gap-8 px-5 py-8 sm:grid-cols-[14rem_1fr] sm:px-8">
    <aside class="flex flex-col gap-1">
      <p class="px-2 pb-1 text-xs font-semibold uppercase text-muted-foreground">Documentation</p>
      {#each sections as section (section.id)}
        <Button
          variant={active === section.id ? "secondary" : "ghost"}
          size="sm"
          class="justify-start"
          onclick={() => selectSection(section.id)}
        >
          {section.title}
        </Button>
      {/each}
    </aside>

    <main class="prose prose-sm dark:prose-invert max-w-none">
      {#if active === "how-it-works"}
        <h1>How Bloknote works &amp; Contributing</h1>
        <p>
          Bloknote is a static, offline-capable climbing directory built entirely on open data. There is no proprietary
          central database: routes, crags, sectors, and gyms live on <strong>OpenStreetMap</strong>, topo photos live on
          <strong>Wikimedia Commons</strong>, and personal ticks or reviews belong to your own
          <strong>Atmosphere (AT Protocol)</strong> repository.
        </p>
        <h2>Static builds &amp; offline SQLite cache</h2>
        <p>
          A scheduled pipeline compiles worldwide Overpass climbing data and regional GeoJSON boundaries into static
          JSON endpoints. In your browser, Bloknote downloads this snapshot into a local WebAssembly SQLite database so
          tree browsing, filtering, and diagnostics work instantaneously—even offline.
        </p>
        <h2>What contributing means</h2>
        <ul>
          <li>
            <strong>Map &amp; route edits go to OpenStreetMap</strong> under the Open Database License (ODbL), benefiting
            every open climbing app and mapper, not just Bloknote.
          </li>
          <li>
            <strong>Topo photos go to Wikimedia Commons</strong> under a free Creative Commons license (CC BY-SA 4.0, CC BY
            4.0, or CC0), so anyone can reuse and attribute them.
          </li>
          <li>
            <strong>Personal activity stays yours</strong>: ascents, stars, and comments are modeled as AT Protocol
            records stored in your personal data server (PDS).
          </li>
        </ul>
      {:else if active === "osm"}
        <h1>OpenStreetMap Integration</h1>
        <p>
          Bloknote queries and edits climbing features using standard OpenStreetMap tagging conventions (<code
            >sport=climbing</code
          >).
        </p>
        <h2>Feature hierarchy</h2>
        <ul>
          <li><code>climbing=area</code> — Multi-sector climbing areas or regions containing crags or sub-areas.</li>
          <li>
            <code>climbing=crag</code> — Individual crags or cliffs containing routes (via <code>type=site</code> relations).
          </li>
          <li>
            <code>climbing=route_bottom</code> / <code>route_top</code> / <code>route</code> — Individual pitches or boulders.
          </li>
          <li><code>leisure=sports_centre</code> + <code>sport=climbing</code> — Indoor climbing gyms.</li>
          <li>
            <code>highway=via_ferrata</code> — Via ferrata routes (fixed-cable alpine routes), shown as a dedicated
            route style.
          </li>
        </ul>
        <h2>Editing &amp; changesets</h2>
        <p>
          When signed in with OpenStreetMap (OAuth2), edits you make—renaming features, setting grades, normalizing
          lengths, dragging route markers, reordering relation members, or dragging routes into sectors—are batched into
          an undoable local changeset. If you drag loose routes into a crag mapped as a single node or way, Bloknote
          automatically promotes it into a <code>type=site</code> relation so membership persists cleanly to OSM.
        </p>
      {:else if active === "wikimedia"}
        <h1>Wikimedia Commons Integration</h1>
        <p>
          Climbing topos and crag images are hosted on <strong>Wikimedia Commons</strong> and linked directly from OSM
          elements using <code>wikimedia_commons</code> tags (e.g. <code>File:Example.jpg</code> or
          <code>Category:...</code>).
        </p>
        <h2>Route line overlays</h2>
        <p>
          Route traces drawn in Bloknote's topo viewer are saved as normalized <code>0–1</code> coordinate paths in
          <code>wikimedia_commons:path</code> (or <code>wikimedia_commons:N:path</code>) tags on the route feature,
          keeping image files clean while rendering crisp interactive overlays directly in OSM data.
        </p>
        <h2>Uploading photos</h2>
        <p>
          Bloknote uses Wikimedia Commons OAuth2 PKCE directly from your browser to upload photos with structured
          <code>&#123;&#123;Information&#125;&#125;</code> templates and free-license declarations, then links the resulting
          filename to the selected OSM climbing feature.
        </p>
      {:else if active === "lexicons"}
        <h1>Atmosphere (ATProto) Lexicons</h1>
        <p>
          Bloknote defines open AT Protocol Lexicon schemas under <code>org.bloknote.*</code> and reusable
          <code>org.openstreetmap.*</code> namespaces so personal climbing logs and reviews are portable across apps.
        </p>
        <h2>Core schemas</h2>
        <ul>
          <li>
            <code>org.openstreetmap.core.defs#elementRef</code> — Canonical reference to an OSM element (<code
              >type</code
            >
            + numeric <code>id</code>), resilient to OSM name/slug changes.
          </li>
          <li>
            <code>org.bloknote.logbook.tick</code> — Personal ascent or attempt record (<code>onsight</code>,
            <code>flash</code>, <code>redpoint</code>, <code>attempt</code>, optional qualifiers, timestamp, and notes).
          </li>
          <li>
            <code>org.openstreetmap.review</code> — Route or crag review text, normalized rating (<code>0.0–1.0</code>),
            and optional proposed OSM tag corrections.
          </li>
          <li>
            <code>org.openstreetmap.star</code> — Bookmarked/starred climbing features.
          </li>
          <li>
            <code>org.bloknote.actor.profile</code> — User preferences such as preferred route and boulder grading scales.
          </li>
        </ul>
      {/if}
    </main>
  </div>
</div>
