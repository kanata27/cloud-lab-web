// Read-only check: no login/password POST, analytics events, or database writes.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const target = process.argv[2];
assert.ok(["preview", "production"].includes(target), "Choose preview or production");
const origin = target === "production" ? "https://kanata27.com" : "https://preview.kanata27.com";
const { apiBase } = JSON.parse(await readFile(new URL("../site.config.json", import.meta.url), "utf8"));

async function read(url, options = {}) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    try { return await fetch(url, { ...options, signal: AbortSignal.timeout(10000) }); }
    catch (error) { lastError = error; if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 3000)); }
  }
  throw lastError;
}
for (const path of ["/", "/?q=migration-check", "/assets/hero.webp", "/site-config.js", "/stat-panel/login.html", "/stat-panel/index.html"]) {
  const response = await read(origin + path);
  assert.equal(response.status, 200, `HTTP error on ${path}`);
  assert.equal(new URL(response.url).origin, origin, "Unexpected cross-origin redirect");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  if (path.startsWith("/stat-panel/")) assert.match(response.headers.get("cache-control") || "", /no-store/);
}
assert.equal((await read(origin + "/does-not-exist")).status, 404);
if (target === "production") {
  assert.equal((await read("https://www.kanata27.com/")).status, 200, "www domain is not ready");
}
const preflight = await read(apiBase + "/stats", {
  method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization" },
});
assert.ok([200, 204].includes(preflight.status), "CORS preflight failed");
assert.equal(preflight.headers.get("access-control-allow-origin"), origin, "Add the exact frontend origin to API Gateway CORS");
const today = new Date().toISOString().slice(0, 10);
for (const headers of [{ Origin: origin }, { Origin: origin, Authorization: "Bearer migration-invalid-token" }]) {
  const response = await read(`${apiBase}/stats?from=${today}&to=${today}&source=all`, { headers });
  assert.ok([401, 403].includes(response.status), "Stats API must reject missing/invalid tokens");
}
console.log(`PASS: ${origin}, assets, panel paths, CORS and unauthenticated API rejection.`);
