#!/usr/bin/env node
// Verify a Cairn Commons export manifest against the data files (no dependencies, Node >= 18).
//
//   node scripts/verify-export.mjs [manifests/<day>.json] [--claim C-123] [--content-hash <sha256>]
//
// Checks that every file listed in the manifest has the recorded SHA-256 and line count, and that the Merkle
// root matches. Run it on the commit of that day (`git checkout <commit>`); the data files are overwritten
// daily, git history keeps every version. With --claim it also prints the claim's content hash from that
// day's claims.jsonl (and compares it with --content-hash). Then `ots verify manifests/<day>.json.ots` proves
// the manifest existed no later than the Bitcoin block it is anchored in.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const sha256Hex = (data) => createHash("sha256").update(data).digest("hex");

/** Binary Merkle root over hex SHA-256 leaves; pairs are hashed as raw 32-byte concatenations, odd node promoted. */
export function merkleRoot(leaves) {
  if (leaves.length === 0) return sha256Hex("");
  let level = [...leaves];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2)
      next.push(
        i + 1 < level.length
          ? sha256Hex(Buffer.concat([Buffer.from(level[i], "hex"), Buffer.from(level[i + 1], "hex")]))
          : level[i],
      );
    level = next;
  }
  return level[0];
}

/** Returns a list of problems (empty = valid). `root` is the repository root containing data/. */
export function verifyManifest(manifest, root) {
  const problems = [];
  if (manifest.format !== "cairn-commons-export/1") problems.push(`unknown format ${manifest.format}`);
  for (const f of manifest.files ?? []) {
    let content;
    try {
      content = readFileSync(join(root, "data", f.name));
    } catch {
      problems.push(`${f.name}: missing`);
      continue;
    }
    const sha = sha256Hex(content);
    if (sha !== f.sha256) problems.push(`${f.name}: sha256 ${sha} != ${f.sha256}`);
    const text = content.toString("utf8");
    const lines = text === "" ? 0 : text.replace(/\n$/, "").split("\n").length;
    if (lines !== f.lines) problems.push(`${f.name}: ${lines} lines != ${f.lines}`);
  }
  const root2 = merkleRoot((manifest.files ?? []).map((f) => f.sha256));
  if (root2 !== manifest.merkleRoot) problems.push(`merkle root ${root2} != ${manifest.merkleRoot}`);
  return problems;
}

export function findClaim(root, ref) {
  const text = readFileSync(join(root, "data", "claims.jsonl"), "utf8");
  for (const line of text.split("\n")) {
    if (!line) continue;
    const c = JSON.parse(line);
    if (c.ref === ref) return c;
  }
  return null;
}

async function main(argv) {
  const args = [...argv];
  const opt = (name) => {
    const i = args.indexOf(name);
    if (i < 0) return null;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
  };
  const claimRef = opt("--claim");
  const expectedHash = opt("--content-hash");
  let path = args[0];
  if (!path) {
    const days = readdirSync("manifests")
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort();
    if (!days.length) throw new Error("no manifests found");
    path = join("manifests", days.at(-1));
  }
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  const root = resolve(dirname(path), "..");
  const problems = verifyManifest(manifest, root);
  if (problems.length) {
    console.error(`INVALID ${path}\n  ${problems.join("\n  ")}`);
    console.error("(Data files are overwritten daily: check out the commit of that day first.)");
    process.exit(1);
  }
  console.log(`OK ${path}: ${manifest.files.length} files, merkle root ${manifest.merkleRoot}`);
  if (claimRef) {
    const c = findClaim(root, claimRef);
    if (!c) {
      console.error(`claim ${claimRef} is not in this export`);
      process.exit(1);
    }
    console.log(`${claimRef}: contentHash ${c.contentHash}, createdAt ${c.createdAt}`);
    if (expectedHash && expectedHash !== c.contentHash) {
      console.error(`content hash differs from ${expectedHash}`);
      process.exit(1);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("verify-export.mjs"))
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
