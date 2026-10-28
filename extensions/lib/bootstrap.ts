/**
 * `egm_bootstrap` — recursive EGM documentation generation (Pi port).
 *
 * Ports the upstream egm-bootstrap root-orchestrator flow (BFS discovery,
 * >15-directory safety gate, bottom-up pruning, adaptive partitioning,
 * parallel sub-orchestrator workers, JSON worker returns, root roll-up, and
 * the mandatory final verification pass) into deterministic extension code.
 * Model-driven scout work stays inside the spawned `pi --print` workers;
 * everything the SKILL.md expresses procedurally lives here.
 *
 * The deterministic steps are exported as pure functions so they can be unit
 * tested without spawning child processes.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile as writeFileAsync } from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { PACKAGE_ROOT } from "./paths.ts";
import { resolveArtifactDir } from "./artifact-dir.ts";
import {
  PI_UNAVAILABLE_GUIDANCE,
  findPiBinary,
  getBootstrapMaxConcurrent,
  getBootstrapTimeoutMs,
  runPool,
  runWorkerChild,
  type WorkerChildResult,
} from "./worker-run.ts";

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/** Directories never entered during BFS (upstream Step 2 ignore list). */
const IGNORED_DIRS = new Set([
  ".git",
  ".antigravity",
  "node_modules",
  "venv",
  ".venv",
  "dist",
  "build",
  "third_party",
]);

/** Manifest files preserved during listing (for verification discovery). */
const MANIFEST_FILES = new Set([
  "package.json",
  "Cargo.toml",
  "go.mod",
  "pyproject.toml",
  "setup.py",
  "pytest.ini",
  "Makefile",
  "BUILD",
  "BUILD.bazel",
]);

export interface DiscoveredTree {
  /** Relative POSIX directory paths ("" = the target root) -> file basenames. */
  dirs: Map<string, string[]>;
  /** Manifest basenames found directly in the target root. */
  manifests: string[];
}

/**
 * Pragmatic ignore-glob subset (documented limitation): a `.gitignore` /
 * `.egmignore` pattern matches a directory when (a) the pattern equals the
 * directory basename, (b) the pattern ends with `/` and its remainder equals
 * the basename, or (c) the pattern is a single-level `*`/`?` glob whose
 * basename form matches. No `**`, no anchoring, no `!` negation, no
 * nested-pattern files: only the patterns at the target root are applied.
 */
function ignorePatternToRegExp(pattern: string): RegExp | null {
  const trimmed = pattern.trim().replace(/\/+$/, ""); // "src/" form matches the basename per the subset
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) return null;
  const source = trimmed
    .replace(/\//g, "\\/")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${source}$`);
}

function dirMatchesIgnore(relPath: string, ignoreRes: RegExp[]): boolean {
  const base = relPath.split("/").pop() ?? relPath;
  return ignoreRes.some((re) => re.test(base));
}

/**
 * Upstream Step 2 incremental BFS discovery: level-by-level directory queue
 * (never a recursive glob), skipping ignored/hidden dirs and symlinks, and
 * preserving manifest file names found at the root.
 */
export function discoverTree(root: string, opts?: { extraIgnoreGlobs?: string[] }): DiscoveredTree {
  const ignoreRes: RegExp[] = [];
  for (const ignoreFile of [".gitignore", ".egmignore"]) {
    const ignorePath = path.join(root, ignoreFile);
    if (!existsSync(ignorePath)) continue;
    try {
      for (const line of readFileSync(ignorePath, "utf8").split(/\r?\n/)) {
        const re = ignorePatternToRegExp(line);
        if (re) ignoreRes.push(re);
      }
    } catch {
      // Unreadable ignore file: proceed without its patterns.
    }
  }
  for (const extra of opts?.extraIgnoreGlobs ?? []) {
    const re = ignorePatternToRegExp(extra);
    if (re) ignoreRes.push(re);
  }

  const dirs = new Map<string, string[]>([["", []]]);
  const manifests: string[] = [];
  const queue: string[] = [""];
  while (queue.length > 0) {
    const rel = queue.shift() as string;
    const abs = path.join(root, rel);
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      continue; // Unreadable directory: skip, do not fail the whole discovery.
    }
    const files = dirs.get(rel) ?? [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.isSymbolicLink()) continue; // Never follow links (infinite recursion guard).
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
        if (dirMatchesIgnore(childRel, ignoreRes)) continue;
        if (!dirs.has(childRel)) {
          dirs.set(childRel, []);
          queue.push(childRel);
        }
      } else if (entry.isFile()) {
        files.push(entry.name);
        if (rel === "" && MANIFEST_FILES.has(entry.name)) manifests.push(entry.name);
      }
    }
    dirs.set(rel, files);
  }
  return { dirs, manifests };
}

// ---------------------------------------------------------------------------
// Verification command detection (upstream Step 0)
// ---------------------------------------------------------------------------

/** Upstream Step 0 priority: first matching manifest wins. */
export function detectVerificationCommand(root: string, manifestsSeen: string[]): string {
  const seen = new Set(manifestsSeen);
  if (seen.has("package.json")) {
    const lockPath = (name: string) => path.join(root, name);
    if (existsSync(lockPath("pnpm-lock.yaml"))) return "pnpm test";
    if (existsSync(lockPath("yarn.lock"))) return "yarn test";
    try {
      const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
        packageManager?: string;
      };
      if (typeof pkg.packageManager === "string") {
        if (pkg.packageManager.includes("pnpm")) return "pnpm test";
        if (pkg.packageManager.includes("yarn")) return "yarn test";
      }
    } catch {
      // Unreadable package.json: fall through to the npm default.
    }
    return "npm test";
  }
  if (seen.has("Cargo.toml")) return "cargo test";
  if (seen.has("go.mod")) return "go test ./...";
  if (seen.has("pyproject.toml") || seen.has("pytest.ini") || seen.has("setup.py")) return "pytest";
  if (seen.has("Makefile")) return "make test";
  if (seen.has("BUILD") || seen.has("BUILD.bazel")) return "bazel test ...";
  return "<test-command>";
}

// ---------------------------------------------------------------------------
// Bottom-up pruning (upstream Step 2 pass 3)
// ---------------------------------------------------------------------------

/** Upstream recognized source-code extensions (SKILL.md Step 2 list). */
const SOURCE_EXT_RE =
  /\.(c|cc|cpp|cxx|h|hh|hpp|rs|go|zig|lean|java|kt|scala|cs|fs|py|rb|php|lua|sh|bash|ts|tsx|js|jsx|mjs|cjs|swift|m|dart|sql|proto|graphql|gql|thrift|prisma|tf|hcl|cue)$/;

/** Test-only file patterns: `*_test.*`, `*Test.*`, `test_*.*`, `*.spec.*`. */
function isTestFile(name: string): boolean {
  return (
    /_test\.[^.]+$/.test(name) ||
    /Test\.[^.]+$/.test(name) ||
    /^test_[^.]*\.[^.]+$/.test(name) ||
    /\.spec\.[^.]+$/.test(name)
  );
}

function isTestishDirName(base: string): boolean {
  return base === "tests" || base === "testing" || base === "testdata";
}

function dirHasProductionSource(files: string[]): boolean {
  return files.some((f) => SOURCE_EXT_RE.test(f) && !isTestFile(f));
}

/**
 * Upstream bottom-up post-pruning: keep dirs containing production source
 * files, drop test-only dirs (named tests/testing/testdata, or containing only
 * test-shaped source files), drop dirs with no source files and no surviving
 * descendant, and keep ancestors of survivors. Returns relative paths.
 */
export function pruneTree(discovered: DiscoveredTree): string[] {
  const dirs = discovered.dirs;
  const names = [...dirs.keys()].filter((d) => d !== "");
  const byDepth = [...names].sort((a, b) => b.split("/").length - a.split("/").length);
  const survives = new Set<string>();
  for (const dir of byDepth) {
    const base = dir.split("/").pop() as string;
    const hasSource = !isTestishDirName(base) && dirHasProductionSource(dirs.get(dir) ?? []);
    const childSurvives = [...survives].some((s) => s.startsWith(`${dir}/`));
    if (hasSource || childSurvives) survives.add(dir);
  }
  return names.filter((d) => survives.has(d)).sort();
}

// ---------------------------------------------------------------------------
// Adaptive Depth Partitioning (upstream Step 3)
// ---------------------------------------------------------------------------

function depthOf(relPath: string): number {
  return relPath.split("/").length;
}

/** Deepest common ancestor of the given relative paths ("" when they are top-level siblings). */
function deepestCommonAncestor(paths: string[]): string {
  if (paths.length === 0) return "";
  let segments = paths[0].split("/");
  for (const p of paths.slice(1)) {
    const other = p.split("/");
    let i = 0;
    while (i < segments.length && i < other.length && segments[i] === other[i]) i++;
    segments = segments.slice(0, i);
    if (segments.length === 0) return "";
  }
  return segments.join("/");
}

/**
 * Upstream Adaptive Depth Partitioning: find a depth whose node count is 3-5;
 * <3 walks deeper (max depth 3); >5 groups the 3-4 largest branches (by nested
 * dir count) into partitions plus one fallback partition rooted at the
 * remaining branches' deepest common ancestor. Depth exhausted with <3 nodes
 * falls back to the immediate children of the root (or a single partition).
 */
export function partitionTree(dirs: string[]): string[] {
  let depth = 1;
  while (true) {
    const nodes = dirs.filter((d) => depthOf(d) === depth);
    if (nodes.length >= 3 && nodes.length <= 5) return nodes;
    if (nodes.length < 3) {
      if (depth < 3) {
        depth++;
        continue;
      }
      const children = dirs.filter((d) => depthOf(d) === 1);
      if (children.length > 0) return children;
      return dirs.length > 0 ? [dirs[0]] : [];
    }
    // >5 nodes at this depth: group by nested-directory count.
    const nestedCount = (d: string) => dirs.filter((x) => x.startsWith(`${d}/`)).length;
    const sorted = [...nodes].sort((a, b) => nestedCount(b) - nestedCount(a) || a.localeCompare(b));
    const largest = sorted.slice(0, 4);
    const rest = sorted.slice(4);
    if (rest.length === 0) return largest;
    return [...largest, deepestCommonAncestor(rest)];
  }
}

/**
 * Assign each pruned directory to its deepest containing partition, so an
 * ancestor fallback partition never steals dirs from nested selected ones.
 */
export function assignPartitionDirs(
  partitions: string[],
  pruned: string[],
): Map<string, string[]> {
  const assigned = new Map<string, string[]>(partitions.map((p) => [p, []]));
  for (const dir of pruned) {
    const owners = partitions
      .filter((p) => p === "" || dir === p || dir.startsWith(`${p}/`))
      .sort((a, b) => depthOf(b) - depthOf(a) || b.length - a.length);
    const owner = owners[0];
    if (owner !== undefined) assigned.get(owner)?.push(dir);
  }
  return assigned;
}

// ---------------------------------------------------------------------------
// Worker return parsing/validation (vendored worker-return.schema.json)
// ---------------------------------------------------------------------------

/**
 * Robust JSON extraction: prefer a fenced ```json (or plain ```) block, then
 * the span from the first `{` to the last `}`. Returns undefined on failure.
 */
export function extractJson(text: string): unknown | undefined {
  const candidates: string[] = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1]);
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate shape.
    }
  }
  return undefined;
}

/**
 * Validate a parsed worker return against the vendored schema semantics:
 * object with a `subtree_index` array; each item requires `path` and
 * `summary` strings; optional `interface`/`invariants`/`side_effects` string
 * arrays. Nothing is coerced; wrong types are rejected.
 */
export function validateSubtreeIndex(parsed: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, errors: ["worker return must be a JSON object"] };
  }
  const index = (parsed as Record<string, unknown>).subtree_index;
  if (!Array.isArray(index)) {
    return { ok: false, errors: ["subtree_index must be an array"] };
  }
  index.forEach((item, i) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      errors.push(`subtree_index[${i}] must be an object`);
      return;
    }
    const entry = item as Record<string, unknown>;
    if (typeof entry.path !== "string") errors.push(`subtree_index[${i}].path must be a string`);
    if (typeof entry.summary !== "string") errors.push(`subtree_index[${i}].summary must be a string`);
    for (const key of ["interface", "invariants", "side_effects"] as const) {
      const value = entry[key];
      if (value === undefined) continue;
      if (!Array.isArray(value)) {
        errors.push(`subtree_index[${i}].${key} must be an array of strings`);
      } else if (value.some((v) => typeof v !== "string")) {
        errors.push(`subtree_index[${i}].${key} must contain only strings`);
      }
    }
  });
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Roll-up helpers
// ---------------------------------------------------------------------------

interface SubtreeEntry {
  path: string; // relative to the target root
  summary: string;
  interface: string[];
  invariants: string[];
  side_effects: string[];
  intermediate: boolean; // orchestrator-written blueprint (not worker Peanut output)
}

const PLACEHOLDER_SUMMARY = "(Documentation failed / Subagent execution timeout)";

function normalizeRelPath(raw: string, targetRoot: string): string {
  let candidate = raw.trim();
  if (path.isAbsolute(candidate)) {
    const resolved = path.resolve(candidate);
    return path.relative(targetRoot, resolved).split(path.sep).join("/");
  }
  candidate = candidate.replace(/^\.\//, "").replace(/\/+$/, "");
  return candidate;
}

function parentOf(relPath: string): string {
  const idx = relPath.lastIndexOf("/");
  return idx === -1 ? "" : relPath.slice(0, idx);
}

function basenameOf(relPath: string): string {
  return relPath.split("/").pop() ?? relPath;
}

/** Directories strictly between the root and the partition roots. */
function intermediateDirs(pruned: string[], partitions: string[]): string[] {
  return pruned.filter(
    (d) =>
      d !== "" &&
      !partitions.includes(d) &&
      partitions.some((p) => p.startsWith(`${d}/`)),
  );
}

/** Deterministic Intermediate Blueprint content (upstream Step 5 pass 2). */
function renderIntermediateBlueprint(
  dirRel: string,
  children: string[],
  entries: Map<string, SubtreeEntry>,
  targetFilename: string,
  targetRoot: string,
): string {
  const title = dirRel === "" ? basenameOf(path.resolve(targetRoot)) : basenameOf(dirRel);
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push("");
  lines.push("## Overview");
  lines.push(`Contract index for ${dirRel === "" ? "the repository root" : `\`${dirRel}\``}, rolled up from its documented subdirectories.`);
  lines.push("");
  for (const child of children) {
    const entry = entries.get(child);
    if (entry) lines.push(`- ${entry.summary}`);
  }
  lines.push("");
  lines.push("## Subdirectories & Boundaries");
  lines.push("");
  for (const child of children) {
    const entry = entries.get(child);
    const summary = entry?.summary ?? PLACEHOLDER_SUMMARY;
    const contractFile = path.join(targetRoot, child, targetFilename);
    if (existsSync(contractFile)) {
      lines.push(`- ${basenameOf(child)}: [${basenameOf(child)}/${targetFilename}](./${basenameOf(child)}/${targetFilename}) - ${summary}`);
    } else {
      lines.push(`- ${basenameOf(child)}: ${summary}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Final verification pass (upstream Step 5 pass 4, deterministic)
// ---------------------------------------------------------------------------

const README_LINK_RE = /\[[^\]]*\]\(([^)\s]+)\)/g;

function isPeanutDir(targetRoot: string, dirRel: string, discovered: DiscoveredTree): boolean {
  return dirHasProductionSource(discovered.dirs.get(dirRel) ?? []);
}

function sectionBody(content: string, headingRe: RegExp): string | null {
  const lines = content.split(/\r?\n/);
  let capture: string[] | null = null;
  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      if (capture) return capture.join("\n").trim();
      capture = headingRe.test(heading[1]) ? [] : null;
    } else if (capture) {
      capture.push(line);
    }
  }
  return capture ? capture.join("\n").trim() : null;
}

/**
 * Deterministic upstream-mandated final verification over every contract file
 * written or corrected: required sections non-empty, all relative markdown
 * link targets exist on disk, and Verification sections mention the discovered
 * command (when one was found).
 */
export function verifyContractFiles(
  contractFiles: string[],
  targetRoot: string,
  discovered: DiscoveredTree,
  verificationCommand: string,
): string[] {
  const violations: string[] = [];
  for (const file of contractFiles) {
    const dirRel = path.relative(targetRoot, path.dirname(file)).split(path.sep).join("/");
    const relName = path.relative(targetRoot, file).split(path.sep).join("/");
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      violations.push(`${relName}: contract file is missing (worker reported it but it does not exist)`);
      continue;
    }
    if (content.trim().length === 0) {
      violations.push(`${relName}: contract file is empty`);
      continue;
    }
    const peanut = isPeanutDir(targetRoot, dirRel, discovered);
    if (peanut) {
      for (const heading of ["Interface", "Invariants", "Side Effects"]) {
        const body = sectionBody(content, new RegExp(`^${heading}$`, "i"));
        if (body === null) {
          violations.push(`${relName}: missing ${heading} section`);
        } else if (body.length === 0) {
          violations.push(`${relName}: ${heading} section is empty`);
        }
      }
      const verification = sectionBody(content, /^verification$/i);
      if (verification === null) {
        violations.push(`${relName}: missing Verification section`);
      } else if (verificationCommand !== "<test-command>" && !verification.includes(verificationCommand)) {
        violations.push(`${relName}: Verification section does not mention "${verificationCommand}"`);
      }
    } else {
      const overview = sectionBody(content, /^overview$|^system overview$/i);
      if (overview === null || overview.length === 0) {
        violations.push(`${relName}: blueprint missing a non-empty Overview section`);
      }
      const subdirs = sectionBody(content, /^subdirectories(\s*&\s*(boundaries|system boundaries))?$/i);
      if (subdirs === null || subdirs.length === 0) {
        violations.push(`${relName}: blueprint missing a non-empty Subdirectories section`);
      }
    }
    // Relative link resolution (upstream "Valid & Resolvable Links").
    for (const match of content.matchAll(README_LINK_RE)) {
      const target = match[1];
      if (
        target.startsWith("http://") ||
        target.startsWith("https://") ||
        target.startsWith("#") ||
        target.startsWith("mailto:") ||
        target.startsWith("/") ||
        target.includes("${")
      ) {
        continue;
      }
      const withoutFragment = target.split("#")[0];
      if (!withoutFragment) continue;
      const resolved = path.resolve(path.dirname(file), decodeURIComponent(withoutFragment));
      let exists = false;
      try {
        exists = statSync(resolved).isFile() || statSync(resolved).isDirectory();
      } catch {
        exists = false;
      }
      if (!exists) {
        violations.push(`${relName}: broken relative link "${target}"`);
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

const RETRY_SUFFIX =
  "\n\nIMPORTANT: Your previous reply was not valid JSON. Your FINAL message must be ONLY the JSON object, no prose, no code fences.";

const BootstrapParams = Type.Object({
  path: Type.String({
    description: "The target root directory to bootstrap (absolute, or relative to the workspace root).",
  }),
  targetFilename: Type.Optional(
    Type.String({
      description: 'Contract filename to generate or correct (default "README.md").',
    }),
  ),
  approved: Type.Optional(
    Type.Boolean({
      description:
        "Set true only when re-calling after the user explicitly approved full-tree bootstrapping at the safety gate.",
    }),
  ),
});

interface WorkerOutcome {
  partition: string;
  status: "ok" | "failed";
  attempts: number;
  childStatus: WorkerChildResult["status"];
  entries: SubtreeEntry[];
  errors: string[];
  stderrTail?: string;
  errorMessage?: string;
}

function buildWorkerPrompt(options: {
  partitionDisplay: string;
  assignedDirs: { path: string; files: string[] }[];
  targetFilename: string;
  verificationCommand: string;
}): string {
  return [
    "You are an EGM bootstrap sub-orchestrator worker. " +
      `First read your orchestrator persona at ${path.join(PACKAGE_ROOT, "agents", "bootstrap_orchestrator.md")} ` +
      `and the skill instructions at ${path.join(PACKAGE_ROOT, "skills", "egm-bootstrap", "SKILL.md")} — ` +
      "follow Step 4 (Sub-Orchestrator Worker Flow) including the scout steps run INLINE (you cannot spawn subagents: read files yourself, " +
      "honor the 50000-byte/300-line caps, the file priority order, and test-file filtering), " +
      `the Correction & Modification Policy for existing ${options.targetFilename} files, ` +
      "the Parent Context Propagation heuristics, and the Templates section. " +
      `Process the subtree ${options.partitionDisplay} bottom-up (deepest first), writing or correcting ${options.targetFilename} in every processed ` +
      "directory using your write/edit tools. Relative links only to files that will exist; link existing non-contract assets directly. " +
      `Discovery data from the orchestrator: pruned directory list ${JSON.stringify(options.assignedDirs)}; ` +
      `verification command ${options.verificationCommand}. ` +
      "When done, your FINAL message must be ONLY a JSON object matching " +
      `${path.join(PACKAGE_ROOT, "skills", "egm-bootstrap", "references", "worker-return.schema.json")} ` +
      "with subtree_index entries (path, summary, interface, invariants, side_effects) for every processed directory.",
  ].join("\n");
}

function buildRootCompilerPrompt(options: {
  targetRoot: string;
  targetFilename: string;
  verificationCommand: string;
  payload: SubtreeEntry[];
}): string {
  return [
    "You are an EGM bootstrap root compiler. " +
      `First read the orchestrator persona at ${path.join(PACKAGE_ROOT, "agents", "bootstrap_orchestrator.md")} ` +
      `and the skill instructions at ${path.join(PACKAGE_ROOT, "skills", "egm-bootstrap", "SKILL.md")} — ` +
      "apply the Templates section (Repository Root Blueprint template) and the Correction & Modification Policy: " +
      `if ${path.join(options.targetRoot, options.targetFilename)} already exists, read it first and preserve its existing title, metadata, ` +
      "and architectural overview at the top while correcting the rest to be EGM compliant. " +
      "Classify the root directory as a Repository Blueprint (Hay). " +
      `Here are the merged worker payloads (JSON): ${JSON.stringify({ subtree_index: options.payload.map(({ intermediate, ...rest }) => ({ ...rest })) })}. ` +
      "Roll up the top-level subdirectory boundaries; use relative links only to contract files that actually exist on disk. " +
      `Verification command: ${options.verificationCommand}. ` +
      `Write ${path.join(options.targetRoot, options.targetFilename)} with your write/edit tools. ` +
      'When done, your FINAL message must be ONLY the JSON object {"root_written": true, "path": "..."} — no prose, no code fences.',
  ].join("\n");
}

function rootReturnOk(parsed: unknown): boolean {
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    (parsed as Record<string, unknown>).root_written === true
  );
}

/**
 * Register the `egm_bootstrap` tool: discovery, safety gate, partitioning,
 * parallel read-write worker children with one JSON-return retry each,
 * deterministic intermediate blueprints, one root-compiler child, and the
 * mandatory final verification pass with an artifact-dir report.
 */
export function registerBootstrapTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "egm_bootstrap",
    label: "EGM Bootstrap",
    description:
      "Recursively bootstrap EGM contract READMEs across a directory subtree: BFS discovery, the >15-directory safety gate, bottom-up pruning, adaptive partitioning, parallel read-write worker subprocesses, JSON return validation, intermediate/root roll-up, and a mandatory final verification pass. Returns the report path, written-file count, and verification violations. Asks for explicit user approval through egm_ask before bootstrapping more than 15 directories.",
    parameters: BootstrapParams,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const workspaceRoot = ctx.cwd;
      const piBinary = findPiBinary();
      if (!piBinary) {
        throw new Error(PI_UNAVAILABLE_GUIDANCE);
      }
      signal?.throwIfAborted();

      const targetRoot = path.isAbsolute(params.path)
        ? path.resolve(params.path)
        : path.resolve(workspaceRoot, params.path);
      const targetFilename = params.targetFilename ?? "README.md";

      // Step 2: discovery + bottom-up pruning (pure functions).
      const discovered = discoverTree(targetRoot);
      const pruned = pruneTree(discovered);

      // Safety gate (CRITICAL): >15 pruned directories needs explicit approval.
      if (pruned.length > 15 && params.approved !== true) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                `SAFETY GATE: ${pruned.length} directories exceed the 15-directory limit. ` +
                "Ask the user for approval using the egm_ask tool with question " +
                '"The target directory tree contains more than 15 subdirectories. This is a large execution scope. Do you want to proceed with full-tree bootstrapping?" ' +
                'and options ["Yes, proceed with full tree bootstrapping", "No, abort execution"]; ' +
                "then re-call egm_bootstrap with approved:true (or stop if declined).",
            },
          ],
          details: { gate: true, directoryCount: pruned.length },
        };
      }

      const verificationCommand = detectVerificationCommand(targetRoot, discovered.manifests);
      const partitions = partitionTree(pruned);
      const assignments = assignPartitionDirs(partitions, pruned);
      const timeoutMs = getBootstrapTimeoutMs();
      const concurrency = getBootstrapMaxConcurrent();

      // Step 3/4: one worker child per partition (root-acts-as-worker included).
      const outcomes = await runPool(partitions, concurrency, async (partition, poolSignal) => {
        const assignedDirs = (assignments.get(partition) ?? []).map((dir) => ({
          path: dir,
          files: (discovered.dirs.get(dir) ?? []).slice(0, 20),
        }));
        const prompt = buildWorkerPrompt({
          partitionDisplay: partition === "" ? "." : partition,
          assignedDirs,
          targetFilename,
          verificationCommand,
        });

        let attempts = 0;
        let child = await runWorkerChild(prompt, targetRoot, timeoutMs, poolSignal);
        attempts++;
        let parsed = extractJson(child.stdout);
        let check =
          parsed !== undefined
            ? validateSubtreeIndex(parsed)
            : { ok: false, errors: ["no JSON object found in worker output"] };
        if (child.status === "ok" && check.ok) {
          return { partition, status: "ok" as const, attempts, childStatus: child.status, entries: buildEntries(parsed, targetRoot), errors: [], stderrTail: child.stderrTail };
        }

        // Upstream fault tolerance: exactly one JSON-shape retry.
        child = await runWorkerChild(prompt + RETRY_SUFFIX, targetRoot, timeoutMs, poolSignal);
        attempts++;
        parsed = extractJson(child.stdout);
        check =
          parsed !== undefined
            ? validateSubtreeIndex(parsed)
            : { ok: false, errors: ["no JSON object found in worker output"] };
        if (child.status === "ok" && check.ok) {
          return { partition, status: "ok" as const, attempts, childStatus: child.status, entries: buildEntries(parsed, targetRoot), errors: [], stderrTail: child.stderrTail };
        }
        return {
          partition,
          status: "failed" as const,
          attempts,
          childStatus: child.status,
          entries: [],
          errors: check.errors.slice(0, 5),
          stderrTail: child.stderrTail,
          errorMessage: child.errorMessage,
        };
      }, signal);
      signal?.throwIfAborted();

      // Merge payloads; placeholders for failed partitions (upstream tolerance).
      const entries = new Map<string, SubtreeEntry>();
      for (const outcome of outcomes) {
        for (const entry of outcome.entries) entries.set(entry.path, entry);
      }
      for (const outcome of outcomes) {
        if (outcome.status !== "failed") continue;
        for (const dir of assignments.get(outcome.partition) ?? []) {
          if (!entries.has(dir)) {
            entries.set(dir, {
              path: dir,
              summary: PLACEHOLDER_SUMMARY,
              interface: ["(Details pending/documentation failed)"],
              invariants: [],
              side_effects: [],
              intermediate: false,
            });
          }
        }
      }

      // Step 5 pass 2: deterministic intermediate blueprints, bottom-up.
      const intermediates = intermediateDirs(pruned, partitions).sort(
        (a, b) => b.split("/").length - a.split("/").length,
      );
      const orchestratorWritten: string[] = [];
      for (const dir of intermediates) {
        const children = pruned.filter((d) => parentOf(d) === dir);
        const markdown = renderIntermediateBlueprint(dir, children, entries, targetFilename, targetRoot);
        await mkdir(path.join(targetRoot, dir), { recursive: true });
        await writeFileAsync(path.join(targetRoot, dir, targetFilename), markdown, "utf8");
        orchestratorWritten.push(dir);
        entries.set(dir, {
          path: dir,
          summary: `Intermediate blueprint rolling up ${children.length} documented subdirectories.`,
          interface: [],
          invariants: [],
          side_effects: [],
          intermediate: true,
        });
      }

      // Step 5 pass 3: one root-compiler child (retry once, continue on failure).
      let rootStatus: "ok" | "failed" = "failed";
      let rootAttempts = 0;
      let rootError: string | undefined;
      const rootPrompt = buildRootCompilerPrompt({
        targetRoot,
        targetFilename,
        verificationCommand,
        payload: [...entries.values()],
      });
      const existingRootFile = path.join(targetRoot, targetFilename);
      let rootChild = await runWorkerChild(rootPrompt, targetRoot, timeoutMs, signal);
      rootAttempts++;
      let rootParsed = extractJson(rootChild.stdout);
      if (!(rootChild.status === "ok" && rootReturnOk(rootParsed))) {
        rootChild = await runWorkerChild(rootPrompt + RETRY_SUFFIX, targetRoot, timeoutMs, signal);
        rootAttempts++;
        rootParsed = extractJson(rootChild.stdout);
      }
      if (rootChild.status === "ok" && rootReturnOk(rootParsed)) {
        rootStatus = "ok";
      } else {
        rootError =
          rootChild.errorMessage ??
          (rootParsed === undefined
            ? "root compiler returned no JSON object"
            : "root compiler returned unexpected JSON (expected {\"root_written\": true})");
      }

      // Step 5 pass 4: mandatory deterministic final verification.
      const contractDirs = new Set<string>([...entries.keys()]);
      if (rootStatus === "ok") contractDirs.add("");
      const contractFiles = [...contractDirs]
        .map((dir) => path.join(targetRoot, dir, targetFilename))
        .filter((file) => existsSync(file));
      const violations = verifyContractFiles(
        contractFiles,
        targetRoot,
        discovered,
        verificationCommand,
      );

      // Artifact report (artifact-first: result carries path + summary only).
      const artifactDir = resolveArtifactDir(workspaceRoot);
      const reportPath = path.join(artifactDir, "bootstrap_report.md");
      const failedWorkers = outcomes.filter((o) => o.status === "failed");
      const reportLines: string[] = [];
      reportLines.push("# EGM Bootstrap Report");
      reportLines.push("");
      reportLines.push(`- Target: ${targetRoot}`);
      reportLines.push(`- Date: ${new Date().toISOString()}`);
      reportLines.push(`- Contract filename: ${targetFilename}`);
      reportLines.push(`- Directories discovered: ${discovered.dirs.size - 1}; pruned: ${pruned.length}`);
      reportLines.push(`- Verification command: ${verificationCommand}`);
      reportLines.push(`- Partitions: ${partitions.map((p) => (p === "" ? "." : p)).join(", ")}`);
      reportLines.push(`- Files written/corrected: ${contractFiles.length} across ${contractDirs.size} directories`);
      reportLines.push("");
      reportLines.push("## Workers");
      reportLines.push("");
      for (const outcome of outcomes) {
        reportLines.push(
          `- ${outcome.partition === "" ? "." : outcome.partition}: ${outcome.status} after ${outcome.attempts} attempt(s) (child: ${outcome.childStatus}); ${outcome.entries.length} entries`,
        );
        if (outcome.errors.length > 0) reportLines.push(`  - validation errors: ${outcome.errors.join("; ")}`);
        if (outcome.errorMessage) reportLines.push(`  - error: ${outcome.errorMessage}`);
        if (outcome.stderrTail) reportLines.push(`  - stderr tail: ${outcome.stderrTail.replace(/\s+/g, " ")}`);
      }
      reportLines.push(`- Root compiler: ${rootStatus} after ${rootAttempts} attempt(s)${rootError ? ` — ${rootError}` : ""}`);
      reportLines.push(`- Intermediate blueprints written by orchestrator: ${orchestratorWritten.length > 0 ? orchestratorWritten.join(", ") : "none"}`);
      reportLines.push("");
      reportLines.push("## Verification Violations");
      reportLines.push("");
      if (violations.length === 0) {
        reportLines.push("None.");
      } else {
        for (const violation of violations) reportLines.push(`- ${violation}`);
      }
      reportLines.push("");
      await writeFileAsync(reportPath, reportLines.join("\n"), "utf8");

      const contentLines = [
        `Bootstrap complete: ${contractFiles.length} contract files written/corrected in ${contractDirs.size} directories; verification: ${violations.length} violations (report: ${reportPath})`,
      ];
      for (const violation of violations.slice(0, 5)) contentLines.push(`- ${violation}`);
      if (failedWorkers.length > 0) {
        contentLines.push(
          `Workers failed (placeholder entries inserted): ${failedWorkers.map((o) => o.partition).join(", ")}`,
        );
      }
      if (rootStatus === "failed") contentLines.push(`Root blueprint failed: ${rootError}`);

      return {
        content: [{ type: "text" as const, text: contentLines.join("\n") }],
        details: {
          reportPath,
          filesWritten: contractFiles.length,
          violations,
        },
      };
    },
  });
}

/** Normalize + validate-checked worker payload entries into SubtreeEntry values. */
function buildEntries(parsed: unknown, targetRoot: string): SubtreeEntry[] {
  const out: SubtreeEntry[] = [];
  const index = (parsed as { subtree_index?: unknown[] }).subtree_index ?? [];
  for (const raw of index as Record<string, unknown>[]) {
    const rel = normalizeRelPath(String(raw.path), targetRoot);
    const strings = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
    out.push({
      path: rel,
      summary: String(raw.summary),
      interface: strings(raw.interface),
      invariants: strings(raw.invariants),
      side_effects: strings(raw.side_effects),
      intermediate: false,
    });
  }
  return out;
}
