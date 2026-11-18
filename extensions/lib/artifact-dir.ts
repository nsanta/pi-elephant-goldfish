/**
 * EGM artifact directory configuration and Goldfish child-process env knobs.
 *
 * Resolution order for the artifact directory:
 *   1. `EGM_ARTIFACT_DIR` environment variable
 *   2. A `EGM artifact directory: <path>` line (case-insensitive key) in
 *      `<workspaceRoot>/AGENTS.md`, then `<workspaceRoot>/CLAUDE.md`
 *   3. Default `.` — resolved against the workspace root
 *
 * Resolution order for the artifact layout (see `resolveArtifactLayout`):
 *   1. `EGM_ARTIFACT_LAYOUT` environment variable
 *   2. A `EGM artifact layout: flat|structured` line in `AGENTS.md`, then
 *      `CLAUDE.md`
 *   3. Default `structured` — artifacts under `<artifact-dir>/egm/<slug>/`
 *
 * Unrecognized layout values are skipped (the next candidate decides), so a
 * typo can never disable an explicit `flat` marker further down the chain.
 *
 * Relative values always resolve against the workspace root. The directory is
 * created (recursively) if missing.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ARTIFACT_MARKER = /^EGM artifact directory:\s*(.+)$/im;
const LAYOUT_MARKER = /^EGM artifact layout:\s*(\S+)\s*$/im;
const MARKER_FILES = ["AGENTS.md", "CLAUDE.md"] as const;
const DEFAULT_TIMEOUT_MS = 900_000;
const DEFAULT_MAX_CONCURRENT = 3;
const EGM_TREE_ROOT = "egm";
const BOOTSTRAP_TREE_DIR = "bootstrap";
const DEFAULT_SLUG = "design";
const MAX_SLUG_LENGTH = 64;

function firstMarkerValue(workspaceRoot: string, marker: RegExp): string | undefined {
  for (const markerFile of MARKER_FILES) {
    const markerPath = path.join(workspaceRoot, markerFile);
    if (!existsSync(markerPath)) {
      continue;
    }
    try {
      const contents = readFileSync(markerPath, "utf8");
      const match = contents.match(marker);
      if (match?.[1]?.trim()) {
        return match[1].trim();
      }
    } catch {
      // Unreadable marker file: fall through to the next candidate.
    }
  }
  return undefined;
}

function readConfiguredArtifactDir(workspaceRoot: string): string | undefined {
  const envValue = process.env.EGM_ARTIFACT_DIR?.trim();
  if (envValue) {
    return envValue;
  }
  return firstMarkerValue(workspaceRoot, ARTIFACT_MARKER);
}

/** Resolve (and create, if missing) the artifact directory for a workspace. */
export function resolveArtifactDir(workspaceRoot: string): string {
  const configured = readConfiguredArtifactDir(workspaceRoot);
  const raw = configured ?? ".";
  const dir = path.isAbsolute(raw) ? raw : path.resolve(workspaceRoot, raw);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** How EGM arranges artifacts inside the artifact directory. */
export type ArtifactLayout = "flat" | "structured";

/** Which lifecycle a resolved artifact belongs to. */
export type ArtifactKind = "feature" | "bootstrap";

/**
 * Resolve the artifact layout: `EGM_ARTIFACT_LAYOUT`, then a
 * `EGM artifact layout:` marker line, then the default `structured`.
 * Unrecognized values are skipped so the next candidate decides.
 */
export function resolveArtifactLayout(workspaceRoot: string): ArtifactLayout {
  const candidates = [
    process.env.EGM_ARTIFACT_LAYOUT?.trim().toLowerCase(),
    firstMarkerValue(workspaceRoot, LAYOUT_MARKER)?.toLowerCase(),
  ];
  for (const candidate of candidates) {
    if (candidate === "flat") {
      return "flat";
    }
    if (candidate === "structured") {
      return "structured";
    }
  }
  return "structured";
}

/**
 * Normalize a feature slug to a filesystem-safe kebab-case directory name:
 * lowercase ASCII alphanumerics, separator runs collapsed to single dashes,
 * capped at 64 characters, never empty (falls back to `"design"`).
 */
export function normalizeFeatureSlug(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
  return slug || DEFAULT_SLUG;
}

export interface ArtifactPathOptions {
  /** Artifact file name (any directory part is dropped). */
  name: string;
  /** Feature slug; used as the directory name in structured mode. */
  slug?: string;
  /** Lifecycle kind; `bootstrap` ignores the slug and uses a fixed directory. */
  kind?: ArtifactKind;
}

/**
 * Resolve (and create, if missing) the full artifact file path for one
 * artifact. Structured layout: `<artifact-dir>/egm/<slug>/<name>` (or
 * `<artifact-dir>/egm/bootstrap/<name>`). Flat layout: legacy
 * `<artifact-dir>/<name>`.
 */
export function resolveArtifactPath(
  workspaceRoot: string,
  options: ArtifactPathOptions,
): string {
  const artifactDir = resolveArtifactDir(workspaceRoot);
  const name = path.basename(options.name);
  if (resolveArtifactLayout(workspaceRoot) === "flat") {
    return path.join(artifactDir, name);
  }
  const leaf =
    options.kind === "bootstrap" ? BOOTSTRAP_TREE_DIR : normalizeFeatureSlug(options.slug ?? "");
  const dir = path.join(artifactDir, EGM_TREE_ROOT, leaf);
  mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
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
