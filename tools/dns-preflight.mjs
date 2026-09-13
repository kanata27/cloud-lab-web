// Read-only inspection before Wrangler changes custom-domain bindings.
// The API token is only sent to api.cloudflare.com and is never printed.
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import assert from "node:assert/strict";

const target = process.argv[2];
assert.ok(["preview", "production"].includes(target));
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
assert.ok(token && /^[a-f0-9]{32}$/i.test(account || ""), "Cloudflare token/account ID missing or invalid");
const hosts = target === "production" ? ["kanata27.com", "www.kanata27.com"] : ["preview.kanata27.com"];
const service = target === "production" ? "kanata-web" : "kanata-web-preview";
const oldOrigin = "cloud-lab-alb-963312302.eu-north-1.elb.amazonaws.com";
async function cf(path) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  assert.ok(response.ok && data.success, `Cloudflare read failed (${response.status}); check token scopes`);
  return data;
}
const zones = (await cf(`/zones?name=kanata27.com&account.id=${account}`)).result;
assert.equal(zones.length, 1, "kanata27.com must belong to the selected Cloudflare account");
const zone = zones[0].id;
const domains = [];
for (let page = 1; ; page++) {
  const data = await cf(`/accounts/${account}/workers/domains?page=${page}&per_page=100`);
  domains.push(...data.result);
  if (page >= (data.result_info?.total_pages || 1)) break;
}
const snapshot = { captured_at: new Date().toISOString(), target, zone, hosts: {} };
for (const host of hosts) {
  const owner = domains.find(domain => domain.hostname === host);
  assert.ok(!owner || owner.service === service, `${host} is attached to another Worker; inspect it before switching`);
  const records = (await cf(`/zones/${zone}/dns_records?name=${encodeURIComponent(host)}&per_page=100`)).result;
  snapshot.hosts[host] = records
    .filter(record => ["A", "AAAA", "CNAME"].includes(record.type))
    .map(({ type, name, content, proxied, ttl }) => ({ type, name, content, proxied, ttl }));
  if (!owner) {
    for (const record of snapshot.hosts[host]) {
      const content = record.content.replace(/\.$/, "").toLowerCase();
      assert.ok(target === "production" && record.type === "CNAME"
        && (content === oldOrigin || (host === "www.kanata27.com" && content === "kanata27.com")),
      `Unexpected DNS record for ${host}; expected the existing ALB. No DNS changes have been made by this check.`);
    }
  }
}
await mkdir("artifacts", { recursive: true });
const file = `artifacts/dns-before-${target}.json`;
await writeFile(file, JSON.stringify(snapshot, null, 2) + "\n");
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `### DNS before ${target}\n\nSaved for rollback. Wrangler will connect only ${hosts.join(", ")} to ${service}.\n\n\`\`\`json\n${JSON.stringify(snapshot, null, 2)}\n\`\`\`\n`);
}
console.log(`DNS inspected; rollback snapshot: ${file}. No DNS changes in this step.`);
