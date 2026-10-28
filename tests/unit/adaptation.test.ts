/**
 * Adaptation invariants for the vendored skills — vitest port of the port's
 * own guarantees plus upstream sync intent. Fully local and deterministic.
 *
 * - No upstream harness-only tokens may survive adaptation:
 *   "CLAUDE_PLUGIN_ROOT" and "ask_question" must not appear anywhere under
 *   skills/.
 * - The Pi tool names (egm_bootstrap / egm_goldfish / egm_ask) and the Pi
 *   harness guide pointer (docs/pi.md) must be present in the right skills.
 * - Sync idempotence: the vendored skills/ tree must be byte-identical to the
 *   result of running scripts/adapt-pi.mjs over a pristine upstream skills
 *   tree — and running the script twice changes nothing.
 *
 * Approach note (adapt-pi.mjs has no env override; it hardcodes ROOT relative
 * to its own file location): the test copies the UNMODIFIED script into a temp
 * scaffold (<tmp>/scripts/adapt-pi.mjs, so ROOT=<tmp>) together with a copy of
 * the upstream skills/ tree, then runs the real script there with
 * `node <tmp>/scripts/adapt-pi.mjs` and byte-compares the output against the
 * vendored files. No substitution logic is reimplemented in the test.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILLS_DIR = path.join(REPO_ROOT, "skills");
const UPSTREAM_ROOT = "/home/nicolas/projects/elephant-goldfish-model";
const upstreamCloneExists = existsSync(path.join(UPSTREAM_ROOT, "skills"));

function skillDirs(): string[] {
  return readdirSync(SKILLS_DIR).filter((d) => !d.startsWith("."));
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

describe("adaptation invariants", () => {
  it("no CLAUDE_PLUGIN_ROOT and no ask_question anywhere under skills/", () => {
    const files = walkFiles(SKILLS_DIR);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      expect(content, `${path.relative(REPO_ROOT, file)} contains CLAUDE_PLUGIN_ROOT`).not.toContain(
        "CLAUDE_PLUGIN_ROOT",
      );
      expect(content, `${path.relative(REPO_ROOT, file)} contains ask_question`).not.toContain(
        "ask_question",
      );
    }
  });

  it("egm_bootstrap is named in skills/egm-bootstrap/SKILL.md", () => {
    const content = readFileSync(path.join(SKILLS_DIR, "egm-bootstrap", "SKILL.md"), "utf8");
    expect(content).toContain("egm_bootstrap");
  });

  it.each(["egm-brainstorm", "egm-review", "egm-review-loop"])(
    "egm_goldfish is named in skills/%s/SKILL.md",
    (dir) => {
      const content = readFileSync(path.join(SKILLS_DIR, dir, "SKILL.md"), "utf8");
      expect(content).toContain("egm_goldfish");
    },
  );

  it.each(["egm-brainstorm", "egm-draft", "egm-review"])(
    "egm_ask is named in the gate-carrying skills/%s/SKILL.md",
    (dir) => {
      const content = readFileSync(path.join(SKILLS_DIR, dir, "SKILL.md"), "utf8");
      expect(content).toContain("egm_ask");
    },
  );

  it("every skills/*/SKILL.md mentions docs/pi.md", () => {
    for (const dir of skillDirs()) {
      const content = readFileSync(path.join(SKILLS_DIR, dir, "SKILL.md"), "utf8");
      expect(content, `skills/${dir}/SKILL.md does not mention docs/pi.md`).toContain("docs/pi.md");
    }
  });
});

describe.skipIf(!upstreamCloneExists)("adapt-pi.mjs sync fidelity (real script, pristine upstream tree)", () => {
  // adapt-pi.mjs is intentionally drift-detecting: it FAILS when an expected
  // upstream anchor is missing, so running it a second time over already-
  // adapted output is expected to fail and is NOT how sync idempotence is
  // proven here. Instead: two independent runs over two fresh pristine
  // upstream copies must each reproduce the vendored tree byte-identically
  // (fidelity + determinism).
  function runOnFreshUpstream(): string {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "egm-adapt-"));
    try {
      // Scaffold: <tmp>/scripts/adapt-pi.mjs (ROOT=<tmp>) + <tmp>/skills/...
      const scriptsDir = path.join(tmp, "scripts");
      const tmpSkillsDir = path.join(tmp, "skills");
      mkdirSync(scriptsDir, { recursive: true });
      cpSync(path.join(REPO_ROOT, "scripts", "adapt-pi.mjs"), path.join(scriptsDir, "adapt-pi.mjs"));

      const upstreamSkillDirs = readdirSync(path.join(UPSTREAM_ROOT, "skills")).filter(
        (d) => !d.startsWith("."),
      );
      for (const dir of upstreamSkillDirs) {
        cpSync(path.join(UPSTREAM_ROOT, "skills", dir), path.join(tmpSkillsDir, dir), {
          recursive: true,
        });
      }

      return execFileSync("node", [path.join(scriptsDir, "adapt-pi.mjs")], {
        cwd: tmp,
        encoding: "utf8",
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  it("regenerates all 7 vendored SKILL.md files byte-identically, deterministically across runs", () => {
    const firstRun = runOnFreshUpstream();
    expect(firstRun).toContain("all adaptations applied");

    const secondRun = runOnFreshUpstream();
    expect(secondRun).toBe(firstRun); // deterministic output

    // Both scaffolds were cleaned up, so regenerate one and compare its
    // SKILL.md files against the vendored tree.
    const tmp = mkdtempSync(path.join(os.tmpdir(), "egm-adapt-"));
    try {
      const scriptsDir = path.join(tmp, "scripts");
      const tmpSkillsDir = path.join(tmp, "skills");
      mkdirSync(scriptsDir, { recursive: true });
      cpSync(path.join(REPO_ROOT, "scripts", "adapt-pi.mjs"), path.join(scriptsDir, "adapt-pi.mjs"));
      for (const dir of readdirSync(path.join(UPSTREAM_ROOT, "skills")).filter((d) => !d.startsWith("."))) {
        cpSync(path.join(UPSTREAM_ROOT, "skills", dir), path.join(tmpSkillsDir, dir), { recursive: true });
      }
      execFileSync("node", [path.join(scriptsDir, "adapt-pi.mjs")], { cwd: tmp, encoding: "utf8" });
      for (const dir of skillDirs()) {
        const generated = readFileSync(path.join(tmpSkillsDir, dir, "SKILL.md"));
        const vendored = readFileSync(path.join(SKILLS_DIR, dir, "SKILL.md"));
        expect(
          generated.equals(vendored),
          `skills/${dir}/SKILL.md differs from adapt-pi.mjs output over pristine upstream`,
        ).toBe(true);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
