// Local smoke test: public pages render without console errors.
import { chromium } from "@playwright/test";

const base = "http://localhost:5173";
const pagesToCheck = [
  { path: "/", expect: /UniClass|log in|welcome/i },
  { path: "/login", expect: /Log in|Welcome back|password/i },
  { path: "/register", expect: /create|register|sign/i },
  { path: "/forgot-password", expect: /reset|email/i },
  { path: "/family-reply/00000000-0000-0000-0000-000000000000", expect: /not valid|could not/i },
];

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(`pageerror @ ${page.url()}: ${err.message}`));
page.on("console", (msg) => { if (msg.type() === "error") errors.push(`console @ ${page.url()}: ${msg.text()}`); });

let failures = 0;
for (const { path, expect } of pagesToCheck) {
  try {
    await page.goto(base + path, { waitUntil: "networkidle", timeout: 30_000 });
    const text = await page.locator("body").innerText({ timeout: 10_000 });
    if (!expect.test(text)) { console.error(`FAIL ${path}: expected ${expect}, got: ${text.slice(0, 120).replace(/\s+/g, " ")}`); failures++; }
    else console.log(`PASS ${path}`);
  } catch (err) { console.error(`FAIL ${path}: ${err.message.split("\n")[0]}`); failures++; }
}

// A rejected invalid family-reply token intentionally produces a 400/404 from
// PostgREST; the browser logs it as a resource error even though the page
// itself handles it. Ignore only those resource lines.
const filtered = errors.filter((e) => !e.includes("favicon") && !/Failed to load resource.*\b(400|404)\b/.test(e));
console.log(`console/page errors: ${filtered.length}`);
for (const e of filtered.slice(0, 10)) console.error(e);
await browser.close();
process.exit(failures === 0 && filtered.length === 0 ? 0 : 1);
