/**
 * Locate the local Pi installation so tests (and vitest.config.ts) can alias
 * host packages that the extension modules value-import (`typebox`,
 * `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`).
 *
 * Discovery order:
 *   1. `PI_PKG_DIR` environment variable (explicit override).
 *   2. The `pi` binary on PATH: resolve its realpath, then walk up to the
 *      nearest `node_modules/@earendil-works/pi-coding-agent` directory.
 *
 * Companion packages (pi-tui, typebox) are searched under the same node_modules
 * root as the pi package, then inside the pi package's own nested
 * `node_modules` (how npm lays out the global pi install). `typebox` may be
 * flat (`typebox`) or scoped (`@sinclair/typebox`); whichever exists wins.
 *
 * When discovery fails, `hostResolved` is false and host-import-dependent
 * suites gate themselves off with `describe.skipIf(!hostResolved)`.
 */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

export interface HostPiResolution {
  /** Absolute path of the located `@earendil-works/pi-coding-agent` package. */
  piPackageDir: string;
  /** Alias map (import specifier -> resolved entry file) for vitest. */
  aliases: Record<string, string>;
}

/** True when every host package needed by the extension modules was resolved. */
export const REQUIRED_ALIASES = [
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
  "typebox",
] as const;

function resolveEntryFile(pkgDir: string): string | null {
  const pkgJsonPath = path.join(pkgDir, "package.json");
  if (!existsSync(pkgJsonPath)) return null;
  try {
    const pkg = JSON.parse(readFileText(pkgJsonPath)) as {
      main?: string;
      module?: string;
      exports?: Record<string, unknown>;
    };
    let entry: string | undefined;
    const dot = pkg.exports?.["."];
    if (typeof dot === "string") {
      entry = dot;
    } else if (dot && typeof dot === "object") {
      const conditional = dot as { import?: string; default?: string };
      entry = conditional.import ?? conditional.default;
    }
    entry ??= pkg.main ?? pkg.module ?? "index.js";
    const resolved = path.resolve(pkgDir, entry);
    return existsSync(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

function readFileText(file: string): string {
  return readFileSync(file, "utf8");
}

/** Walk up from `startDir` to the nearest node_modules/@earendil-works/pi-coding-agent. */
function walkUpToPiPackage(startDir: string): string | null {
  let current = path.resolve(startDir);
  for (;;) {
    if (
      path.basename(current) === "pi-coding-agent" &&
      path.basename(path.dirname(current)) === "@earendil-works" &&
      path.basename(path.dirname(path.dirname(current))) === "node_modules"
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function findPackageDir(roots: string[], candidates: string[]): string | null {
  for (const root of roots) {
    for (const candidate of candidates) {
      const dir = path.join(root, candidate);
      if (existsSync(dir) && statSync(dir).isDirectory()) return dir;
    }
  }
  return null;
}

/** All plausible node_modules roots to search for companion packages. */
function nodeModulesRoots(piPackageDir: string): string[] {
  const roots: string[] = [];
  // Top-level node_modules that contains @earendil-works/pi-coding-agent.
  const topNodeModules = path.dirname(path.dirname(piPackageDir));
  if (path.basename(topNodeModules) === "node_modules") roots.push(topNodeModules);
  // Nested node_modules inside the pi package itself.
  const nested = path.join(piPackageDir, "node_modules");
  if (existsSync(nested)) roots.push(nested);
  return roots;
}

export function discoverHostPi(): HostPiResolution | null {
  const envDir = process.env.PI_PKG_DIR?.trim();
  let piPackageDir: string | null = null;

  if (envDir) {
    piPackageDir = path.resolve(envDir);
    if (!existsSync(piPackageDir)) return null;
  } else {
    const pathDirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
    for (const dir of pathDirs) {
      const candidate = path.join(dir, "pi");
      if (!existsSync(candidate)) continue;
      let real: string;
      try {
        real = realpathSync(candidate);
      } catch {
        continue;
      }
      piPackageDir = walkUpToPiPackage(path.dirname(real));
      if (piPackageDir) break;
    }
  }
  if (!piPackageDir) return null;

  const aliases: Record<string, string> = {};
  const roots = nodeModulesRoots(piPackageDir);
  const piEntry = resolveEntryFile(piPackageDir);
  if (piEntry) aliases["@earendil-works/pi-coding-agent"] = piEntry;

  const tuiDir = findPackageDir(roots, ["@earendil-works/pi-tui"]);
  const tuiEntry = tuiDir ? resolveEntryFile(tuiDir) : null;
  if (tuiEntry) aliases["@earendil-works/pi-tui"] = tuiEntry;

  // Flat `typebox` first, scoped `@sinclair/typebox` as the alternative layout.
  const typeboxDir = findPackageDir(roots, ["typebox", "@sinclair/typebox"]);
  const typeboxEntry = typeboxDir ? resolveEntryFile(typeboxDir) : null;
  if (typeboxEntry) aliases["typebox"] = typeboxEntry;

  const allResolved = REQUIRED_ALIASES.every((name) => aliases[name] !== undefined);
  return allResolved ? { piPackageDir, aliases } : null;
}

/** Shared gate value: true when the host pi installation resolved completely. */
export const hostPi = discoverHostPi();
export const hostResolved = hostPi !== null;
