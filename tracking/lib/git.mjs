import { execFileSync } from "node:child_process";

/** The commit a public repository's default branch points to (git ls-remote: no API rate limit). */
export async function headOf(repoUrl) {
  const out = execFileSync("git", ["ls-remote", repoUrl, "HEAD"], { encoding: "utf8", timeout: 60_000 });
  const sha = /^([0-9a-f]{40})\s+HEAD/m.exec(out)?.[1];
  if (!sha) throw new Error(`could not read HEAD of ${repoUrl}`);
  return sha;
}

/** A shallow checkout of a public repository at its current default branch, in `dir`. */
export function shallowClone(repoUrl, dir) {
  execFileSync("git", ["clone", "--quiet", "--depth", "1", repoUrl, dir], { timeout: 600_000, stdio: "inherit" });
  return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}
