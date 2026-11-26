import type { DbRequest, DbResponse } from "./types";

const LOCK_NAME = "bloknote-db-leader";
const CHANNEL_NAME = "bloknote-db-rpc";

/**
 * Minimal worker-like transport: `postMessage` sends a request, replies arrive on `onmessage`.
 * A plain `Worker` satisfies it, and so does the leader-elected proxy below.
 */
export interface DbTransport {
  postMessage(req: DbRequest): void;
  onmessage: ((event: MessageEvent<DbResponse>) => void) | null;
}

type BusMessage =
  | { kind: "ping"; tabId: string }
  | { kind: "leader-ready"; leaderId: string }
  | { kind: "req"; tabId: string; req: DbRequest }
  | { kind: "res"; targetTabId: string; res: DbResponse };

interface PendingOwner {
  tabId: string;
  /** The request id on the originating tab: responses echo the remapped id and are rewritten */
  originId: number;
  /** Set for filter requests: the key under which the worker search id was remapped */
  searchKey?: string;
}

/**
 * OPFS sync access handles are exclusive per tab, so only one tab can own the database worker
 * (issue #208). This transport elects a leader tab with the Web Locks API: the leader spawns
 * `db.worker.ts` while every other tab proxies its requests over a BroadcastChannel. Per-tab
 * request and search ids are remapped so tabs never collide inside the worker. When the leader
 * closes, the browser hands the lock to the next queued tab, which spawns a fresh worker and
 * replays the requests the dead leader never answered. Without Web Locks or BroadcastChannel,
 * falls back to a per-tab worker (single-tab behavior).
 */
export function createDbTransport(): DbTransport {
  if (typeof BroadcastChannel === "undefined" || !("locks" in navigator)) {
    return new Worker(new URL("./db.worker.ts", import.meta.url), { type: "module" });
  }

  const tabId = crypto.randomUUID();
  const channel = new BroadcastChannel(CHANNEL_NAME);

  let isLeader = false;
  let leaderReady = false;
  let worker: Worker | null = null;

  // Follower state: requests waiting for a leader or in-flight (replayed on failover)
  const queue: DbRequest[] = [];
  const inflight = new Map<number, DbRequest>();

  // Leader state: remaps per-tab `id` and `searchId` so tabs never collide in db.worker.ts
  let nextWorkerId = 1;
  let nextWorkerSearchId = 1;
  const workerReqOwner = new Map<number, PendingOwner>();
  const searchKeyToWorkerId = new Map<string, number>();
  const workerSearchIdToOrigin = new Map<number, { tabId: string; searchId: number }>();

  const transport: DbTransport = {
    onmessage: null,
    postMessage(req: DbRequest) {
      if (isLeader) {
        dispatchToWorker(tabId, req);
      } else if (leaderReady) {
        sendToLeader(req);
      } else {
        queue.push(req);
      }
    },
  };

  function sendToLeader(req: DbRequest) {
    // Cancellations are fire-and-forget: a cancelled search must stay cancelled on failover
    if (req.type !== "filterCancel") inflight.set(req.id, req);
    channel.postMessage({ kind: "req", tabId, req } satisfies BusMessage);
  }

  function deliver(targetTabId: string, res: DbResponse) {
    if (targetTabId === tabId) transport.onmessage?.(new MessageEvent("message", { data: res }));
    else channel.postMessage({ kind: "res", targetTabId, res } satisfies BusMessage);
  }

  function dispatchToWorker(originTabId: string, req: DbRequest) {
    if (!worker) return;
    const workerId = nextWorkerId++;
    let mappedReq: DbRequest = { ...req, id: workerId };
    if (req.type === "filterStart" || req.type === "filterMore" || req.type === "filterCancel") {
      const searchKey = `${originTabId}:${req.searchId}`;
      if (req.type === "filterStart") {
        const workerSearchId = nextWorkerSearchId++;
        searchKeyToWorkerId.set(searchKey, workerSearchId);
        workerSearchIdToOrigin.set(workerSearchId, { tabId: originTabId, searchId: req.searchId });
        mappedReq = { ...req, id: workerId, searchId: workerSearchId };
      } else {
        const workerSearchId = searchKeyToWorkerId.get(searchKey);
        if (workerSearchId === undefined) {
          // The search was lost with a previous leader: report it as finished rather than hang
          deliver(originTabId, { id: req.id, type: "matchPause", exhausted: true });
          return;
        }
        mappedReq = { ...req, id: workerId, searchId: workerSearchId };
      }
      workerReqOwner.set(workerId, { tabId: originTabId, originId: req.id, searchKey });
    } else {
      workerReqOwner.set(workerId, { tabId: originTabId, originId: req.id });
    }
    worker.postMessage(mappedReq);
  }

  function onWorkerMessage(event: MessageEvent<DbResponse>) {
    const res = event.data;
    if (res.type === "matchBatch") {
      const origin = workerSearchIdToOrigin.get(res.searchId);
      if (origin) deliver(origin.tabId, { type: "matchBatch", searchId: origin.searchId, slugs: res.slugs });
      return;
    }
    const owner = workerReqOwner.get(res.id);
    if (!owner) return;
    // Progress arrives repeatedly during a build: only final replies free the request slot
    if (res.type !== "progress") workerReqOwner.delete(res.id);
    if (owner.searchKey && res.type === "matchPause" && res.exhausted) {
      const workerSearchId = searchKeyToWorkerId.get(owner.searchKey);
      if (workerSearchId !== undefined) workerSearchIdToOrigin.delete(workerSearchId);
      searchKeyToWorkerId.delete(owner.searchKey);
    }
    // Rewrite the remapped worker id back to the originating tab's request id
    deliver(owner.tabId, { ...res, id: owner.originId });
  }

  function becomeLeader() {
    if (isLeader) return;
    isLeader = true;
    worker = new Worker(new URL("./db.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = onWorkerMessage;
    // Tell waiting tabs they can flush their queues
    channel.postMessage({ kind: "leader-ready", leaderId: tabId } satisfies BusMessage);
    // Replay what a previous leader never answered, then dispatch this tab's own backlog
    for (const req of inflight.values()) dispatchToWorker(tabId, req);
    inflight.clear();
    while (queue.length > 0) dispatchToWorker(tabId, queue.shift()!);
  }

  channel.onmessage = (event: MessageEvent<BusMessage>) => {
    const msg = event.data;
    switch (msg.kind) {
      case "ping":
        if (isLeader) channel.postMessage({ kind: "leader-ready", leaderId: tabId } satisfies BusMessage);
        break;

      case "leader-ready": {
        if (isLeader) break;
        const wasReady = leaderReady;
        leaderReady = true;
        // Replay requests the previous leader died with
        for (const req of inflight.values()) {
          channel.postMessage({ kind: "req", tabId, req } satisfies BusMessage);
        }
        // Flush requests queued while we waited for a leader (first connection only)
        if (!wasReady) while (queue.length > 0) sendToLeader(queue.shift()!);
        break;
      }

      case "req":
        if (isLeader) dispatchToWorker(msg.tabId, msg.req);
        break;

      case "res": {
        if (msg.targetTabId !== tabId) break;
        const res = msg.res;
        if (res.type !== "progress" && res.type !== "matchBatch") inflight.delete(res.id);
        transport.onmessage?.(new MessageEvent("message", { data: res }));
        break;
      }
    }
  };

  // Race for leadership; the lock stays held until this tab closes or crashes
  navigator.locks.request(LOCK_NAME, () => {
    becomeLeader();
    return new Promise<void>(() => {});
  });

  // If another tab is already leader, ask it to announce itself right away
  channel.postMessage({ kind: "ping", tabId } satisfies BusMessage);

  return transport;
}
