import { defineConfig } from "vitest/config";
import { discoverHostPi } from "./tests/helpers/host";

/**
 * Vitest configuration for the pi-elephant-goldfish test suite.
 *
 * Unit tests (tests/unit) are fully local, fast, and deterministic. Integration
 * tests (tests/integration) spawn the real `pi` binary and are gated behind the
 * `EGM_E2E` environment variable (skipped by default).
 *
 * Host package aliasing: the vendored extension modules value-import host
 * packages (`typebox`, `@earendil-works/pi-coding-agent`,
 * `@earendil-works/pi-tui`), which are provided by the installed pi runtime,
 * not by this package (consumers of a pi package must not vendor them). The
 * discovery helper in tests/helpers/host.ts locates the local pi installation
 * (env `PI_PKG_DIR` if set, else the `pi` binary on PATH resolved to its
 * package directory) and maps each import specifier to the installed entry
 * file. If discovery fails, aliases stay unset and the affected suites skip
 * via `describe.skipIf(!hostResolved)`.
 */
const host = discoverHostPi();

export default defineConfig({
  resolve: {
    alias: host
      ? Object.entries(host.aliases).map(([find, replacement]) => ({ find, replacement }))
      : [],
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
  },
});
