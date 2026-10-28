/**
 * EGM persona and document-standard resolution.
 *
 * The package root is derived from this module's location
 * (<package>/extensions/lib/paths.ts -> <package>), so vendored agents/ and
 * resources/ trees resolve no matter where the package is installed.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path of the pi-elephant-goldfish package root (extensions/lib/../..). */
export const PACKAGE_ROOT: string = path.resolve(thisDir, "..", "..");

export interface ResolvedResource {
  /** Absolute path of the resolved file. */
  absolutePath: string;
  /** Canonical shortname (alias table first entry, or file basename for paths). */
  canonicalName: string;
}

interface AliasEntry {
  canonical: string;
  file: string;
  aliases: string[];
}

const PERSONA_TABLE: AliasEntry[] = [
  { canonical: "zoom_out", file: "agents/zoom_out.md", aliases: ["zoom_out", "egm-zoom-out"] },
  { canonical: "comprehension", file: "agents/comprehension.md", aliases: ["comprehension", "egm-comprehension"] },
  { canonical: "design_critic", file: "agents/design_critic.md", aliases: ["design_critic", "egm-design"] },
  {
    canonical: "implementation_readiness",
    file: "agents/implementation_readiness.md",
    aliases: ["implementation_readiness", "egm-implementation-readiness"],
  },
  { canonical: "structural", file: "agents/structural.md", aliases: ["structural", "egm-structural"] },
  { canonical: "style", file: "agents/style.md", aliases: ["style", "egm-style"] },
  {
    canonical: "codebase_details",
    file: "agents/codebase_details.md",
    aliases: ["codebase_details", "egm-codebase-details"],
  },
];

const STANDARD_TABLE: AliasEntry[] = [
  {
    canonical: "feature-spec-standard",
    file: "resources/document_standards/feature-spec-standard.md",
    aliases: ["feature-spec-standard", "feature-spec-standard.md"],
  },
  {
    canonical: "heilmeier-standard",
    file: "resources/document_standards/heilmeier-standard.md",
    aliases: ["heilmeier-standard", "heilmeier-standard.md"],
  },
  {
    canonical: "implementation-readiness-standard",
    file: "resources/document_standards/implementation-readiness-standard.md",
    aliases: ["implementation-readiness-standard", "implementation-readiness-standard.md"],
  },
  {
    canonical: "re-implementation-standard",
    file: "resources/document_standards/re-implementation-standard.md",
    aliases: ["re-implementation-standard", "re-implementation-standard.md"],
  },
  {
    canonical: "zoom-out-standard",
    file: "resources/document_standards/zoom-out-standard.md",
    aliases: ["zoom-out-standard", "zoom-out-standard.md"],
  },
];

/**
 * Roles a caller might pass as reviewers that must never resolve to a file.
 * Keyed by every accepted spelling; values are the instructive error text.
 */
const REJECTED_REVIEWER_ROLES: Record<string, string> = {
  synthesizer:
    'Invalid reviewer "synthesizer": the synthesizer role is built into egm_goldfish (it fans reviewers out and consolidates); do not pass it as a reviewer.',
  "egm-synthesizer":
    'Invalid reviewer "egm-synthesizer": the synthesizer role is built into egm_goldfish (it fans reviewers out and consolidates); do not pass it as a reviewer.',
  bootstrap_orchestrator:
    'Invalid reviewer "bootstrap_orchestrator": bootstrap workers are not supported by egm_goldfish; use the egm-bootstrap skill.',
  "egm-bootstrap-orchestrator":
    'Invalid reviewer "egm-bootstrap-orchestrator": bootstrap workers are not supported by egm_goldfish; use the egm-bootstrap skill.',
};

/** Canonical name for a free-form file path: basename without extension. */
function canonicalFromPath(filePath: string): string {
  const base = path.basename(filePath);
  return base.replace(/\.(md|markdown)$/i, "");
}

function resolveFromTable(
  name: string,
  table: AliasEntry[],
  kind: "persona" | "standard",
): ResolvedResource {
  const entry = table.find((e) => e.aliases.includes(name) || e.aliases.includes(name.toLowerCase()));
  if (!entry) {
    const known = table.map((e) => e.canonical).join(", ");
    throw new Error(`Unknown ${kind} "${name}". Valid shortnames: ${known}. Alternatively pass a file path (absolute, or relative to the workspace root).`);
  }
  const absolutePath = path.isAbsolute(entry.file) ? entry.file : path.join(PACKAGE_ROOT, entry.file);
  if (!existsSync(absolutePath)) {
    throw new Error(`Vendored ${kind} file missing for "${name}": ${absolutePath}`);
  }
  return { absolutePath, canonicalName: entry.canonical };
}

/**
 * Resolve a reviewer persona name to its vendored file.
 *
 * Accepts all aliases (the first alias of each table row is the canonical
 * shortname) and free-form paths (absolute, or resolved against the workspace
 * root) when the name contains "/". Explicitly rejects the synthesizer and
 * bootstrap_orchestrator roles with instructive errors.
 */
export function resolvePersona(name: string, workspaceRoot: string = process.cwd()): ResolvedResource {
  const rejection = REJECTED_REVIEWER_ROLES[name] ?? REJECTED_REVIEWER_ROLES[name.toLowerCase()];
  if (rejection) {
    throw new Error(rejection);
  }
  if (name.includes("/")) {
    const absolutePath = path.isAbsolute(name) ? name : path.resolve(workspaceRoot, name);
    if (!existsSync(absolutePath)) {
      throw new Error(`Reviewer persona file not found: ${absolutePath}`);
    }
    return { absolutePath, canonicalName: canonicalFromPath(absolutePath) };
  }
  return resolveFromTable(name, PERSONA_TABLE, "persona");
}

/**
 * Resolve a document-standard name to its vendored file under
 * resources/document_standards/. Accepts canonical shortnames (filename
 * without .md), the filename itself, and free-form paths (absolute, or
 * resolved against the workspace root) when the name contains "/".
 */
export function resolveStandard(name: string, workspaceRoot: string = process.cwd()): ResolvedResource {
  if (name.includes("/")) {
    const absolutePath = path.isAbsolute(name) ? name : path.resolve(workspaceRoot, name);
    if (!existsSync(absolutePath)) {
      throw new Error(`Document standard file not found: ${absolutePath}`);
    }
    return { absolutePath, canonicalName: canonicalFromPath(absolutePath) };
  }
  return resolveFromTable(name, STANDARD_TABLE, "standard");
}
