// erdosproblems.com status of each Erdős problem, from the site's public data file
// (github.com/teorth/erdosproblems, data/problems.yaml), read at a pinned commit.
import { parse } from "yaml";
import { get } from "../lib/util.mjs";
import { headOf } from "../lib/git.mjs";

const REPO = "https://github.com/teorth/erdosproblems";
export const VERSION = 1;

/** Pure: the parsed data file → { number: { state, updated, prize } }. */
export function erdosStatuses(yamlText) {
  const out = {};
  for (const p of parse(yamlText) ?? []) {
    if (p?.number === undefined) continue;
    const s = p.status ?? p.informal_status ?? {};
    out[String(p.number)] = {
      state: String(s.state ?? "unknown"),
      updated: s.last_update ? String(s.last_update).slice(0, 10) : null,
      prize: p.prize && p.prize !== "no" ? String(p.prize) : null,
    };
  }
  return out;
}

export async function collectErdos(targets) {
  const rev = await headOf(REPO);
  const text = await get(`https://raw.githubusercontent.com/teorth/erdosproblems/${rev}/data/problems.yaml`);
  const statuses = erdosStatuses(text);
  const n = Object.keys(statuses).length;
  if (n < 500) throw new Error(`erdosproblems data file has only ${n} problems; the format may have changed`);
  const facts = [];
  const missing = [];
  for (const [num, refs] of targets) {
    const s = statuses[num];
    if (!s) {
      missing.push(num);
      continue;
    }
    for (const problem of refs)
      facts.push({
        problem,
        source: "erdosproblems",
        key: `erdos-${num}`,
        label: `Status of Erdős problem #${num} on erdosproblems.com`,
        value: s.state,
        num: null,
        holder: null,
        date: s.updated,
        url: `https://www.erdosproblems.com/${num}`,
      });
  }
  return {
    health: { rev, rows: n, warnings: missing.length ? [`not in the data file: #${missing.join(", #")}`] : [] },
    facts,
  };
}
