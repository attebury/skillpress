#!/usr/bin/env node
import { boundaryPacket } from "../src/boundary.js";
import { doctorPacket } from "../src/doctor.js";
import { statusPacket } from "../src/status.js";

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
    "skillpress status --json [--manifest <path>] [--provider codex|agents|cursor|claude-code]",
    "skillpress doctor --json [--manifest <path>] [--provider codex|agents|cursor|claude-code]",
    "skillpress sync [--provider codex|agents|cursor|claude-code] [--tool <tool>]"
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
      provider: readOption(args, "--provider")
    }));
  }
} else if (command === "doctor") {
  if (!wantsJson) {
    process.stderr.write("doctor currently requires --json\n");
    process.exitCode = 2;
  } else {
    const packet = doctorPacket({
      manifestPath: readOption(args, "--manifest"),
      provider: readOption(args, "--provider")
    });
    printJson(packet);
    if (!packet.ok) {
      process.exitCode = 1;
    }
  }
} else if (command === "sync") {
  process.stderr.write(`${command} is not implemented in this bootstrap slice\n`);
  process.exitCode = 2;
} else {
  process.stderr.write(`${usage()}\n`);
  process.exitCode = 2;
}
