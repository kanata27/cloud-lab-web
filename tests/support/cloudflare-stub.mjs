// Loaded only by a child-process test. Never connects to Cloudflare.
import assert from "node:assert/strict";
const kind = process.env.KANATA_TEST_DNS_CASE;
globalThis.fetch = async (url, options) => {
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://api.cloudflare.com");
  assert.ok(!options.method || options.method === "GET", "Preflight must never mutate DNS");
  assert.equal(options.headers.Authorization, "Bearer fake-test-token");
  let result;
  if (parsed.pathname.endsWith("/zones")) result = [{ id: "test-zone" }];
  else if (parsed.pathname.endsWith("/workers/domains")) result = kind === "foreign-worker"
    ? [{ hostname: "kanata27.com", service: "another-project" }]
    : kind === "already-migrated" ? ["kanata27.com", "www.kanata27.com"].map(hostname => ({ hostname, service: "kanata-web" })) : [];
  else if (parsed.pathname.endsWith("/dns_records")) {
    const name = parsed.searchParams.get("name");
    if (name.startsWith("preview.")) result = [];
    else result = [{ name, type: kind === "foreign-ip" || kind === "already-migrated" ? "A" : "CNAME",
      content: kind === "foreign-ip" || kind === "already-migrated" ? "203.0.113.7"
        : name === "www.kanata27.com" ? "kanata27.com" : "cloud-lab-alb-963312302.eu-north-1.elb.amazonaws.com",
      proxied: true, ttl: 1 }];
  } else throw new Error("Unexpected Cloudflare request " + url);
  return new Response(JSON.stringify({ success: true, result, result_info: { total_pages: 1 } }), { status: 200 });
};
