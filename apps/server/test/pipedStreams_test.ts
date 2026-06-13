import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Test stream scoring via resolveVideoPlayback internals — import after we export pick for test
// We test via module behavior with mocked fetch in integration; here test instance list exists.
import { PIPED_INSTANCES } from "../src/services/pipedInstances";

describe("pipedInstances", () => {
  it("includes currently reachable public instances", () => {
    assert.ok(PIPED_INSTANCES.length >= 3);
    assert.ok(PIPED_INSTANCES.includes("https://api.piped.private.coffee"));
    for (const base of PIPED_INSTANCES) {
      assert.match(base, /^https:\/\//);
    }
  });
});
