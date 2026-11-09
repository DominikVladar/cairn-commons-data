// Status of the statements in Google DeepMind's Formal Conjectures (github.com/google-deepmind/formal-conjectures):
// every Lean statement carries `@[category research open]` or `@[category research solved]` (and similar).
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shallowClone } from "../lib/git.mjs";

const REPO = "https://github.com/google-deepmind/formal-conjectures";
export const VERSION = 4;

/** Pure: a Lean file → [{ name, category }] for every declaration with a `category` attribute, in file order. */
export function leanCategories(src) {
  const out = [];
  const re = /@\[\s*category\s+([^\],]+?)\s*(?:,[^\]]*)?\]\s*(?:(?:private|protected|noncomputable)\s+)*(?:theorem|lemma|def|abbrev)\s+([^\s(:{[]+)/g;
  for (const m of src.matchAll(re)) out.push({ name: m[2], category: m[1].replace(/\s+/g, " ").trim() });
  return out;
}

/**
 * The statement a problem is about: the declaration named by its Lean target ("Erdos10.erdos_10" matches
 * `theorem erdos_10` inside `namespace Erdos10`), else the first research statement that is not a variant.
 */
export function mainStatement(decls, target) {
  if (target) {
    const short = target.split(".").pop();
    // A named target that is not a categorised declaration here (renamed, or a definition): no guess.
    return decls.find((d) => d.name === target || target.endsWith(`.${d.name}`) || d.name === short) ?? null;
  }
  const research = decls.filter((d) => d.category.startsWith("research"));
  return research.find((d) => !/variant/i.test(d.name)) ?? research[0] ?? null;
}

export function summarize(decls, target) {
  const research = decls.filter((d) => d.category.startsWith("research"));
  const count = (c) => research.filter((d) => d.category === c).length;
  return { main: mainStatement(decls, target), open: count("research open"), solved: count("research solved"), total: research.length };
}

export async function collectFormalConjectures(targets, { checkout } = {}) {
  const dir = checkout ?? mkdtempSync(join(tmpdir(), "fc-"));
  try {
    const rev = checkout ? null : shallowClone(REPO, join(dir, "repo"));
    const root = checkout ?? join(dir, "repo");
    const facts = [];
    const warnings = [];
    let files = 0;
    for (const [path, refs] of targets) {
      const f = join(root, path);
      if (!existsSync(f)) {
        warnings.push(`${path}: no longer in the repository (moved or removed)`);
        continue;
      }
      files++;
      const decls = leanCategories(readFileSync(f, "utf8"));
      const url = `${REPO}/blob/${rev ?? "main"}/${path}`;
      for (const { ref: problem, target } of refs) {
        const s = summarize(decls, target);
        if (!s.total) {
          warnings.push(`${path}: no research statement found`);
          continue;
        }
        if (target && !s.main) warnings.push(`${path}: ${target} not found among the categorised statements`);
        // Without a Lean target (a curated problem that links the file) the file may hold several problems:
        // only the counts are reported, not one statement's status.
        if (target && s.main) facts.push({
          problem,
          source: "formal-conjectures",
          key: "main",
          label: `Formal Conjectures: status of \`${s.main.name}\``,
          value: s.main.category,
          num: null,
          holder: null,
          date: null,
          url,
        });
        facts.push({
          problem,
          source: "formal-conjectures",
          key: "statements",
          label: "Formal Conjectures: research statements in the file",
          value: `${s.open} open, ${s.solved} solved${s.total - s.open - s.solved ? `, ${s.total - s.open - s.solved} other` : ""}`,
          num: null,
          holder: null,
          date: null,
          url,
        });
      }
    }
    if (files < targets.size / 2) throw new Error(`only ${files} of ${targets.size} tracked files found; the layout may have changed`);
    return { health: { rev, rows: files, warnings }, facts };
  } finally {
    if (!checkout) rmSync(dir, { recursive: true, force: true });
  }
}
