// Small helpers shared by the collectors. No network access happens outside `get`.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const USER_AGENT = "cairn-commons-tracker/1.0 (+https://github.com/DominikVladar/cairn-commons-data/tree/main/tracking)";

export const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/** JSON with sorted keys and a final newline: the same data always gives the same bytes (and git diffs stay small). */
export function canonical(value, indent = 1) {
  const sort = (v) =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, sort(v[k])]),
          )
        : v;
  return `${JSON.stringify(sort(value), null, indent)}\n`;
}

export function readJson(path, fallback) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
}

/** Writes only when the content changed; returns whether it did. */
export function writeIfChanged(path, text) {
  if (existsSync(path) && readFileSync(path, "utf8") === text) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return true;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * GET with a polite user agent, a timeout and two retries on network errors and 5xx. A 403 or a bot-check page
 * is reported as such (`blocked`): the collectors never try to get around a site's bot protection.
 */
export async function get(url, { as = "text", timeoutMs = 60_000 } = {}) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(2000 * attempt);
    try {
      const r = await fetch(url, {
        headers: { "user-agent": USER_AGENT, accept: as === "json" ? "application/json" : "*/*" },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });
      const body = as === "bytes" ? Buffer.from(await r.arrayBuffer()) : await r.text();
      const challenged = typeof body === "string" && /<title>Just a moment\.\.\.<\/title>|cf-chl|challenge-platform/i.test(body.slice(0, 5000));
      if (r.status === 403 || challenged) {
        const e = new Error(`${url}: blocked by the site's bot protection (HTTP ${r.status}); not retried`);
        e.blocked = true;
        throw e;
      }
      if (r.status >= 500) throw new Error(`${url}: HTTP ${r.status}`);
      if (!r.ok) {
        const e = new Error(`${url}: HTTP ${r.status}`);
        e.fatal = true;
        throw e;
      }
      return as === "json" ? JSON.parse(body) : body;
    } catch (e) {
      last = e;
      if (e.blocked || e.fatal) throw e;
    }
  }
  throw last;
}

/**
 * The value written in a LaTeX table cell, or null when the cell is an expression without one: "$0.379005$",
 * "$1/2=0.5$", "$\\sqrt{2} \\approx 1.41421\\dots$", "$1.7813^\\*$" give numbers; "$K_{DR} + 10^{-26}$" gives null.
 */
export function cellValue(cell) {
  const c = cell
    .replace(/\^?\\?\*/g, "")
    .replace(/\$/g, "")
    .replace(/\\(?:ldots|cdots|dots)/g, "")
    .replace(/\\,/g, "")
    .trim();
  const frac = /^\\d?frac\{(\d+)\}\{(\d+)\}$|^(\d+)\s*\/\s*(\d+)$/.exec(c);
  if (frac) return Number(frac[1] ?? frac[3]) / Number(frac[2] ?? frac[4]);
  const plain = /^-?\d+(?:\.\d+)?$/.exec(c);
  if (plain) return Number(plain[0]);
  const approx = /(?:\\approx|=)\s*(-?\d+(?:\.\d+)?)\s*$/.exec(c);
  return approx ? Number(approx[1]) : null;
}
