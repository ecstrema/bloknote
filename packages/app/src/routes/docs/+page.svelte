<script lang="ts">
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { building } from "$app/env";
  import { goto } from "$app/navigation";
  import { getBrowserUrl } from "#lib/helpers/url.js";
  import { pageTitle } from "#lib/page-title.js";
  import BloknoteLogo from "#components/bloknote-logo.svelte";
  import { Button } from "#components/ui/button/index.js";

  type DocSectionId = "how-it-works" | "offline-data" | "osm" | "wikimedia" | "lexicons";

  const sections: { id: DocSectionId; title: string; audience: "user" | "technical" }[] = [
    { id: "how-it-works", title: "How Bloknote works", audience: "user" },
    { id: "offline-data", title: "Offline data & static builds", audience: "technical" },
    { id: "osm", title: "OpenStreetMap integration", audience: "technical" },
    { id: "wikimedia", title: "Wikimedia Commons", audience: "technical" },
    { id: "lexicons", title: "ATProto Lexicons", audience: "technical" },
  ];

  const userSections = sections.filter((s) => s.audience === "user");
  const technicalSections = sections.filter((s) => s.audience === "technical");

  function parseSection(value: string | null): DocSectionId {
    return sections.some((s) => s.id === value) ? (value as DocSectionId) : "how-it-works";
  }

  let active = $state<DocSectionId>(
    building ? "how-it-works" : parseSection(getBrowserUrl().searchParams.get("section")),
  );

  function selectSection(id: DocSectionId) {
    active = id;
    if (building) return;
    // Shallow gotos don't update `page.url`, so build from the browser URL (issue #212)
    const url = new URL(getBrowserUrl().href);
    url.searchParams.set("section", id);
    void goto(url, { state: page.state, shallow: true, replace: true });
  }
</script>

<svelte:head>
  <title>{pageTitle("Documentation | Bloknote")}</title>
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
      <p class="px-2 pb-1 text-xs font-semibold uppercase text-muted-foreground">User guide</p>
      {#each userSections as section (section.id)}
        <Button
          variant={active === section.id ? "secondary" : "ghost"}
          size="sm"
          class="justify-start"
          onclick={() => selectSection(section.id)}
        >
          {section.title}
        </Button>
      {/each}
      <p class="px-2 pt-3 pb-1 text-xs font-semibold uppercase text-muted-foreground">Technical</p>
      {#each technicalSections as section (section.id)}
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
        <h1>How Bloknote works</h1>
        <p>
          Bloknote is a free climbing directory built entirely on open data. There is no proprietary central database:
          the climbing map itself, your photos, and your personal logbook are stored in open services that you control.
        </p>
        <h2>Your data stays yours</h2>
        <ul>
          <li>
            <strong>The climbing map lives on OpenStreetMap</strong> — the shared, free map of the world. Any crag, sector,
            or route you add or improve also benefits every other app, website, and mapper.
          </li>
          <li>
            <strong>Photos live on Wikimedia Commons</strong> — the free media library, published under a free license so
            anyone can reuse them.
          </li>
          <li>
            <strong>Your logbook, comments, and bookmarks live in your own Atmosphere (AT Protocol) account</strong> — a personal
            data repository that belongs to you, not to Bloknote. You keep full control and can take your data with you to
            other apps.
          </li>
        </ul>
        <p>
          Because your climbing data is spread across open services instead of being locked in one app, you stay in full
          control: leave Bloknote and your data remains — improve the map and every climber benefits.
        </p>
        <h2>Works offline</h2>
        <p>
          Once loaded, Bloknote keeps a local copy of the climbing directory on your device, so browsing, filtering, and
          your logbook keep working without a connection.
        </p>
      {:else if active === "offline-data"}
        <h1>Offline data &amp; static builds</h1>
        <p>
          A scheduled pipeline compiles worldwide Overpass climbing data and regional GeoJSON boundaries into static
          JSON endpoints, published as a versioned snapshot.
        </p>
        <h2>Offline SQLite cache</h2>
        <p>
          In your browser, Bloknote downloads this snapshot into a local WebAssembly SQLite database so tree browsing,
          filtering, and diagnostics work instantaneously—even offline.
        </p>
        <h2>Service worker caches</h2>
        <ul>
          <li>
            <strong>App shell</strong> — the application bundles and pages, refreshed network-first on each update.
          </li>
          <li><strong>Map tiles</strong> — vector tiles, fonts and sprites from the map providers you enable.</li>
          <li><strong>Topo images</strong> — Wikimedia Commons images, pruned with a FIFO cap.</li>
          <li>
            <strong>Edit-map</strong> — the boundary editor is online-only: it needs live Overpass/OSM access and its boundary
            files are never stored offline.
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
            <code>highway=via_ferrata</code> — Via ferrata routes (fixed-cable alpine routes), shown as a dedicated route
            style.
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
          Bloknote defines open AT Protocol Lexicon schemas under <code>org.bloknote.*</code> so personal climbing logs and
          comments are portable across apps.
        </p>
        <h2>Core schemas</h2>
        <ul>
          <li>
            <code>org.bloknote.osm.defs#elementRef</code> — Canonical reference to an OSM element (<code>type</code>
            + numeric <code>id</code>), resilient to OSM name/slug changes.
          </li>
          <li>
            <code>org.bloknote.logbook.tick</code> — Personal ascent or attempt record (send: <code>onsight</code>,
            <code>flash</code>, <code>redpoint</code>, <code>pinkpoint</code>; attempt: <code>hangdog</code> with hang
            count or <code>bailed</code>; optional qualifiers, timestamp, and notes).
          </li>
          <li>
            <code>org.bloknote.osm.comment</code> — Standalone comment text on an OSM element, independent of ratings so each
            can be created and deleted separately.
          </li>
          <li>
            <code>org.bloknote.osm.rating</code> — Standalone integer rating (<code>0–120</code>) for an OSM element.
          </li>
          <li>
            <code>org.bloknote.osm.bookmark</code> — Bookmarked OSM elements.
          </li>
          <li>
            <code>org.bloknote.osm.opinion</code> — An opinion about the value of a specific OSM tag on an element (e.g.
            a grade opinion for <code>climbing:grade:french</code>), usable for any field.
          </li>
          <li>
            <code>org.bloknote.actor.settings</code> — User preferences such as preferred route and boulder grading scales,
            theme and language.
          </li>
        </ul>
      {/if}
    </main>
  </div>
</div>
