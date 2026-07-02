import test from "node:test";
import assert from "node:assert/strict";
import { boundaryPacket } from "../src/boundary.js";

test("boundary packet defines Skillpress ownership and exclusions", () => {
  const packet = boundaryPacket();

  assert.equal(packet.ok, true);
  assert.equal(packet.type, "skillpress_boundary");
  assert.equal(packet.boundary.product, "skillpress");
  assert.ok(packet.boundary.owns.includes("Install and sync skills to provider surfaces"));
  assert.ok(packet.boundary.does_not_own.includes("Skill authoring"));
  assert.ok(packet.boundary.does_not_own.includes("Tool binary installation"));
  assert.ok(packet.boundary.invariants.includes("Installed provider roots are caches"));
});
