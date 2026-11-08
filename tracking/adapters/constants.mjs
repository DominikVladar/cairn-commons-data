// Best known bounds of the optimization constants in Terence Tao's crowdsourced repository
// (github.com/teorth/optimizationproblems, constants/<id>.md), read at a pinned commit.
import { cellValue, get } from "../lib/util.mjs";
import { headOf } from "../lib/git.mjs";

const REPO = "https://github.com/teorth/optimizationproblems";
export const VERSION = 3;

/** Rows of a "## Known upper bounds" / "## Known lower bounds" table: { bound, num, ref, comments, starred }. */
function tableRows(md, heading) {
  const sec = md.split(/^##\s+/m).find((s) => heading.test(s.split("\n")[0]));
  if (!sec) return [];
  const rows = [];
  for (const line of sec.split("\n")) {
    if (!/^\s*\|/.test(line) || /^\s*\|\s*-{3,}/.test(line)) continue;
    const cells = line
      .trim()
      .replace(/^\||\|$/g, "")
      .split(/(?<!\\)\|/)
      .map((c) => c.trim());
    if (/^bound$/i.test(cells[0] ?? "")) continue;
    // "< (Krivine's bound) − 10^{-4}", "K_{DR} + 10^{-26}": an expression without a value is skipped.
    if (/^\$?\s*(<|>|\\l[et]|\\g[et])/.test(cells[0] ?? "")) continue;
    const num = cellValue(cells[0] ?? "");
    if (num === null || !Number.isFinite(num)) continue;
    rows.push({
      bound: cells[0],
      num,
      ref: cells[1] ?? "",
      comments: cells[2] ?? "",
      // The repository's convention: an asterisk marks a bound that has not been independently verified.
      starred: /\*/.test(cells[0].replace(/\*\*/g, "")),
    });
  }
  return rows;
}

const plain = (s) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/\[\[([^\]]+)\]\([^)]+\)\]/g, "[$1]")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\$([^$]*)\$/g, "$1")
    .replace(/\\approx/g, "≈")
    .replace(/\\le(q)?\b/g, "≤")
    .replace(/\\ge(q)?\b/g, "≥")
    .replace(/\\(?:mathbb|mathrm|text|mathcal)\{([^}]*)\}/g, "$1")
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
const firstSentence = (s) => {
  // "Unverified (see README asterisk convention)" says what the asterisk already says.
  const p = plain(s).replace(/^unverified\b[^.;]*[.;]?\s*/i, "");
  const m = /^(.{1,160}?[.;])(\s|$)/.exec(p);
  return m ? m[1] : p.slice(0, 160);
};

/**
 * Pure: a constant's markdown page → best upper and lower bounds. "Best" is the smallest upper / largest lower
 * value (the later row wins a tie); starred rows (not independently verified, by the repository's convention) are
 * reported, and the best unstarred value is reported next to them.
 */
export function bestBounds(md) {
  const pick = (rows, better) => {
    let best = null;
    for (const r of rows) if (!best || better(r.num, best.num) || r.num === best.num) best = r;
    return best;
  };
  const out = {};
  for (const [side, heading, better] of [
    ["upper", /^Known upper bounds/i, (a, b) => a < b],
    ["lower", /^Known lower bounds/i, (a, b) => a > b],
  ]) {
    const rows = tableRows(md, heading);
    const best = pick(rows, better);
    if (!best) continue;
    out[side] = best;
    if (best.starred) {
      const v = pick(
        rows.filter((r) => !r.starred),
        better,
      );
      if (v) out[`${side}-verified`] = v;
    }
  }
  return out;
}

export async function collectConstants(targets) {
  const rev = await headOf(REPO);
  const facts = [];
  const warnings = [];
  for (const [id, refs] of targets) {
    let md;
    try {
      md = await get(`https://raw.githubusercontent.com/teorth/optimizationproblems/${rev}/constants/${id}.md`);
    } catch (e) {
      warnings.push(`${id}: ${e.message}`);
      continue;
    }
    const b = bestBounds(md);
    if (!b.upper && !b.lower) warnings.push(`${id}: no bounds table found`);
    for (const [key, r] of Object.entries(b))
      for (const problem of refs)
        facts.push({
          problem,
          source: "optimization-constants",
          key: `${id}-${key}`,
          label: `${key.startsWith("upper") ? "Best upper bound" : "Best lower bound"} with an explicit value${key.endsWith("verified") ? ", independently verified" : ""} (constant ${id})`,
          value: String(r.num),
          num: r.num,
          holder: [plain(r.ref), firstSentence(r.comments)].filter(Boolean).join(" — ").slice(0, 240) || null,
          date: null,
          url: `https://teorth.github.io/optimizationproblems/constants/${id}.html`,
          starred: r.starred,
        });
  }
  return { health: { rev, rows: targets.size, warnings }, facts };
}
