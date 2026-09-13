import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const script = fileURLToPath(new URL("../tools/dns-preflight.mjs", import.meta.url));
const stub = fileURLToPath(new URL("./support/cloudflare-stub.mjs", import.meta.url));

for (const kind of ["original-alb", "already-migrated", "foreign-ip", "foreign-worker"]) {
  test(`DNS preflight ${kind}: read-only, scoped, recoverable`, async () => {
    const cwd = await mkdtemp(join(tmpdir(), "kanata-dns-"));
    try {
      const request = exec(process.execPath, ["--import", stub, script, "production"], {
        cwd, env: { PATH: process.env.PATH, KANATA_TEST_DNS_CASE: kind, CLOUDFLARE_API_TOKEN: "fake-test-token", CLOUDFLARE_ACCOUNT_ID: "a".repeat(32) },
      });
      if (kind.startsWith("foreign")) {
        await assert.rejects(request, error => error.code !== 0 && /Unexpected DNS|another Worker/.test(error.stderr));
        await assert.rejects(readFile(join(cwd, "artifacts/dns-before-production.json")));
      } else {
        const result = await request;
        assert.doesNotMatch(result.stdout + result.stderr, /fake-test-token/);
        const snapshot = JSON.parse(await readFile(join(cwd, "artifacts/dns-before-production.json"), "utf8"));
        assert.equal(snapshot.target, "production");
        assert.deepEqual(Object.keys(snapshot.hosts), ["kanata27.com", "www.kanata27.com"]);
      }
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
}
