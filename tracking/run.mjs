#!/usr/bin/env node
// Collects the current state of tracked problems from public sources and records what changed.
//
//   node tracking/run.mjs [--only erdosproblems,optimization-constants,formal-conjectures,covering-repository]
//
// Reads data/problems.jsonl (which problem links which source), writes tracking/facts.json (current facts per
// problem), tracking/changes/<YYYY-MM>.jsonl (every change, appended), tracking/state/* (source state that later
// runs build on) and tracking/health.json (did each source answer, and when). Deterministic: no language models,
// only parsers of structured pages and files; the same upstream content gives the same facts.
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { appendFileSync, mkdirSync } from "node:fs";
import { canonical, readJson, sha256, writeIfChanged } from "./lib/util.mjs";
import { loadProblems, trackingTargets } from "./lib/problems.mjs";
import { collectErdos, VERSION as V_ERDOS } from "./adapters/erdos.mjs";
import { collectConstants, VERSION as V_CONSTANTS } from "./adapters/constants.mjs";
import { collectFormalConjectures, VERSION as V_FC } from "./adapters/formal-conjectures.mjs";
import { collectCovering, serializeCoveringState, VERSION as V_COVERING } from "./adapters/covering.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1] ?? ""] : [])).filter((x) => x.length),
);
const only = args.only ? new Set(args.only.split(",")) : null;
const now = new Date();
const today = now.toISOString().slice(0, 10);

const problems = loadProblems(join(ROOT, "data", "problems.jsonl"));
const targets = trackingTargets(problems);
const prevFacts = readJson(join(HERE, "facts.json"), { facts: [] }).facts;
const prevHealth = readJson(join(HERE, "health.json"), { sources: {} }).sources;

/** Parser versions: when a parser changes, its first run re-reads everything without reporting changes. */
const PARSER = { erdosproblems: V_ERDOS, "optimization-constants": V_CONSTANTS, "formal-conjectures": V_FC, "covering-repository": V_COVERING };
const SOURCES = {
  erdosproblems: () => collectErdos(targets.erdos),
  "optimization-constants": () => collectConstants(targets.constants),
  "formal-conjectures": () => collectFormalConjectures(targets.formalConjectures),
  "covering-repository": async () => {
    const statePath = join(HERE, "state", "covering.json");
    const prev = readJson(statePath, null);
    const r = await collectCovering(targets.covering, prev && { ...prev.meta, cells: prev.cells }, today);
    writeIfChanged(statePath, serializeCoveringState(r.state));
    return r;
  },
};

const factKey = (f) => `${f.problem}\u0000${f.source}\u0000${f.key}`;
const health = {};
const facts = [];
const events = [];
let failed = 0;
for (const [name, run] of Object.entries(SOURCES)) {
  if (only && !only.has(name)) {
    facts.push(...prevFacts.filter((f) => f.source === name));
    if (prevHealth[name]) health[name] = prevHealth[name];
    continue;
  }
  const started = Date.now();
  try {
    const r = await run();
    facts.push(...r.facts);
    events.push(...(r.events ?? []));
    health[name] = { ok: true, checkedAt: now.toISOString(), seconds: Math.round((Date.now() - started) / 1000), parser: PARSER[name], ...r.health };
    console.log(`${name}: ${r.facts.length} facts${r.health.warnings?.length ? `, ${r.health.warnings.length} warnings` : ""}`);
    for (const w of r.health.warnings ?? []) console.log(`::warning::${name}: ${w}`);
  } catch (e) {
    failed++;
    // Keep the last good facts of a failing source: a broken source must not look like a solved problem.
    facts.push(...prevFacts.filter((f) => f.source === name));
    health[name] = {
      ...(prevHealth[name] ?? {}),
      ok: false,
      failedAt: now.toISOString(),
      error: String(e.message ?? e).slice(0, 500),
      blocked: !!e.blocked,
    };
    console.log(`::error::${name}: ${health[name].error}`);
  }
}

// What changed: every fact whose value differs from the previous run, plus the record improvements the sources
// report themselves. New facts (a newly tracked problem) are recorded without an event.
const before = new Map(prevFacts.map((f) => [factKey(f), f]));
const hadSource = new Set(prevFacts.map((f) => f.source));
const reparsed = new Set(
  Object.keys(SOURCES).filter((n) => health[n]?.ok && prevHealth[n] && prevHealth[n].parser !== PARSER[n]),
);
for (const n of reparsed) console.log(`${n}: parser changed (${prevHealth[n].parser} → ${PARSER[n]}); facts re-read, no changes reported`);
for (const f of facts) {
  if (reparsed.has(f.source)) continue;
  const p = before.get(factKey(f));
  if (p && p.value !== f.value)
    events.push({ problem: f.problem, source: f.source, key: f.key, label: f.label, from: p.value, to: f.value, holder: f.holder, date: f.date, url: f.url, kind: "fact" });
  else if (!p && hadSource.has(f.source) && prevFacts.some((x) => x.problem === f.problem && x.source === f.source))
    events.push({ problem: f.problem, source: f.source, key: f.key, label: f.label, from: null, to: f.value, holder: f.holder, date: f.date, url: f.url, kind: "fact" });
}
facts.sort((a, b) => factKey(a).localeCompare(factKey(b)));

const factsText = canonical({ facts });
writeIfChanged(join(HERE, "facts.json"), factsText);
if (events.length) {
  mkdirSync(join(HERE, "changes"), { recursive: true });
  const lines = events.map((e) => {
    const id = sha256(`${e.problem}|${e.source}|${e.key}|${e.from}|${e.to}|${e.date ?? ""}`).slice(0, 16);
    return JSON.stringify({ id, detected: today, ...e });
  });
  appendFileSync(join(HERE, "changes", `${today.slice(0, 7)}.jsonl`), `${lines.join("\n")}\n`);
}
writeIfChanged(join(HERE, "health.json"), canonical({ checkedAt: now.toISOString(), sources: health }));
writeIfChanged(join(HERE, "version.txt"), `${sha256(factsText + canonical(health) + events.length)}\n`);
console.log(`${facts.length} facts, ${events.length} changes, ${failed} sources failed`);
// A failing source is reported in health.json (and on the platform); the run itself only fails when nothing worked.
process.exit(failed === Object.keys(SOURCES).length ? 1 : 0);
