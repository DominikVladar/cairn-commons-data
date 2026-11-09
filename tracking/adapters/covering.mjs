// Best known (v,k,t) covering designs. Baseline: the final archive of the La Jolla Covering Repository on Zenodo
// (CC BY 4.0, improvements up to April 2026). Since then the Covering Repository (coveringrepository.com) keeps the
// tables; its public "Latest (v,k,t) improvements" page (about the last 100 improvements, roughly a week) is read
// on every run and applied on top. Its filtered tables sit behind a bot check, which this collector never tries
// to get around: a cell that has not improved since tracking started is known only as of the baseline.
import { get } from "../lib/util.mjs";
import { parseCoveringGrid } from "./covering-parse.mjs";

const ZENODO_CONCEPT = "10779736";
export const VERSION = 2;
const FEED = "https://www.coveringrepository.com/systems.aspx?li=2";
export const cellKey = (v, k, t) => `C(${v},${k},${t})`;

/** Pure: coverdata.json of the archive → cells { "C(v,k,t)": [size, lowerBound, holder, date, "archive"] }. */
export function cellsFromArchive(data) {
  const cells = {};
  for (const [key, c] of Object.entries(data)) {
    const m = /^C\((\d+),(\d+),(\d+)\)$/.exec(key);
    if (!m || typeof c?.size !== "number") continue;
    const imp = c.imps?.[0] ?? [];
    cells[cellKey(m[1], m[2], m[3])] = [c.size, c.low_bd ?? null, String(imp[2] ?? "") || null, String(imp[3] ?? "").slice(0, 10) || null, "archive"];
  }
  return cells;
}

/**
 * Pure: applies feed rows to the cells. Only strict improvements (fewer blocks) change a cell. Returns the
 * improvements as change events, oldest first.
 */
export function applyFeed(cells, rows) {
  const events = [];
  const sorted = rows.filter((r) => r.t === r.m).sort((a, b) => a.date.localeCompare(b.date) || a.v - b.v || a.k - b.k || a.t - b.t);
  for (const r of sorted) {
    const key = cellKey(r.v, r.k, r.t);
    const before = cells[key];
    if (before && r.blocks >= before[0]) continue;
    cells[key] = [r.blocks, r.lowerBound ?? before?.[1] ?? null, r.author || null, r.date, "feed"];
    events.push({ key, from: before ? before[0] : null, to: r.blocks, holder: r.author || null, date: r.date, note: r.notes || null });
  }
  return events;
}

export async function collectCovering(problems, prev, today, nowIso = new Date().toISOString()) {
  const state = prev?.cells ? structuredClone(prev) : null;
  const warnings = [];
  let s = state;
  // Baseline once (or when a newer archive version appears).
  const latest = await get(`https://zenodo.org/api/records/${ZENODO_CONCEPT}/versions/latest`, { as: "json" });
  if (!s || s.archive?.record !== String(latest.id)) {
    const file = (latest.files ?? []).find((f) => f.key === "coverdata.json");
    if (!file) throw new Error("the Zenodo archive has no coverdata.json");
    const data = await get(file.links.self, { as: "json", timeoutMs: 300_000 });
    const cells = cellsFromArchive(data);
    if (Object.keys(cells).length < 9000) throw new Error(`archive has only ${Object.keys(cells).length} cells`);
    if (s) {
      // Keep improvements seen in the feed that are better than the new archive.
      for (const [k, c] of Object.entries(s.cells)) if (c[4] === "feed" && (!cells[k] || c[0] < cells[k][0])) cells[k] = c;
      warnings.push(`baseline replaced by archive record ${latest.id}`);
    }
    s = {
      archive: { record: String(latest.id), version: latest.metadata?.version ?? null, doi: latest.doi ?? null },
      feedSince: s?.feedSince ?? null,
      lastFeed: s?.lastFeed ?? null,
      feedReadAt: s?.feedReadAt ?? null,
      cells,
    };
  }
  // The live improvements page. If it cannot be read (e.g. a bot check answers instead), the archive baseline and
  // the improvements seen before still stand; the failure is reported, not worked around.
  let events = [];
  const feed = { ok: false, readAt: s.feedReadAt ?? null };
  try {
    const html = await get(FEED);
    const { rows, skipped, grid } = parseCoveringGrid(html);
    if (!grid || rows.length === 0) throw new Error("the improvements page has no parsable rows; the layout may have changed");
    if (skipped) warnings.push(`${skipped} rows of the improvements page did not parse`);
    const oldest = rows.reduce((m, r) => (r.date < m ? r.date : m), "9999");
    if (s.lastFeed && oldest > s.lastFeed)
      warnings.push(`possible gap: the improvements page starts on ${oldest}, after the previous read (${s.lastFeed}); improvements in between may be missing`);
    events = applyFeed(s.cells, rows);
    s.lastFeed = rows.reduce((m, r) => (r.date > m ? r.date : m), s.lastFeed ?? "0000");
    s.feedSince ??= today;
    s.feedReadAt = nowIso;
    Object.assign(feed, { ok: true, readAt: nowIso, rows: rows.length });
  } catch (e) {
    Object.assign(feed, { ok: false, blocked: !!e.blocked, error: String(e.message ?? e).slice(0, 300) });
    warnings.push(`live improvements page not read: ${feed.error}`);
  }

  const feedCells = Object.entries(s.cells).filter(([, c]) => c[4] === "feed");
  const newest = feedCells.sort((a, b) => b[1][3].localeCompare(a[1][3]) || a[0].localeCompare(b[0]))[0];
  const facts = [];
  for (const problem of problems) {
    const base = { problem, source: "covering-repository", holder: null, date: null, url: "https://www.coveringrepository.com" };
    facts.push({ ...base, key: "cells", label: "Parameter sets (v,k,t) with a best known covering", value: String(Object.keys(s.cells).length), num: Object.keys(s.cells).length });
    if (s.feedSince)
      facts.push({
        ...base,
        key: "tracked-improvements",
        label: `Improvements seen since tracking started (${s.feedSince})`,
        value: String(feedCells.length),
        num: feedCells.length,
      });
    if (newest)
      facts.push({
        ...base,
        key: "latest",
        label: "Latest improvement",
        value: `${newest[0]} ≤ ${newest[1][0]}`,
        num: newest[1][0],
        holder: newest[1][2],
        date: newest[1][3],
      });
    facts.push({
      ...base,
      key: "baseline",
      label: "Baseline",
      value: `La Jolla Covering Repository archive ${s.archive.version ?? ""} (Zenodo ${s.archive.record})`.replace(/\s+/g, " "),
      num: null,
      url: `https://zenodo.org/records/${s.archive.record}`,
    });
  }
  const cellEvents = problems.flatMap((problem) => events.map((e) => ({
    problem,
    source: "covering-repository",
    key: e.key,
    label: `Best known covering ${e.key}`,
    from: e.from === null ? null : String(e.from),
    to: String(e.to),
    holder: e.holder,
    date: e.date,
    url: FEED,
    kind: "record",
  })));
  return {
    health: { rev: s.archive.record, rows: Object.keys(s.cells).length, warnings, lastFeed: s.lastFeed, feed },
    facts,
    state: s,
    events: cellEvents,
  };
}

/** One line per cell, so that a daily diff shows exactly the cells that changed. */
export function serializeCoveringState(s) {
  const keys = Object.keys(s.cells).sort((a, b) => {
    const pa = a.match(/\d+/g).map(Number);
    const pb = b.match(/\d+/g).map(Number);
    return pa[2] - pb[2] || pa[1] - pb[1] || pa[0] - pb[0];
  });
  const head = JSON.stringify({ archive: s.archive, feedSince: s.feedSince, lastFeed: s.lastFeed, feedReadAt: s.feedReadAt ?? null });
  const lines = keys.map((k) => `${JSON.stringify(k)}: ${JSON.stringify(s.cells[k])}`);
  return `{\n"meta": ${head},\n"cells": {\n${lines.join(",\n")}\n}\n}\n`;
}
