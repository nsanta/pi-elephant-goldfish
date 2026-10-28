/**
 * EGM artifact directory configuration and Goldfish child-process env knobs.
 *
 * Resolution order for the artifact directory:
 *   1. `EGM_ARTIFACT_DIR` environment variable
 *   2. A `EGM artifact directory: <path>` line (case-insensitive key) in
 *      `<workspaceRoot>/AGENTS.md`, then `<workspaceRoot>/CLAUDE.md`
 *   3. Default `.` — resolved against the workspace root
 *
 * Relative values always resolve against the workspace root. The directory is
 * created (recursively) if missing.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ARTIFACT_MARKER = /^EGM artifact directory:\s*(.+)$/im;
const DEFAULT_TIMEOUT_MS = 900_000;
const DEFAULT_MAX_CONCURRENT = 3;

function readConfiguredArtifactDir(workspaceRoot: string): string | undefined {
  const envValue = process.env.EGM_ARTIFACT_DIR?.trim();
  if (envValue) {
    return envValue;
  }
  for (const markerFile of ["AGENTS.md", "CLAUDE.md"]) {
    const markerPath = path.join(workspaceRoot, markerFile);
    if (!existsSync(markerPath)) {
      continue;
    }
    try {
      const contents = readFileSync(markerPath, "utf8");
      const match = contents.match(ARTIFACT_MARKER);
      if (match?.[1]?.trim()) {
        return match[1].trim();
      }
    } catch {
      // Unreadable marker file: fall through to the next candidate.
    }
  }
  return undefined;
}

/** Resolve (and create, if missing) the artifact directory for a workspace. */
export function resolveArtifactDir(workspaceRoot: string): string {
  const configured = readConfiguredArtifactDir(workspaceRoot);
  const raw = configured ?? ".";
  const dir = path.isAbsolute(raw) ? raw : path.resolve(workspaceRoot, raw);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Goldfish child timeout in ms (`EGM_GOLDFISH_TIMEOUT_MS`, default 900000, clamped >= 1). */
export function getGoldfishTimeoutMs(): number {
  const raw = Number(process.env.EGM_GOLDFISH_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.max(1, Math.floor(raw));
}

/** Max simultaneous Goldfish children (`EGM_GOLDFISH_MAX_CONCURRENT`, default 3, clamped >= 1). */
export function getGoldfishMaxConcurrent(): number {
  const raw = Number(process.env.EGM_GOLDFISH_MAX_CONCURRENT);
  if (!Number.isFinite(raw) || raw < 1) {
    return DEFAULT_MAX_CONCURRENT;
  }
  return Math.max(1, Math.floor(raw));
}
