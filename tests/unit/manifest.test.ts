/**
 * Package manifest tests (upstream test_packaging.py intent, adapted to the Pi
 * package layout): the `pi` globs match real files, host packages stay in
 * peerDependencies only, the pi-package keyword is present, and the extension
 * source's EGM_VERSION constant matches package.json.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as {
  version: string;
  keywords: string[];
  pi?: { skills?: string[]; extensions?: string[]; prompts?: string[] };
  peerDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const HOST_PACKAGES = [
  "@earendil-works/pi-ai",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
  "typebox",
];

/** Walk the repo (skipping dot dirs and node_modules) collecting relative POSIX paths, files AND directories. */
function walkRelative(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".") || entry === "node_modules" || entry === "dist") continue;
    const full = path.join(dir, entry);
    const rel = path.relative(base, full).split(path.sep).join("/");
    out.push(rel);
    if (statSync(full).isDirectory()) out.push(...walkRelative(full, base));
  }
  return out;
}

/** Minimal glob -> RegExp: `**` crosses separators, `*` and `?` do not. */
function globToRegExp(glob: string): RegExp {
  const source = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\0")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\0/g, ".*");
  return new RegExp(`^${source}$`);
}

function globMatches(glob: string): string[] {
  const re = globToRegExp(glob);
  return walkRelative(REPO_ROOT).filter((rel) => re.test(rel) && existsSync(path.join(REPO_ROOT, rel)));
}

describe("package.json manifest", () => {
  it("pi.skills globs match at least one existing path", () => {
    const globs = pkg.pi?.skills ?? [];
    expect(globs.length).toBeGreaterThan(0);
    const matches = globs.flatMap(globMatches);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    // pi loads each matched directory as a skill package (its SKILL.md inside).
    expect(matches).toContain("skills/egm-review");
    expect(matches).toContain("skills/egm-bootstrap");
  });

  it("pi.extensions globs match at least one existing path", () => {
    const globs = pkg.pi?.extensions ?? [];
    expect(globs.length).toBeGreaterThan(0);
    const matches = globs.flatMap(globMatches);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches.some((m) => m.endsWith(".ts"))).toBe(true);
  });

  it("peerDependencies are exactly the five host packages, all '*'", () => {
    const peers = pkg.peerDependencies ?? {};
    expect(Object.keys(peers).sort()).toEqual([...HOST_PACKAGES].sort());
    for (const [name, range] of Object.entries(peers)) {
      expect(range, `peerDependencies[${name}]`).toBe("*");
    }
  });

  it("host packages never appear in dependencies (consumers must not vendor them)", () => {
    const deps = pkg.dependencies ?? {};
    for (const host of HOST_PACKAGES) {
      expect(deps, `dependencies must not contain ${host}`).not.toHaveProperty(host);
    }
  });

  it("devDependencies contain only vitest and typescript", () => {
    expect(Object.keys(pkg.devDependencies ?? {}).sort()).toEqual(["typescript", "vitest"]);
  });

  it("keywords include 'pi-package'", () => {
    expect(pkg.keywords).toContain("pi-package");
  });

  it("EGM_VERSION in extensions/egm-core.ts equals package.json version", () => {
    const source = readFileSync(path.join(REPO_ROOT, "extensions", "egm-core.ts"), "utf8");
    const match = source.match(/export const EGM_VERSION\s*=\s*"([^"]+)"/);
    expect(match, "EGM_VERSION constant not found in extensions/egm-core.ts").not.toBeNull();
    expect(match?.[1]).toBe(pkg.version);
  });
});
