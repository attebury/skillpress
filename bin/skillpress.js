#!/usr/bin/env node
import { boundaryPacket } from "../src/boundary.js";

function printJson(packet) {
  process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
}

function usage() {
  return [
    "skillpress boundary --json",
    "skillpress status --json",
    "skillpress doctor --json",
    "skillpress sync [--provider codex|cursor|claude-code] [--tool <tool>]"
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
} else if (command === "status" || command === "doctor" || command === "sync") {
  process.stderr.write(`${command} is not implemented in this bootstrap slice\n`);
  process.exitCode = 2;
} else {
  process.stderr.write(`${usage()}\n`);
  process.exitCode = 2;
}

