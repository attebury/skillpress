#!/usr/bin/env node
import { boundaryPacket } from "../src/boundary.js";
import { doctorPacket } from "../src/doctor.js";
import { statusPacket } from "../src/status.js";
import { syncPacket } from "../src/sync.js";

function printJson(packet) {
  process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
}

function readOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return null;
  }
  return args[index + 1] ?? null;
}

function usage() {
  return [
    "skillpress boundary --json",
    "skillpress status --json [--manifest <path>] [--provider codex|agents|cursor|claude-code] [--tool <tool>] [--source-root <path>] [--contract-root <path>]",
    "skillpress doctor --json [--manifest <path>] [--provider codex|agents|cursor|claude-code] [--tool <tool>] [--source-root <path>] [--contract-root <path>]",
    "skillpress sync --json [--provider codex|agents|cursor] [--tool <tool>] [--manifest <path>] [--source-root <path>] [--contract-root <path>] [--dry-run]"
  ].join("\n");
}

const [command, ...args] = process.argv.slice(2);
const wantsJson = args.includes("--json");

if (command === "boundary") {
  if (!wantsJson) {
    process.stderr.write("boundary currently requires --json\n");
    process.exitCode = 2;
  } else {
    printJson(boundaryPacket());
  }
} else if (command === "status") {
  if (!wantsJson) {
    process.stderr.write("status currently requires --json\n");
    process.exitCode = 2;
  } else {
    printJson(statusPacket({
      manifestPath: readOption(args, "--manifest"),
      provider: readOption(args, "--provider"),
      tool: readOption(args, "--tool"),
      sourceRoot: readOption(args, "--source-root"),
      contractRoot: readOption(args, "--contract-root")
    }));
  }
} else if (command === "doctor") {
  if (!wantsJson) {
    process.stderr.write("doctor currently requires --json\n");
    process.exitCode = 2;
  } else {
    const packet = doctorPacket({
      manifestPath: readOption(args, "--manifest"),
      provider: readOption(args, "--provider"),
      tool: readOption(args, "--tool"),
      sourceRoot: readOption(args, "--source-root"),
      contractRoot: readOption(args, "--contract-root")
    });
    printJson(packet);
    if (!packet.ok) {
      process.exitCode = 1;
    }
  }
} else if (command === "sync") {
  if (!wantsJson) {
    process.stderr.write("sync currently requires --json\n");
    process.exitCode = 2;
  } else {
    try {
      const packet = syncPacket({
        manifestPath: readOption(args, "--manifest"),
        provider: readOption(args, "--provider"),
        tool: readOption(args, "--tool"),
        sourceRoot: readOption(args, "--source-root"),
        contractRoot: readOption(args, "--contract-root"),
        dryRun: args.includes("--dry-run")
      });
      printJson(packet);
      if (!packet.ok) {
        process.exitCode = 1;
      }
    } catch (error) {
      printJson({
        ok: false,
        type: "skillpress_error",
        schema_version: 1,
        code: error.code ?? "skillpress_sync_failed",
        message: error.message
      });
      process.exitCode = 1;
    }
  }
} else {
  process.stderr.write(`${usage()}\n`);
  process.exitCode = 2;
}
