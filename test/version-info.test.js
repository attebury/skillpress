import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { versionPacket, versionText } from "../src/version-info.js";

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "skillpress-version-info-"));
}

test("versionPacket reports package metadata", () => {
  const root = fixture();
  const packageJsonPath = path.join(root, "package.json");
  fs.writeFileSync(packageJsonPath, JSON.stringify({
    name: "skillpress",
    version: "1.2.3-beta.4"
  }));

  const packet = versionPacket({ packageJsonPath, nodeVersion: "v99.0.0" });
  assert.deepEqual(packet, {
    ok: true,
    type: "skillpress.version.v1",
    schema_version: 1,
    tool: "skillpress",
    package_name: "skillpress",
    version: "1.2.3-beta.4",
    source: "package.json",
    node_version: "v99.0.0"
  });

  assert.deepEqual(versionText({ packageJsonPath }), {
    ok: true,
    text: "skillpress 1.2.3-beta.4"
  });
});

test("versionPacket returns typed missing metadata errors", () => {
  const root = fixture();
  const packet = versionPacket({ packageJsonPath: path.join(root, "missing-package.json") });

  assert.equal(packet.ok, false);
  assert.equal(packet.type, "skillpress.version_error.v1");
  assert.equal(packet.code, "version_metadata_missing");
  assert.equal(packet.tool, "skillpress");
  assert.equal(packet.message.includes(root), false);
});

test("versionPacket returns typed invalid metadata errors", () => {
  const root = fixture();
  const malformedPath = path.join(root, "malformed-package.json");
  fs.writeFileSync(malformedPath, "{");

  const malformed = versionPacket({ packageJsonPath: malformedPath });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.code, "version_metadata_invalid");
  assert.equal(malformed.message.includes(root), false);

  const unsafePath = path.join(root, "unsafe-package.json");
  fs.writeFileSync(unsafePath, JSON.stringify({
    name: "skillpress",
    version: "bad version"
  }));

  const unsafe = versionPacket({ packageJsonPath: unsafePath });
  assert.equal(unsafe.ok, false);
  assert.equal(unsafe.code, "version_metadata_invalid");
  assert.equal(unsafe.message.includes("bad version"), false);
});
