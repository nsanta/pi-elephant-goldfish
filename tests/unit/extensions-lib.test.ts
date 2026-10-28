/**
 * Pure-function tests for the extension library modules.
 *
 * - paths.ts (resolvePersona/resolveStandard) and artifact-dir.ts
 *   (resolveArtifactDir) and commands.ts (stripFrontmatter/buildCommandPayload)
 *   import only node builtins at runtime: they run unconditionally.
 * - bootstrap.ts value-imports `typebox`, so its tests are gated with
 *   describe.skipIf(!hostResolved): when the local pi installation cannot be
 *   resolved (see vitest.config.ts), the aliases are unset and importing the
 *   module would fail.
 *
 * Coverage gap (documented, not silent): goldfish.ts's buildChildPrompt and
 * tallySeverities are module-private and extensions/** is outside this test
 * suite's authorized edit surfaces, so they cannot be imported here. They are
 * exercised indirectly by the env-gated integration suite instead.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { hostResolved } from "../helpers/host";

import { PACKAGE_ROOT, resolvePersona, resolveStandard } from "../../extensions/lib/paths.ts";
import { resolveArtifactDir } from "../../extensions/lib/artifact-dir.ts";
import {
  EGM_SKILL_COMMANDS,
  buildCommandPayload,
  stripFrontmatter,
} from "../../extensions/lib/commands.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURES = path.join(REPO_ROOT, "scripts", "fixtures");

// ---------------------------------------------------------------------------
// paths.ts — persona / standard resolution
// ---------------------------------------------------------------------------

describe("resolvePersona", () => {
  const rows: Array<[canonical: string, ...aliases: string[]]> = [
    ["zoom_out", "zoom_out", "egm-zoom-out"],
    ["comprehension", "comprehension", "egm-comprehension"],
    ["design_critic", "design_critic", "egm-design"],
    ["implementation_readiness", "implementation_readiness", "egm-implementation-readiness"],
    ["structural", "structural", "egm-structural"],
    ["style", "style", "egm-style"],
    ["codebase_details", "codebase_details", "egm-codebase-details"],
  ];

  it("resolves all 7 alias-table rows (canonical name + every alias)", () => {
    for (const [canonical, ...aliases] of rows) {
      for (const alias of aliases) {
        const resolved = resolvePersona(alias);
        expect(resolved.canonicalName, `alias ${alias}`).toBe(canonical);
        expect(resolved.absolutePath).toBe(path.join(PACKAGE_ROOT, `agents/${canonical}.md`));
        expect(existsSync(resolved.absolutePath), resolved.absolutePath).toBe(true);
      }
    }
  });

  it("resolves '/'-paths against the workspace root and returns the basename as canonical name", () => {
    const ws = mkdtempSync(path.join(os.tmpdir(), "egm-persona-"));
    try {
      mkdirSync(path.join(ws, "people"), { recursive: true });
      const rel = path.join("people", "my-persona.md");
      writeFileSync(path.join(ws, rel), "# Custom persona\n");
      const byRelative = resolvePersona(rel, ws);
      expect(byRelative.absolutePath).toBe(path.resolve(ws, rel));
      expect(byRelative.canonicalName).toBe("my-persona");

      const abs = path.resolve(ws, rel);
      const byAbsolute = resolvePersona(abs, ws);
      expect(byAbsolute.absolutePath).toBe(abs);
      expect(byAbsolute.canonicalName).toBe("my-persona");
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it("rejects the synthesizer role instructively (both spellings)", () => {
    for (const name of ["synthesizer", "egm-synthesizer"]) {
      expect(() => resolvePersona(name)).toThrow(/do not pass it as a reviewer/);
    }
  });

  it("rejects bootstrap_orchestrator instructively (both spellings)", () => {
    for (const name of ["bootstrap_orchestrator", "egm-bootstrap-orchestrator"]) {
      expect(() => resolvePersona(name)).toThrow(/use the egm-bootstrap skill/);
    }
  });

  it("rejects unknown shortnames with the valid shortname list", () => {
    expect(() => resolvePersona("not_a_persona")).toThrow(/Unknown persona/);
    expect(() => resolvePersona("not_a_persona")).toThrow(/zoom_out/);
  });
});

describe("resolveStandard", () => {
  const standards = [
    "feature-spec-standard",
    "heilmeier-standard",
    "implementation-readiness-standard",
    "re-implementation-standard",
    "zoom-out-standard",
  ];

  it("resolves all 5 canonical names and their .md filename aliases", () => {
    for (const name of standards) {
      const byName = resolveStandard(name);
      expect(byName.canonicalName).toBe(name);
      expect(byName.absolutePath).toBe(
        path.join(PACKAGE_ROOT, `resources/document_standards/${name}.md`),
      );
      expect(existsSync(byName.absolutePath)).toBe(true);

      const byFile = resolveStandard(`${name}.md`);
      expect(byFile.canonicalName).toBe(name);
      expect(byFile.absolutePath).toBe(byName.absolutePath);
    }
  });

  it("resolves '/'-paths against the workspace root", () => {
    const ws = mkdtempSync(path.join(os.tmpdir(), "egm-standard-"));
    try {
      const rel = path.join("docs", "my-standard.md");
      mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true });
      writeFileSync(path.join(ws, rel), "# Standard\n");
      const resolved = resolveStandard(rel, ws);
      expect(resolved.absolutePath).toBe(path.resolve(ws, rel));
      expect(resolved.canonicalName).toBe("my-standard");
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it("rejects unknown shortnames instructively", () => {
    expect(() => resolveStandard("no-such-standard")).toThrow(/Unknown standard/);
    expect(() => resolveStandard("no-such-standard")).toThrow(/heilmeier-standard/);
  });
});

// ---------------------------------------------------------------------------
// artifact-dir.ts — resolveArtifactDir
// ---------------------------------------------------------------------------

describe("resolveArtifactDir", () => {
  const savedEnv = process.env.EGM_ARTIFACT_DIR;

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.EGM_ARTIFACT_DIR;
    else process.env.EGM_ARTIFACT_DIR = savedEnv;
  });

  it("EGM_ARTIFACT_DIR env override wins and the directory is created", () => {
    const ws = mkdtempSync(path.join(os.tmpdir(), "egm-art-ws-"));
    const override = path.join(mkdtempSync(path.join(os.tmpdir(), "egm-art-env-")), "reports");
    process.env.EGM_ARTIFACT_DIR = override;
    try {
      const resolved = resolveArtifactDir(ws);
      expect(resolved).toBe(override);
      expect(existsSync(override)).toBe(true);
    } finally {
      rmSync(ws, { recursive: true, force: true });
      rmSync(override, { recursive: true, force: true });
    }
  });

  it("an AGENTS.md marker line wins over the default (relative value resolved against the workspace root)", () => {
    const ws = mkdtempSync(path.join(os.tmpdir(), "egm-art-ws-"));
    delete process.env.EGM_ARTIFACT_DIR;
    try {
      writeFileSync(path.join(ws, "AGENTS.md"), "# Guide\nEGM artifact directory: artifacts\n");
      const resolved = resolveArtifactDir(ws);
      expect(resolved).toBe(path.resolve(ws, "artifacts"));
      expect(existsSync(path.join(ws, "artifacts"))).toBe(true);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it("the env override wins over an AGENTS.md marker", () => {
    const ws = mkdtempSync(path.join(os.tmpdir(), "egm-art-ws-"));
    const override = path.join(mkdtempSync(path.join(os.tmpdir(), "egm-art-env-")), "reports");
    process.env.EGM_ARTIFACT_DIR = override;
    try {
      writeFileSync(path.join(ws, "AGENTS.md"), "EGM artifact directory: ignored\n");
      expect(resolveArtifactDir(ws)).toBe(override);
    } finally {
      rmSync(ws, { recursive: true, force: true });
      rmSync(override, { recursive: true, force: true });
    }
  });

  it("a CLAUDE.md marker is honored when no AGENTS.md exists", () => {
    const ws = mkdtempSync(path.join(os.tmpdir(), "egm-art-ws-"));
    delete process.env.EGM_ARTIFACT_DIR;
    try {
      writeFileSync(path.join(ws, "CLAUDE.md"), "EGM artifact directory: claude-artifacts\n");
      expect(resolveArtifactDir(ws)).toBe(path.resolve(ws, "claude-artifacts"));
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it("defaults to '.' (the workspace root itself) with no env and no marker", () => {
    const ws = mkdtempSync(path.join(os.tmpdir(), "egm-art-ws-"));
    delete process.env.EGM_ARTIFACT_DIR;
    try {
      expect(resolveArtifactDir(ws)).toBe(ws);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// commands.ts — stripFrontmatter / buildCommandPayload
// ---------------------------------------------------------------------------

describe("stripFrontmatter", () => {
  it("strips a leading frontmatter block at byte 0", () => {
    const md = "---\nname: egm-review\ndescription: x\n---\nBody instructions here.";
    expect(stripFrontmatter(md)).toBe("Body instructions here.");
  });

  it("leaves later '---' separators in the body untouched", () => {
    const md = "---\nname: x\n---\nBody\n\n---\nUser arguments: keep me";
    expect(stripFrontmatter(md)).toBe("Body\n\n---\nUser arguments: keep me");
  });

  it("leaves content without a byte-0 frontmatter fence unchanged", () => {
    const md = "intro text\n---\nnot frontmatter\n---\nbody";
    expect(stripFrontmatter(md)).toBe(md);
  });
});

describe("buildCommandPayload", () => {
  it("returns the trimmed body when args are empty or whitespace", () => {
    expect(buildCommandPayload("  body  ", "")).toBe("body");
    expect(buildCommandPayload("body", "   ")).toBe("body");
  });

  it("appends the user arguments after a byte-0-free separator line", () => {
    expect(buildCommandPayload("body", "docs/design.md uninterrupted")).toBe(
      "body\n\n---\nUser arguments: docs/design.md uninterrupted",
    );
  });

  it("the 7 command aliases each map to their own skill directory", () => {
    expect(EGM_SKILL_COMMANDS).toHaveLength(7);
    const commands = new Set<string>();
    for (const spec of EGM_SKILL_COMMANDS) {
      expect(commands.has(spec.command), `duplicate command /${spec.command}`).toBe(false);
      commands.add(spec.command);
      expect(spec.command).toBe(spec.skill);
      expect(spec.description.trim()).toBeTruthy();
      expect(existsSync(path.join(REPO_ROOT, "skills", spec.skill, "SKILL.md"))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// bootstrap.ts — host-gated pure functions
// ---------------------------------------------------------------------------

describe.skipIf(!hostResolved)("bootstrap.ts pure functions (host-gated)", () => {
  let bootstrap: typeof import("../../extensions/lib/bootstrap.ts");

  beforeAll(async () => {
    bootstrap = await import("../../extensions/lib/bootstrap.ts");
  });

  describe("extractJson", () => {
    it("parses a plain JSON object", () => {
      expect(bootstrap.extractJson('{"a": 1}')).toEqual({ a: 1 });
    });

    it("parses a fenced ```json block", () => {
      expect(bootstrap.extractJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    });

    it("parses a plain fenced block without a language tag", () => {
      expect(bootstrap.extractJson('```\n{"a": 1}\n```')).toEqual({ a: 1 });
    });

    it("extracts JSON wrapped in prose", () => {
      expect(bootstrap.extractJson('Here is the result: {"a": 1} — hope it helps')).toEqual({ a: 1 });
    });

    it("prefers the fenced block over an earlier brace span", () => {
      const text = 'noise {not json} then:\n```json\n{"ok": true}\n```';
      expect(bootstrap.extractJson(text)).toEqual({ ok: true });
    });

    it("returns undefined on garbage", () => {
      expect(bootstrap.extractJson("no json here at all")).toBeUndefined();
      expect(bootstrap.extractJson("")).toBeUndefined();
      expect(bootstrap.extractJson("{broken")).toBeUndefined();
    });
  });

  describe("validateSubtreeIndex", () => {
    const valid = {
      subtree_index: [
        {
          path: "src/core",
          summary: "Core engine.",
          interface: ["Engine"],
          invariants: ["Deterministic"],
          side_effects: [],
        },
      ],
    };

    it("accepts a valid worker return", () => {
      const result = bootstrap.validateSubtreeIndex(valid);
      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("accepts a minimal worker return (optional fields omitted)", () => {
      const result = bootstrap.validateSubtreeIndex({
        subtree_index: [{ path: "a", summary: "b" }],
      });
      expect(result.ok).toBe(true);
    });

    it("rejects a non-object worker return", () => {
      for (const bad of ["string", null, 42, []]) {
        const result = bootstrap.validateSubtreeIndex(bad);
        expect(result.ok).toBe(false);
        expect(result.errors[0]).toMatch(/must be a JSON object/);
      }
    });

    it("rejects a missing or non-array subtree_index", () => {
      for (const bad of [{}, { subtree_index: "nope" }]) {
        const result = bootstrap.validateSubtreeIndex(bad);
        expect(result.ok).toBe(false);
        expect(result.errors[0]).toMatch(/subtree_index must be an array/);
      }
    });

    it("rejects entries with wrong field types (nothing coerced)", () => {
      const result = bootstrap.validateSubtreeIndex({
        subtree_index: [{ path: 1, summary: null }, { path: "ok", summary: "ok", interface: "not-an-array" }, { path: "ok", summary: "ok", invariants: [7] }],
      });
      expect(result.ok).toBe(false);
      expect(result.errors.join("\n")).toMatch(/subtree_index\[0\]\.path must be a string/);
      expect(result.errors.join("\n")).toMatch(/subtree_index\[0\]\.summary must be a string/);
      expect(result.errors.join("\n")).toMatch(/subtree_index\[1\]\.interface must be an array of strings/);
      expect(result.errors.join("\n")).toMatch(/subtree_index\[2\]\.invariants must contain only strings/);
    });
  });

  describe("discoverTree on scripts/fixtures/bootstrap-tree-6", () => {
    it("lists every directory, its files, and root manifests", () => {
      const tree = bootstrap.discoverTree(path.join(FIXTURES, "bootstrap-tree-6"));
      expect([...tree.dirs.keys()].sort()).toEqual(
        [
          "",
          "lib",
          "lib/math",
          "src",
          "src/api",
          "src/core",
          "src/util",
          "tests",
          "tools",
          "tools/gen",
          "web",
          "web/client",
        ].sort(),
      );
      expect(tree.dirs.get("")).toEqual(["package.json"]);
      expect(tree.dirs.get("lib/math")).toEqual(["ops.py"]);
      expect(tree.dirs.get("src/api")).toEqual(["routes.ts"]);
      // readdir order is filesystem-dependent: compare as sorted sets.
      expect(tree.dirs.get("src/core")?.sort()).toEqual(["README.md", "engine.ts"]);
      expect(tree.dirs.get("src/util")).toEqual(["format.ts"]);
      expect(tree.dirs.get("tests")).toEqual(["engine_test.ts"]);
      expect(tree.dirs.get("tools/gen")).toEqual(["render.sh"]);
      expect(tree.dirs.get("web/client")).toEqual(["app.js"]);
      expect(tree.manifests).toEqual(["package.json"]);
    });
  });

  describe("pruneTree", () => {
    it("keeps production-source dirs (and ancestors of survivors) and drops the test-only tests/ dir", () => {
      const tree = bootstrap.discoverTree(path.join(FIXTURES, "bootstrap-tree-6"));
      expect(bootstrap.pruneTree(tree)).toEqual([
        "lib",
        "lib/math",
        "src",
        "src/api",
        "src/core",
        "src/util",
        "tools",
        "tools/gen",
        "web",
        "web/client",
      ]);
    });
  });

  describe("partitionTree", () => {
    it("returns the depth-1 branches when 3-5 of them exist (bootstrap-tree-6)", () => {
      const tree = bootstrap.discoverTree(path.join(FIXTURES, "bootstrap-tree-6"));
      const partitions = bootstrap.partitionTree(bootstrap.pruneTree(tree));
      expect(partitions).toEqual(["lib", "src", "tools", "web"]);
    });

    it("walks deeper when fewer than 3 nodes exist at a shallower depth", () => {
      const dirs = ["a/x", "a/y", "a/z", "b/p", "b/q"];
      expect(bootstrap.partitionTree(dirs)).toEqual(["a/x", "a/y", "a/z", "b/p", "b/q"]);
    });

    it("groups the synthetic 16-flat fixture into the 4 largest branches plus one fallback partition", () => {
      const dirs = Array.from({ length: 16 }, (_, i) => `dir-${String(i + 1).padStart(2, "0")}`);
      const partitions = bootstrap.partitionTree(dirs);
      expect(partitions.length).toBeLessThanOrEqual(5);
      expect(partitions).toContain(""); // fallback partition at the root
      expect(partitions).toEqual(["dir-01", "dir-02", "dir-03", "dir-04", ""]);
      // Every directory is owned by exactly one partition.
      const assigned = bootstrap.assignPartitionDirs(partitions, dirs);
      expect([...assigned.values()].flat().sort()).toEqual(dirs.sort());
      expect(assigned.get("")).toHaveLength(12);
    });
  });

  describe("verifyContractFiles on a temp-scaffolded tree", () => {
    let root = "";
    let discovered: import("../../extensions/lib/bootstrap.ts").DiscoveredTree;

    const peanutReadme = (linkTarget: string, verification = "Run `npm test`.") =>
      [
        "# core",
        "",
        "## Interface",
        "Exposes the Engine API.",
        "",
        "## Invariants",
        "- Deterministic ordering.",
        "",
        "## Side Effects",
        "- None.",
        "",
        "## Verification",
        verification,
        "",
        `See [engine](${linkTarget}).`,
        "",
      ].join("\n");

    beforeAll(() => {
      root = mkdtempSync(path.join(os.tmpdir(), "egm-contract-"));
      mkdirSync(path.join(root, "src", "core"), { recursive: true });
      mkdirSync(path.join(root, "src", "api"), { recursive: true });
      mkdirSync(path.join(root, "docs"), { recursive: true });
      writeFileSync(path.join(root, "src", "core", "engine.ts"), "export const e = 1;\n");
      writeFileSync(path.join(root, "src", "api", "routes.ts"), "export const r = 1;\n");
      writeFileSync(path.join(root, "src", "core", "README.md"), peanutReadme("./engine.ts"));
      writeFileSync(
        path.join(root, "src", "api", "README.md"),
        peanutReadme("./does-not-exist.md"),
      );
      writeFileSync(
        path.join(root, "docs", "README.md"),
        ["# docs", "", "## Overview", "Repository documentation.", "", "## Subdirectories & Boundaries", "- none", ""].join("\n"),
      );
      mkdirSync(path.join(root, "empty"), { recursive: true });
      writeFileSync(path.join(root, "empty", "README.md"), "");
      discovered = {
        dirs: new Map([
          ["", []],
          ["src", []],
          ["src/core", ["engine.ts", "README.md"]],
          ["src/api", ["routes.ts", "README.md"]],
          ["docs", ["README.md"]],
          ["empty", ["README.md"]],
        ]),
        manifests: [],
      };
    });

    afterAll(() => {
      if (root) rmSync(root, { recursive: true, force: true });
    });

    it("reports a missing contract file", () => {
      const violations = bootstrap.verifyContractFiles(
        [path.join(root, "ghost", "README.md")],
        root,
        discovered,
        "npm test",
      );
      expect(violations.join("\n")).toMatch(/contract file is missing/);
    });

    it("reports an empty contract file", () => {
      const violations = bootstrap.verifyContractFiles(
        [path.join(root, "empty", "README.md")],
        root,
        discovered,
        "npm test",
      );
      expect(violations.join("\n")).toMatch(/contract file is empty/);
    });

    it("reports a broken relative link", () => {
      const violations = bootstrap.verifyContractFiles(
        [path.join(root, "src", "api", "README.md")],
        root,
        discovered,
        "npm test",
      );
      expect(violations.join("\n")).toMatch(/broken relative link "\.\/does-not-exist\.md"/);
    });

    it("reports a peanut contract with a missing required section", () => {
      const file = path.join(root, "src", "core", "README.md");
      const original = readFileSync(file, "utf8");
      try {
        const withoutInvariants = original.replace(/## Invariants[\s\S]*?(?=## Side Effects)/, "");
        writeFileSync(file, withoutInvariants);
        const violations = bootstrap.verifyContractFiles([file], root, discovered, "npm test");
        expect(violations.join("\n")).toMatch(/missing Invariants section/);
      } finally {
        writeFileSync(file, original);
      }
    });

    it("reports a peanut contract with an empty required section", () => {
      const file = path.join(root, "src", "core", "README.md");
      const original = readFileSync(file, "utf8");
      try {
        const emptied = original.replace(/## Invariants\n[\s\S]*?(?=## Side Effects)/, "## Invariants\n\n");
        writeFileSync(file, emptied);
        const violations = bootstrap.verifyContractFiles([file], root, discovered, "npm test");
        expect(violations.join("\n")).toMatch(/Invariants section is empty/);
      } finally {
        writeFileSync(file, original);
      }
    });

    it("reports a Verification section that omits the discovered command", () => {
      const file = path.join(root, "src", "core", "README.md");
      const original = readFileSync(file, "utf8");
      try {
        writeFileSync(file, peanutReadme("./engine.ts", "Run the tests somehow."));
        const violations = bootstrap.verifyContractFiles([file], root, discovered, "npm test");
        expect(violations.join("\n")).toMatch(/Verification section does not mention "npm test"/);
      } finally {
        writeFileSync(file, original);
      }
    });

    it("reports a valid peanut contract and a valid blueprint with no violations", () => {
      const violations = bootstrap.verifyContractFiles(
        [path.join(root, "src", "core", "README.md"), path.join(root, "docs", "README.md")],
        root,
        discovered,
        "npm test",
      );
      expect(violations).toEqual([]);
    });
  });
});
