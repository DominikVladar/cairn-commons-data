// Which problems each source tracks, derived from the exported problem list (data/problems.jsonl): the links in a
// problem's sources say where its state is kept upstream. Deterministic: the same export gives the same mapping.
import { readFileSync } from "node:fs";

export function loadProblems(path) {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

export function trackingTargets(problems) {
  const t = { erdos: new Map(), constants: new Map(), formalConjectures: new Map(), covering: [] };
  const add = (map, key, ref) => map.set(key, [...new Set([...(map.get(key) ?? []), ref])].sort());
  for (const p of problems) {
    for (const s of p.sources ?? []) {
      const u = s.url ?? "";
      let m = /erdosproblems\.com\/(?:forum\/thread\/)?(\d+)(?:[/?#]|$)/.exec(u);
      if (m) add(t.erdos, m[1], p.ref);
      m = /teorth\.github\.io\/optimizationproblems\/constants\/(\d+[a-z])\.html/.exec(u);
      if (m) add(t.constants, m[1], p.ref);
      m = /github\.com\/google-deepmind\/formal-conjectures\/blob\/[0-9a-f]+\/(FormalConjectures\/[^#?]+\.lean)/.exec(u);
      if (m) {
        const path = decodeURIComponent(m[1]);
        // The Lean statement the problem is about ("type_of% @Erdos10.erdos_10" → Erdos10.erdos_10).
        const target = /@([^\s()]+)/.exec(p.formalStatement ?? "")?.[1] ?? null;
        const list = t.formalConjectures.get(path) ?? [];
        if (!list.some((x) => x.ref === p.ref)) list.push({ ref: p.ref, target });
        t.formalConjectures.set(path, list.sort((a, b) => a.ref.localeCompare(b.ref)));
      }
      if (/coveringrepository\.com/.test(u) && !t.covering.includes(p.ref)) t.covering.push(p.ref);
    }
    // Erdős problems imported from Formal Conjectures are named P-erdos-<n>.
    const e = /^P-erdos-(\d+)$/.exec(p.ref);
    if (e) add(t.erdos, e[1], p.ref);
  }
  t.covering.sort();
  return t;
}
