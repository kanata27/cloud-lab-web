import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { build, publicFiles, projectRoot, validateConfig, securityHeaders } from "../tools/build.mjs";

test("only the explicit public allowlist is published; panel keeps its production path", async () => {
  const output = await mkdtemp(join(tmpdir(), "kanata-build-"));
  try {
    await build(output);
    const files = await readdir(output, { recursive: true, withFileTypes: true });
    const names = files.filter(f => f.isFile()).map(f => relative(output, join(f.parentPath, f.name)).replaceAll("\\", "/"));
    assert.deepEqual(names.sort(), [...publicFiles.map(([, path]) => path), "site-config.js", "_headers"].sort());
    for (const file of ["index.html", "stat-panel/index.html", "stat-panel/login.html"]) {
      const html = await readFile(join(output, file), "utf8");
      assert.match(html, /src="\/site-config.js"/);
      assert.doesNotMatch(html, /<script\s*>/);
      assert.doesNotMatch(html, /<style\s*>/);
    }
    assert.doesNotMatch(await readFile(join(output, "stat-panel/dashboard.js"), "utf8"), /demoReport|const fixture/);
  } finally { await rm(output, { recursive: true, force: true }); }
});

test("API URL and CSP stay aligned; unsafe public configuration is rejected", () => {
  const config = { apiBase: "https://api.kanata27.com", analyticsOrigins: ["https://kanata27.com"] };
  assert.equal(validateConfig(config), config);
  const headers = securityHeaders(config);
  assert.match(headers, /connect-src 'self' https:\/\/api.kanata27.com/);
  assert.doesNotMatch(headers, /unsafe-inline|unsafe-eval/);
  assert.match(headers, /Cache-Control: no-store/);
  for (const apiBase of ["http://api.kanata27.com", "https://user:pass@api.kanata27.com", "https://api.kanata27.com/", "https://api.kanata27.com?token=x"]) {
    assert.throws(() => validateConfig({ ...config, apiBase }));
  }
});

test("production and preview are isolated asset-only deployments", async () => {
  const preview = JSON.parse(await readFile(join(projectRoot, "wrangler.preview.jsonc"), "utf8"));
  const production = JSON.parse(await readFile(join(projectRoot, "wrangler.production.jsonc"), "utf8"));
  for (const config of [preview, production]) {
    assert.equal(config.main, undefined);
    assert.equal(config.assets.directory, "./dist");
    assert.equal(config.assets.run_worker_first, undefined);
    assert.notEqual(config.assets.not_found_handling, "single-page-application");
  }
  assert.notEqual(preview.name, production.name);
  assert.deepEqual(preview.routes.map(r => r.pattern), ["preview.kanata27.com"]);
  assert.deepEqual(production.routes.map(r => r.pattern), ["kanata27.com", "www.kanata27.com"]);
});
