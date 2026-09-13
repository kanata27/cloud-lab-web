import { mkdir, readFile, writeFile, copyFile, rm, lstat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Deliberate allowlist: source code, workflows, credentials and AWS exports
// can never be published just because somebody adds them to the repository.
export const publicFiles = [
  ["index.html", "index.html"],
  ["style.css", "style.css"],
  ["analytics.js", "analytics.js"],
  ...["index.html", "login.html", "dashboard.js", "login.js", "dashboard.css", "login.css"]
    .map(name => [`statistics-panel/${name}`, `stat-panel/${name}`]),
  ...["apple-touch-icon.png", "favicon.ico", "favicon.svg", "hero.webp", "kanata-logo.svg", "og-image.jpg"]
    .map(name => [`assets/${name}`, `assets/${name}`]),
  ...["404.html", "robots.txt", "_redirects"].map(name => [`public/${name}`, name]),
];

export function validateConfig(config) {
  const api = new URL(config.apiBase);
  if (api.protocol !== "https:" || api.username || api.password || api.search || api.hash
      || config.apiBase.endsWith("/") || !Array.isArray(config.analyticsOrigins)) {
    throw new Error("Invalid site.config.json: use an HTTPS API base without a trailing slash.");
  }
  for (const origin of config.analyticsOrigins) {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.origin !== origin) throw new Error("Invalid analytics origin.");
  }
  return config;
}

export function securityHeaders(config) {
  const apiOrigin = new URL(config.apiBase).origin;
  const csp = ["default-src 'self'", "base-uri 'none'", "object-src 'none'", "frame-ancestors 'none'",
    "form-action 'none'", "script-src 'self'", "script-src-attr 'none'",
    "style-src 'self' https://fonts.googleapis.com", "style-src-attr 'none'",
    "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data:",
    `connect-src 'self' ${apiOrigin}`].join("; ");
  return `/*
  Content-Security-Policy: ${csp}
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Cache-Control: public, max-age=0, must-revalidate

/stat-panel/*
  ! Cache-Control
  Cache-Control: no-store
  X-Robots-Tag: noindex, nofollow, noarchive
`;
}

export async function build(output = resolve(projectRoot, "dist")) {
  const config = validateConfig(JSON.parse(await readFile(resolve(projectRoot, "site.config.json"), "utf8")));
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const [source, target] of publicFiles) {
    const from = resolve(projectRoot, source), to = resolve(output, target);
    if (!(await lstat(from)).isFile()) throw new Error(`Public asset must be a regular file: ${source}`);
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to);
  }
  await writeFile(resolve(output, "site-config.js"),
    `"use strict";\nwindow.KANATA_CONFIG = Object.freeze(${JSON.stringify(config, null, 2)});\n`);
  await writeFile(resolve(output, "_headers"), securityHeaders(config));
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = await build();
  console.log(`Built ${publicFiles.length + 2} public files in ${output}`);
}
