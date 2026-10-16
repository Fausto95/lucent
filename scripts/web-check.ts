/**
 * The Expo example's web build (T144, decision 0133): exported by Expo, Metro bundling
 * each Lucent module as its JavaScript with web twins in their modules'
 * place, then run in Chromium. The tasks demo's shared module counts the
 * primes below 100 million, and the crypto demo's web twin passes its
 * known answers, with no error on the page.
 *
 *   node scripts/web-check.ts apps/expo-example
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const app = path.resolve(process.argv[2] ?? "apps/expo-example");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-web-check-"));

const exported = spawnSync(
  "pnpm",
  ["exec", "expo", "export", "--platform", "web", "--output-dir", out],
  { cwd: app, stdio: "inherit" },
);
if (exported.status !== 0) {
  console.error(`✗ expo export --platform web failed in ${path.relative(process.cwd(), app)}`);
  process.exit(1);
}

const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript" };

/** The export, served as a static site: a path it lacks is the app's page. */
const server = http.createServer((req, res) => {
  let file = path.join(out, decodeURIComponent((req.url ?? "/").split("?")[0]!));
  if (!file.startsWith(out) || !fs.existsSync(file) || fs.statSync(file).isDirectory())
    file = path.join(out, "index.html");
  res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address() as AddressInfo;

const browser = await chromium.launch();
const errors: string[] = [];
let ok = false;
try {
  const page = await browser.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/`);

  // The crypto demo's twin runs on mount: its known answers, with Web Crypto.
  await page.getByText("PASS").nth(1).waitFor({ timeout: 30_000 });
  // The tasks demo's shared module, run as JavaScript: π(10⁸).
  await page.getByText("100 million").click();
  await page.getByRole("button", { name: "Start" }).click();
  await page.getByText("5,761,455 primes").waitFor({ timeout: 60_000 });

  const failed = await page.getByText("FAIL").count();
  ok = failed === 0 && errors.length === 0;
  if (!ok) console.error((await page.innerText("body")).slice(0, 4000));
} catch (e) {
  console.error(e);
} finally {
  await browser.close();
  server.close();
}

if (errors.length) console.error(`errors on the page:\n${errors.join("\n")}`);
console.log(
  ok
    ? "✓ the web build counts primes with a shared module and passes the crypto twin's known answers"
    : "✗ the web build did not run as expected",
);
process.exit(ok ? 0 : 1);
