import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../analytics.js", import.meta.url), "utf8");

function run({ origin = "https://kanata27.com", query = "?q=street", storageBlocked = false, fail = false } = {}) {
  const calls = [], timers = [], handlers = {};
  const storage = new Map();
  const document = {
    visibilityState: "visible",
    querySelectorAll: () => ["youtube", "instagram"].map(platform => ({
      dataset: { platform }, addEventListener: (_, fn) => { handlers[platform] = fn; },
    })),
    addEventListener: (_, fn) => { handlers.visibility = fn; },
    removeEventListener: () => {},
  };
  vm.runInNewContext(source, {
    window: { KANATA_CONFIG: { apiBase: "https://example.test", analyticsOrigins: ["https://kanata27.com"] }, location: { origin, search: query } },
    document, URLSearchParams, AbortSignal,
    setTimeout: fn => timers.push(fn),
    sessionStorage: {
      getItem: key => { if (storageBlocked) throw Error("blocked"); return storage.get(key); },
      setItem: (key, value) => { if (storageBlocked) throw Error("blocked"); storage.set(key, value); },
    },
    crypto: { randomUUID: () => "test-session-id" },
    fetch: (url, options) => { calls.push({ url, options, data: JSON.parse(options.body) }); return fail ? Promise.reject(Error("offline")) : Promise.resolve({ ok: true }); },
  });
  return { calls, timers, handlers, document };
}

test("early social click keeps original schema, sends one view, then both platforms", () => {
  const page = run();
  page.handlers.youtube();
  page.handlers.instagram();
  page.timers[0]();
  assert.deepEqual(page.calls.map(c => c.data), [
    { session_id: "test-session-id", event: "page_view", source: "qr" },
    { session_id: "test-session-id", event: "social_click", source: "qr", platform: "youtube" },
    { session_id: "test-session-id", event: "social_click", source: "qr", platform: "instagram" },
  ]);
  assert.ok(page.calls.every(c => c.options.keepalive && c.options.credentials === "omit"));
});

test("preview sends no production analytics", () => {
  const page = run({ origin: "https://preview.kanata27.com" });
  assert.equal(page.calls.length, 0);
  assert.equal(page.timers.length, 0);
  assert.deepEqual(page.handlers, {});
});

test("blocked storage and failed requests do not break click handling", async () => {
  const page = run({ storageBlocked: true, fail: true, query: "" });
  assert.doesNotThrow(() => page.handlers.youtube());
  assert.equal(page.calls[0].data.source, "direct");
  assert.equal(page.calls[0].data.session_id, page.calls[1].data.session_id);
  await new Promise(resolve => setImmediate(resolve));
});

test("hidden page waits for visibility and never emits a duplicate view", () => {
  const page = run();
  page.document.visibilityState = "hidden";
  page.timers[0]();
  assert.equal(page.calls.length, 0);
  page.document.visibilityState = "visible";
  page.handlers.visibility();
  page.handlers.visibility();
  assert.equal(page.calls.length, 1);
});
