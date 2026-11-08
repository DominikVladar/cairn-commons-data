import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { bestBounds } from "../adapters/constants.mjs";
import { applyFeed, cellsFromArchive, serializeCoveringState } from "../adapters/covering.mjs";
import { parseCoveringGrid } from "../adapters/covering-parse.mjs";
import { erdosStatuses } from "../adapters/erdos.mjs";
import { leanCategories, mainStatement, summarize } from "../adapters/formal-conjectures.mjs";
import { trackingTargets } from "../lib/problems.mjs";
import { canonical, cellValue } from "../lib/util.mjs";

const fixture = (f) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");

test("table cells: values, fractions, and expressions without a value", () => {
  assert.equal(cellValue("$0.379005$"), 0.379005);
  assert.equal(cellValue("$1/2=0.5$"), 0.5);
  assert.equal(cellValue("$5/12 = 0.41666\\dots$"), 0.41666);
  assert.equal(cellValue("$\\sqrt{4-\\sqrt{15}} \\approx 0.356393$"), 0.356393);
  assert.equal(cellValue("$1.7813^\\*$"), 1.7813);
  assert.equal(cellValue("$\\frac{117}{370}$"), 117 / 370);
  assert.equal(cellValue("$K_{DR} + 10^{-26}$"), null);
  assert.equal(cellValue("$\\frac{1}{\\sqrt{10}}$"), null);
});

test("optimization constants: best bounds, starred rows and the best verified one", () => {
  const b1 = bestBounds(fixture("constant-1b.md"));
  assert.equal(b1.upper.num, 0.3808585504);
  assert.equal(b1.upper.ref, "[A2026]");
  assert.equal(b1.lower.num, 0.379005);
  const b10 = bestBounds(fixture("constant-10a.md"));
  assert.equal(b10.upper.num, 1.7813);
  assert.equal(b10.upper.starred, true);
  assert.equal(b10["upper-verified"].num, 1.782214);
  assert.equal(b10.lower.num, 1.7136); // "K_DR + 10^{-12}" rows have no value and are skipped
  const b1a = bestBounds(fixture("constant-1a.md"));
  assert.equal(b1a.lower.starred, true);
  assert.equal(b1a["lower-verified"].num, 1.2802);
  assert.equal(bestBounds(fixture("constant-74a.md")).lower.num, 117 / 370);
});

test("formal conjectures: categories and the statement a problem is about", () => {
  const decls = leanCategories(fixture("erdos-10.lean"));
  assert.ok(decls.some((d) => d.name === "erdos_10" && d.category === "research open"));
  assert.equal(mainStatement(decls, "Erdos10.erdos_10").name, "erdos_10");
  assert.equal(mainStatement(decls, "Erdos10.renamed"), null); // no guessing
  assert.equal(mainStatement(decls, null).name, "erdos_10");
  const s = summarize(leanCategories(fixture("erdos-1.lean")), "Erdos1.erdos_1");
  assert.ok(s.total >= s.open + s.solved);
  // Multi-line attributes are read too.
  const multi = leanCategories("@[category research solved, AMS 5,\n  formal_proof using lean4 at \"x\"]\ntheorem foo : True := trivial");
  assert.deepEqual(multi, [{ name: "foo", category: "research solved" }]);
});

test("erdosproblems data file: state and date per problem", () => {
  const s = erdosStatuses(fixture("erdos-problems.yaml"));
  assert.equal(s["1"].state, "disproved (Lean)");
  assert.equal(s["1"].prize, "$500");
  assert.match(s["1"].updated, /^\d{4}-\d{2}-\d{2}$/);
});

test("covering repository: improvements page rows", () => {
  const { rows, skipped, grid } = parseCoveringGrid(fixture("covering-improvements.html"));
  assert.equal(grid, true);
  assert.equal(skipped, 0);
  assert.deepEqual(rows[0], {
    v: 36, k: 6, t: 2, m: 2, blocks: 46, lowerBound: 42, author: "Arhan Canli (Quantavane)", notes: "", date: "2026-11-05", historyId: 109095,
  });
  assert.equal(rows[1].blocks, 7849); // "7.849": dots are thousands separators
  assert.equal(rows[1].notes, "Dynamic programming construction\n(includes non-free components)");
  assert.equal(rows[2].m, 7); // a (v,k,t,m) row: not a (v,k,t) covering
  assert.equal(parseCoveringGrid("<html>Just a moment...</html>").grid, false);
});

test("covering repository: archive baseline and feed improvements", () => {
  const cells = cellsFromArchive({
    "C(36,6,2)": { size: 47, low_bd: 42, imps: [["47", "", "Anastasios Tampakis", "2008-11-15 06:00:32"]] },
    "C(70,10,4)": { size: 7800, low_bd: 4564, imps: [["7800", "", "LJCR", "2020-01-01 00:00:00"]] },
    junk: {},
  });
  assert.deepEqual(cells["C(36,6,2)"], [47, 42, "Anastasios Tampakis", "2008-11-15", "archive"]);
  const { rows } = parseCoveringGrid(fixture("covering-improvements.html"));
  const events = applyFeed(cells, rows);
  // 46 < 47 improves; 7849 > 7800 does not; the (v,k,t,m) row is ignored.
  assert.deepEqual(events, [{ key: "C(36,6,2)", from: 47, to: 46, holder: "Arhan Canli (Quantavane)", date: "2026-11-05", note: null }]);
  assert.deepEqual(cells["C(36,6,2)"], [46, 42, "Arhan Canli (Quantavane)", "2026-11-05", "feed"]);
  assert.deepEqual(applyFeed(cells, rows), []); // idempotent
  const text = serializeCoveringState({ archive: { record: "1" }, feedSince: "2026-11-09", lastFeed: "2026-11-05", cells });
  assert.deepEqual(JSON.parse(text).cells, cells);
  assert.equal(text.split("\n").filter((l) => l.startsWith('"C(')).length, 2);
});

test("which problem tracks which source, from the exported problem list", () => {
  const t = trackingTargets([
    { ref: "P-erdos-10", formalStatement: "type_of% @Erdos10.erdos_10", sources: [{ url: "https://github.com/google-deepmind/formal-conjectures/blob/abc123/FormalConjectures/ErdosProblems/10.lean" }] },
    { ref: "P-erdos-minimum-overlap", sources: [{ url: "https://www.erdosproblems.com/36" }, { url: "https://teorth.github.io/optimizationproblems/constants/1b.html" }] },
    { ref: "P-covering-designs", sources: [{ url: "https://www.coveringrepository.com" }] },
  ]);
  assert.deepEqual(t.erdos.get("10"), ["P-erdos-10"]);
  assert.deepEqual(t.erdos.get("36"), ["P-erdos-minimum-overlap"]);
  assert.deepEqual(t.constants.get("1b"), ["P-erdos-minimum-overlap"]);
  assert.deepEqual(t.formalConjectures.get("FormalConjectures/ErdosProblems/10.lean"), [{ ref: "P-erdos-10", target: "Erdos10.erdos_10" }]);
  assert.deepEqual(t.covering, ["P-covering-designs"]);
});

test("canonical JSON sorts keys", () => {
  assert.equal(canonical({ b: 1, a: [{ d: 1, c: 2 }] }, 0), '{"a":[{"c":2,"d":1}],"b":1}\n');
});
