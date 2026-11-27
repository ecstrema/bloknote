import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createDbTransport, type DbTransport } from "./db-transport";

/** Fake db.worker.ts: the test decides what each instance replies */
class FakeWorker {
  static instances: FakeWorker[] = [];
  /** Optional responder for workers spawned by the code under test, keyed by instance */
  static autoReply: ((worker: FakeWorker, req: any) => any) | undefined;
  onmessage: ((event: { data: any }) => void) | null = null;
  reply: ((req: any) => any) | undefined;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(req: any) {
    const res = this.reply?.(req) ?? FakeWorker.autoReply?.(this, req);
    if (res) queueMicrotask(() => this.onmessage?.({ data: res }));
  }
  /** Simulates the worker posting a response or a streamed message like matchBatch */
  respond(data: any) {
    queueMicrotask(() => this.onmessage?.({ data }));
  }
}

/** BroadcastChannel hub: delivers to every other instance, like across tabs */
class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];
  onmessage: ((event: { data: any }) => void) | null = null;
  constructor(public name: string) {
    FakeBroadcastChannel.instances.push(this);
  }
  postMessage(data: any) {
    for (const instance of FakeBroadcastChannel.instances) {
      if (instance !== this) queueMicrotask(() => instance.onmessage?.({ data: structuredClone(data) }));
    }
  }
}

/** Exclusive lock: queued requests are granted in order; `close()` simulates the tab closing */
class FakeLockManager {
  private held = false;
  private waiters: (() => void)[] = [];
  private forceRelease: (() => void) | undefined;
  request(_name: string, callback: () => Promise<void>): Promise<void> {
    const grant = () => {
      this.held = true;
      const release = () => {
        if (!this.held) return;
        this.held = false;
        this.forceRelease = undefined;
        this.waiters.shift()?.();
      };
      this.forceRelease = release;
      Promise.resolve().then(callback).then(release, release);
    };
    if (!this.held) {
      grant();
      return Promise.resolve();
    }
    return new Promise((resolve) =>
      this.waiters.push(() => {
        grant();
        resolve();
      }),
    );
  }
  close() {
    this.forceRelease?.();
  }
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function sendAndAwait(transport: DbTransport, req: any): Promise<any> {
  return new Promise((resolve) => {
    transport.onmessage = (event) => {
      if ((event.data as any).id === req.id) resolve(event.data);
    };
    transport.postMessage(req);
  });
}

describe("db-transport", () => {
  let lockManager: FakeLockManager;

  beforeEach(() => {
    FakeWorker.instances = [];
    FakeBroadcastChannel.instances = [];
    lockManager = new FakeLockManager();
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    vi.stubGlobal("navigator", { locks: lockManager });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("falls back to a direct worker without BroadcastChannel or Web Locks", () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const transport = createDbTransport();
    expect(transport).toBeInstanceOf(FakeWorker);
    expect(FakeWorker.instances).toHaveLength(1);
  });

  test("only the first tab spawns the worker and followers share it", async () => {
    const a = createDbTransport();
    const b = createDbTransport();
    await flush();
    expect(FakeWorker.instances).toHaveLength(1);
    expect(a).not.toBeInstanceOf(FakeWorker);
    expect(b).not.toBeInstanceOf(FakeWorker);
  });

  test("identical request ids from different tabs do not collide", async () => {
    const a = createDbTransport();
    const b = createDbTransport();
    await flush();
    const leader = FakeWorker.instances[0]!;
    leader.postMessage = (req: any) => leader.respond({ id: req.id, type: "node", data: { echo: req.slug } });
    const [resA, resB] = await Promise.all([
      sendAndAwait(a, { id: 0, type: "getNode", slug: "from-a" }),
      sendAndAwait(b, { id: 0, type: "getNode", slug: "from-b" }),
    ]);
    expect(resA.data).toEqual({ echo: "from-a" });
    expect(resB.data).toEqual({ echo: "from-b" });
  });

  test("filter search ids are remapped per tab and matchBatch is routed back", async () => {
    const a = createDbTransport();
    const b = createDbTransport();
    await flush();
    const leader = FakeWorker.instances[0]!;
    const seen: any[] = [];
    leader.postMessage = (req: any) => {
      seen.push(req);
      leader.respond({ id: req.id, type: "matchPause", exhausted: false });
    };
    const filters = { text: "", types: [], styles: [], tags: [] };
    const batches: any[] = [];
    for (const transport of [a, b]) {
      transport.onmessage = (event) => {
        if (event.data.type === "matchBatch") batches.push(event.data);
      };
    }
    a.postMessage({ id: 5, type: "filterStart", searchId: 0, filters, budgetMs: 1 });
    b.postMessage({ id: 6, type: "filterStart", searchId: 0, filters, budgetMs: 1 });
    await flush();
    expect(seen).toHaveLength(2);
    expect(seen[0]!.searchId).not.toBe(seen[1]!.searchId);
    // Each tab gets its own batch back under its own search id
    leader.respond({ type: "matchBatch", searchId: seen[0]!.searchId, slugs: ["a-slug"] });
    leader.respond({ type: "matchBatch", searchId: seen[1]!.searchId, slugs: ["b-slug"] });
    await flush();
    expect(batches).toEqual([
      { type: "matchBatch", searchId: 0, slugs: ["a-slug"] },
      { type: "matchBatch", searchId: 0, slugs: ["b-slug"] },
    ]);
  });

  test("in-flight requests replay when the leader tab closes", async () => {
    const a = createDbTransport();
    const b = createDbTransport();
    await flush();
    expect(FakeWorker.instances).toHaveLength(1);

    // A request from tab b is left unanswered while the leader is closed
    const pending = sendAndAwait(b, { id: 7, type: "getStats", slug: "x" });
    await flush();
    a.onmessage = null;
    FakeWorker.autoReply = (worker, req) =>
      worker === FakeWorker.instances[1] ? { id: req.id, type: "stats", data: { totalRoutes: 42 } } : undefined;
    lockManager.close();
    await flush();

    // Tab b takes over: a new worker is spawned and the replayed request is answered there
    expect(FakeWorker.instances).toHaveLength(2);
    const res = await Promise.race([pending, flush().then(() => "timeout")]);
    expect(res).toEqual({ id: 7, type: "stats", data: { totalRoutes: 42 } });
  });
});
