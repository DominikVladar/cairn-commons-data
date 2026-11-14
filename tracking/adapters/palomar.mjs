// Formal proofs registered in the Palomar registry (palomar-registry.org): a public registry of Lean
// formalizations whose proofs were machine-checked. Its metadata is public (CC0) and served as JSON.
// A problem whose pinned Lean statement has the same name as a registered entry's theorem gets a fact; whether
// that entry settles the problem is for a curator to decide (the entry proves its own copy of the statement).
import { get } from "../lib/util.mjs";

const API = "https://data.palomar-registry.org/api/v1/results";
export const VERSION = 1;
const ENTRY_URL = (id) => `https://palomar-registry.org/entry.html?id=${encodeURIComponent(id)}`;

/**
 * Pure: the registry's entries and the Lean constants we track (constant → problem refs) → one fact per problem,
 * from the earliest registered entry whose theorem names include the problem's constant.
 */
export function palomarFacts(entries, targets) {
  const best = new Map();
  for (const e of entries) {
    if (e?.status !== "registered" || typeof e.id !== "string") continue;
    for (const name of e.formalization?.theorem_names ?? []) {
      for (const problem of targets.get(name) ?? []) {
        const b = best.get(problem);
        const when = String(e.published_at ?? "");
        if (!b || when < b.when || (when === b.when && e.id < b.entry.id)) best.set(problem, { entry: e, name, when, count: (b?.count ?? 0) + 1 });
        else b.count++;
      }
    }
  }
  return [...best.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([problem, { entry, name, when, count }]) => ({
      problem,
      source: "palomar",
      key: "proof",
      label: `Palomar: formal proof registered for \`${name}\` (${entry.id}${count > 1 ? `, and ${count - 1} more` : ""}; trust ${entry.trust?.level ?? "unknown"})`,
      value: "formal proof registered",
      num: null,
      holder:
        (entry.authors ?? [])
          .map((a) => a?.name)
          .filter(Boolean)
          .join(", ") || null,
      date: /^\d{4}-\d{2}-\d{2}/.test(when) ? when.slice(0, 10) : null,
      url: ENTRY_URL(entry.id),
    }));
}

/** Reads every registered entry (cursor paging, 25 per page). The registry answers 409 when it changed mid-read. */
async function readAll(fetchPage) {
  for (let attempt = 0; ; attempt++) {
    try {
      const entries = [];
      let cursor = null;
      for (let page = 0; page < 2000; page++) {
        const r = await fetchPage(cursor);
        if (!Array.isArray(r?.entries)) throw new Error("Palomar API: no `entries` array (format changed?)");
        entries.push(...r.entries);
        cursor = r.next ?? null;
        if (!cursor) return { entries, totals: r.totals ?? null };
      }
      throw new Error("Palomar API: more than 2000 pages");
    } catch (e) {
      if (attempt < 2 && /HTTP 409/.test(String(e.message))) continue;
      throw e;
    }
  }
}

/**
 * `known`: the Palomar facts of the previous run; `firstRun`: this source was never read before (then nothing is
 * reported as new). A proof registered for a problem that had none is reported as a change.
 */
export async function collectPalomar(targets, { known = [], firstRun = false, fetchPage } = {}) {
  const page = fetchPage ?? ((cursor) => get(`${API}?order=registered${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { as: "json" }));
  const { entries, totals } = await readAll(page);
  if (!entries.length) throw new Error("Palomar API: the registry answered with no entries");
  const facts = palomarFacts(entries, targets);
  const had = new Set(known.map((f) => f.problem));
  const events = firstRun
    ? []
    : facts
        .filter((f) => !had.has(f.problem))
        .map((f) => ({ problem: f.problem, source: f.source, key: f.key, label: f.label, from: null, to: f.value, holder: f.holder, date: f.date, url: f.url, kind: "fact" }));
  return { health: { rows: entries.length, registry: totals, warnings: [] }, facts, events };
}
