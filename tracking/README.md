# Tracked progress

Collectors that read the current state of open problems from public sources, so that each problem page on
[Cairn Commons](https://cairn-commons.com) shows where the problem stands upstream. They are deterministic: plain
parsers of structured pages and data files, no language models. The same upstream content always gives the same
facts, and every change is committed here with the run that saw it.

| Source | What is read | Problems |
|---|---|---|
| `erdosproblems` | status of each problem in the [erdosproblems.com data file](https://github.com/teorth/erdosproblems) | problems linking erdosproblems.com/N |
| `optimization-constants` | best upper and lower bound with an explicit value, starred (unverified) or not, from [Tao's optimization constants](https://github.com/teorth/optimizationproblems) | problems linking a constant's page |
| `formal-conjectures` | `@[category research open/solved]` of the Lean statement a problem is about, in [Formal Conjectures](https://github.com/google-deepmind/formal-conjectures) | problems linking a Formal Conjectures file |
| `covering-repository` | best known (v,k,t) coverings: the [La Jolla archive on Zenodo](https://doi.org/10.5281/zenodo.10779736) as baseline, then the public "Latest (v,k,t) improvements" page of [coveringrepository.com](https://www.coveringrepository.com) on every run | problems linking coveringrepository.com |

Which problem reads which source follows from the links in `data/problems.jsonl` (`tracking/lib/problems.mjs`).

## Files

| Path | Content |
|---|---|
| `facts.json` | current facts per problem: source, key, label, value, holder, date, link |
| `changes/<YYYY-MM>.jsonl` | every change a run saw (a fact's new value, or a new record), with the day it was detected |
| `state/covering.json` | best known covering per (v,k,t), one line per parameter set: blocks, lower bound, holder, date, origin (`archive` or `feed`) |
| `health.json` | when each source was last read, whether it answered, warnings (for example a possible gap in a feed) |

A source that fails keeps its last good facts and is marked as failing in `health.json`. Sites that put pages
behind a bot check are not read around it: the collector records the block and stops.

Run it locally with `npm ci --prefix tracking && node tracking/run.mjs`; `npm test --prefix tracking` runs the
parser tests against saved pages in `tracking/test/fixtures`.
