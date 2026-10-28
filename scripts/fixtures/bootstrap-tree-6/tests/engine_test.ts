import assert from "node:assert";
import { runEngine } from "../src/core/engine.ts";

assert.deepStrictEqual(runEngine({ depth: 2 }), ["frame-0", "frame-1"]);
