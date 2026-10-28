/**
 * Content checks for vendored EGM assets — vitest port of the relevant
 * upstream unit suites (mirrors intent and thresholds; runs fully local):
 *
 * - tests/unit/test_frontmatter.py: every SKILL.md and agents/*.md carries
 *   valid YAML frontmatter with non-empty `name` and `description`.
 * - tests/unit/test_skill_load_limits.py: SKILL.md bodies stay within the
 *   24,000-byte Antigravity skill body limit (same cap as upstream).
 * - Scenario coverage: persona files referenced by SKILL.md text exist under
 *   agents/, document standards referenced exist under
 *   resources/document_standards/, and the vendored inventory (9 personas,
 *   5 standards) matches the upstream clone when present.
 * - Every skill keeps a co-located test_scenarios.yaml (upstream
 *   test_scenario_coverage.py intent, light structural mirror — this port has
 *   no YAML dependency, so the check is line-based).
 * - Description length <= 1024 chars (Agent Skills spec limit).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const UPSTREAM_ROOT = "/home/nicolas/projects/elephant-goldfish-model";
const upstreamCloneExists = existsSync(path.join(UPSTREAM_ROOT, "agents"));

const SKILLS_DIR = path.join(REPO_ROOT, "skills");
const AGENTS_DIR = path.join(REPO_ROOT, "agents");
const STANDARDS_DIR = path.join(REPO_ROOT, "resources", "document_standards");

/** Upstream Antigravity skill body limit (test_skill_load_limits.py). */
const SKILL_BODY_LIMIT_BYTES = 24_000;
/** Agent Skills spec: description must be at most 1024 characters. */
const DESCRIPTION_LIMIT_CHARS = 1024;

function skillDirs(): string[] {
  return readdirSync(SKILLS_DIR).filter((d) => !d.startsWith("."));
}

function skillFiles(): string[] {
  return skillDirs().map((d) => path.join(SKILLS_DIR, d, "SKILL.md"));
}

function agentFiles(): string[] {
  return readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => path.join(AGENTS_DIR, f));
}

interface Frontmatter {
  [key: string]: string;
}

/**
 * Minimal frontmatter reader mirroring upstream test_frontmatter.py's
 * `---`-fence extraction plus the plain-scalar/block-scalar value shapes the
 * vendored files actually use (same approach as scripts/check-content.mjs).
 */
function readFrontmatter(file: string): Frontmatter {
  const content = readFileSync(file, "utf8");
  const lines = content.split(/\r?\n/);
  if (!lines.length || lines[0].trim() !== "---") {
    throw new Error(`no leading '---' frontmatter fence in ${file}`);
  }
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) {
    throw new Error(`no closing '---' frontmatter fence in ${file}`);
  }
  const block = lines.slice(1, endIdx);
  const data: Frontmatter = {};
  let i = 0;
  while (i < block.length) {
    const m = block[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1];
    let value = m[2].trim();
    if (value === "" || /^[>|][+-]?\d*$/.test(value)) {
      const rest: string[] = [];
      i++;
      while (i < block.length && (block[i].startsWith(" ") || block[i].startsWith("\t") || block[i].trim() === "")) {
        rest.push(block[i].trim());
        i++;
      }
      value = rest.join(" ").trim();
    } else {
      value = value.replace(/^["']|["']$/g, "");
      i++;
    }
    data[key] = value;
  }
  return data;
}

describe("frontmatter (upstream test_frontmatter.py intent)", () => {
  const files = [...skillFiles(), ...agentFiles()];

  it("discovers the vendored inventory (7 skills, 9 agent personas)", () => {
    expect(skillDirs()).toHaveLength(7);
    expect(agentFiles()).toHaveLength(9);
    for (const file of files) {
      expect(existsSync(file), file).toBe(true);
    }
  });

  it("every SKILL.md and agents/*.md has name + description frontmatter", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const rel = path.relative(REPO_ROOT, file);
      const fm = readFrontmatter(file);
      expect(fm.name, rel).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(fm.description?.trim(), rel).toBeTruthy();
    }
  });

  it("every SKILL.md sets disable-model-invocation: true", () => {
    for (const file of skillFiles()) {
      const fm = readFrontmatter(file);
      expect(fm["disable-model-invocation"], path.relative(REPO_ROOT, file)).toBe("true");
    }
  });

  it("descriptions stay within the 1024-char Agent Skills limit", () => {
    for (const file of files) {
      const fm = readFrontmatter(file);
      expect(
        fm.description.length,
        `${path.relative(REPO_ROOT, file)} description length`,
      ).toBeLessThanOrEqual(DESCRIPTION_LIMIT_CHARS);
    }
  });
});

describe("skill load limits (upstream test_skill_load_limits.py intent)", () => {
  // Upstream caps the SKILL.md *body* (everything after the closing '---'
  // fence) at 24,000 bytes: Antigravity's skill body load limit. Mirrored with
  // the same cap and the same body extraction (split on the first two '---').
  it.each(skillFiles())("%s body fits the 24000-byte limit", (file) => {
    const content = readFileSync(file, "utf8");
    const parts = content.split("---");
    const body = parts.slice(2).join("---").trim();
    const size = Buffer.byteLength(body, "utf8");
    expect(
      size,
      `${path.relative(REPO_ROOT, file)}: ${size} bytes exceeds the 24000-byte skill body limit; move details into an explicitly read reference`,
    ).toBeLessThanOrEqual(SKILL_BODY_LIMIT_BYTES);
  });
});

describe("scenario coverage", () => {
  it("every persona referenced by any SKILL.md exists in agents/", () => {
    const pattern = /\bagents\/([A-Za-z0-9_-]+)\.md\b/g;
    for (const file of skillFiles()) {
      const rel = path.relative(REPO_ROOT, file);
      const content = readFileSync(file, "utf8");
      const refs = [...content.matchAll(pattern)].map((m) => m[1]);
      for (const name of refs) {
        expect(
          existsSync(path.join(AGENTS_DIR, `${name}.md`)),
          `${rel} references agents/${name}.md which does not exist`,
        ).toBe(true);
      }
    }
  });

  it("every document standard referenced by any SKILL.md exists in resources/document_standards/", () => {
    const pattern = /\bdocument_standards\/([A-Za-z0-9_-]+)\.md\b/g;
    for (const file of skillFiles()) {
      const rel = path.relative(REPO_ROOT, file);
      const content = readFileSync(file, "utf8");
      const refs = [...content.matchAll(pattern)].map((m) => m[1]);
      for (const name of refs) {
        expect(
          existsSync(path.join(STANDARDS_DIR, `${name}.md`)),
          `${rel} references resources/document_standards/${name}.md which does not exist`,
        ).toBe(true);
      }
    }
  });

  it("every skill keeps a co-located test_scenarios.yaml (upstream test_scenario_coverage.py intent)", () => {
    for (const dir of skillDirs()) {
      const file = path.join(SKILLS_DIR, dir, "test_scenarios.yaml");
      expect(existsSync(file), `missing test_scenarios.yaml in skills/${dir}`).toBe(true);
      const content = readFileSync(file, "utf8");
      expect(content).toMatch(new RegExp(`^skill:\\s*"?${dir}"?\\s*$`, "m"));
      expect(content).toMatch(/^ {2}- scenario_id:/m);
      expect(content).toMatch(/eval_type:/);
      expect(content).toMatch(/turns:/);
    }
  });

  describe.skipIf(!upstreamCloneExists)("inventory parity with the upstream clone", () => {
    it("agents/ and resources/document_standards/ listings match upstream exactly", () => {
      const localAgents = readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md")).sort();
      const upstreamAgents = readdirSync(path.join(UPSTREAM_ROOT, "agents"))
        .filter((f) => f.endsWith(".md"))
        .sort();
      expect(localAgents).toEqual(upstreamAgents);
      expect(localAgents).toHaveLength(9);

      const localStandards = readdirSync(STANDARDS_DIR).filter((f) => f.endsWith(".md")).sort();
      const upstreamStandardsDir = path.join(UPSTREAM_ROOT, "resources", "document_standards");
      if (existsSync(upstreamStandardsDir) && statSync(upstreamStandardsDir).isDirectory()) {
        const upstreamStandards = readdirSync(upstreamStandardsDir)
          .filter((f) => f.endsWith(".md"))
          .sort();
        expect(localStandards).toEqual(upstreamStandards);
        expect(localStandards).toHaveLength(5);
      }
    });
  });
});
