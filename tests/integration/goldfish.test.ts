/**
 * Integration test: one real zero-context Goldfish reviewer, end to end.
 *
 * Spawns `pi -e . --print` (dev install of this package) with a prompt that
 * drives the egm_goldfish tool: a single zoom_out reviewer over the read-only
 * fixture scripts/fixtures/sample-design.md, with the report written into a
 * temp artifact directory (EGM_ARTIFACT_DIR). Asserts exit 0 and that the
 * report file exists and contains at least one `Severity:` line.
 *
 * Env-gated: SKIPPED unless EGM_E2E is set (uses the account's model quota and
 * takes minutes of wall time).
 *
 *   EGM_E2E=1 npx vitest run tests/integration
 *
 * NOTE ON COVERAGE: the full upstream-bar end-to-end (interactive brainstorm →
 * draft → review through an actual `pi install` of this package) is recorded
 * MANUALLY in TESTING.md, not automated here.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GOLDFISH_TIMEOUT_MS = 600_000;

const PROMPT = [
  "Call the egm_goldfish tool exactly once with these parameters:",
  'reviewers: ["zoom_out"]',
  'targetFile: "scripts/fixtures/sample-design.md"',
  'outputFileName: "integration-zoom-out-report.md"',
  "Do not pass standards, range, or goldfishContext. When the tool returns,",
  "reply with only the report file path it returned.",
].join(" ");

describe.skipIf(!process.env.EGM_E2E)("real Goldfish reviewer (env-gated: EGM_E2E)", () => {
  it(
    "zoom_out over the sample-design fixture produces a report with at least one Severity line",
    () => {
      const artifactDir = mkdtempSync(path.join(os.tmpdir(), "egm-e2e-artifacts-"));
      try {
        let stdout = "";
        try {
          stdout = execFileSync("pi", ["-e", ".", "--print", PROMPT], {
            cwd: REPO_ROOT,
            encoding: "utf8",
            timeout: GOLDFISH_TIMEOUT_MS,
            env: { ...process.env, EGM_ARTIFACT_DIR: artifactDir },
            stdio: ["ignore", "pipe", "pipe"],
          });
        } catch (error) {
          const err = error as { status?: number; stdout?: string; stderr?: string };
          throw new Error(
            `pi --print exited with status ${err.status}\nstdout: ${stdout || err.stdout}\nstderr: ${err.stderr}`,
          );
        }
        expect(stdout.trim()).toBeTruthy();

        const reports = readdirSync(artifactDir).filter((f) => f.endsWith(".md"));
        expect(reports, `no report written to ${artifactDir}`).toHaveLength(1);
        const report = readFileSync(path.join(artifactDir, reports[0]), "utf8");
        expect(report).toContain("Goldfish Review Report");
        expect(report).toMatch(/Severity:\s*(Blocker|Major|Nit)/);
      } finally {
        rmSync(artifactDir, { recursive: true, force: true });
      }
    },
    GOLDFISH_TIMEOUT_MS + 30_000,
  );
});
