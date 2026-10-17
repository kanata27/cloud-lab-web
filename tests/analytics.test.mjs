import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {randomUUID} from 'node:crypto';
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../analytics.js", import.meta.url), "utf8");
const config=JSON.parse(await readFile(new URL('../site.config.json',import.meta.url),'utf8'));

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
    window: { KANATA_CONFIG: config, location: { origin, search: query } },
    document, URLSearchParams, AbortSignal,
    setTimeout: fn => timers.push(fn),
    sessionStorage: {
      getItem: key => { if (storageBlocked) throw Error("blocked"); return storage.get(key); },
      setItem: (key, value) => { if (storageBlocked) throw Error("blocked"); storage.set(key, value); },
    },
    crypto: { randomUUID },
    fetch: (url, options) => { calls.push({ url, options, data: JSON.parse(options.body) }); return fail ? Promise.reject(Error("offline")) : Promise.resolve({ ok: true }); },
  });
  return { calls, timers, handlers, document };
}

test("early social click keeps original schema, sends one view, then both platforms", () => {
  const page = run();
  page.handlers.youtube();
  page.handlers.instagram();
  page.timers[0]();
  assert.deepEqual(page.calls.map(({data:{session_id,event_id,...data}}) => data), [
    { event: "page_view", source: "qr" },
    { event: "social_click", source: "qr", platform: "youtube" },
    { event: "social_click", source: "qr", platform: "instagram" },
  ]);
  assert.equal(new Set(page.calls.map(c=>c.data.session_id)).size,1);
  assert.equal(new Set(page.calls.map(c=>c.data.event_id)).size,3);
  assert.ok(page.calls.every(c => c.options.keepalive && c.options.credentials === "omit"));
});

test("preview uses its own same-origin endpoint; unlisted local sites do not record events", () => {
  const page = run({ origin: "https://preview.kanata27.com" });
  page.timers[0]();
  assert.equal(page.calls.length,1);
  assert.equal(page.calls[0].url,'/events');
  const local=run({origin:'http://localhost:8787'});
  assert.equal(local.calls.length,0);
  assert.equal(local.timers.length,0);
  assert.deepEqual(local.handlers,{});
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
