#!/usr/bin/env node
import { boundaryPacket } from "../src/boundary.js";
import { doctorPacket } from "../src/doctor.js";
import { publishPacket } from "../src/publish.js";
import { repairPlanPacket } from "../src/repair-plan.js";
import { statusPacket } from "../src/status.js";
import { syncPacket } from "../src/sync.js";
import { versionPacket, versionText } from "../src/version-info.js";


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

function readOptions(args, name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) {
      values.push(...args[index + 1].split(",").map((entry) => entry.trim()).filter(Boolean));
    }
  }
  return values.length > 0 ? values : null;
}

function usage() {
  const providerHelp = "codex|agents|cursor|claude-code|zed|github-copilot|cline|roo|continue|devin|github-copilot-instructions|agents-md";
  return [
    "skillpress --version",
    "skillpress version --json",
    "skillpress boundary --json",
    `skillpress repair-plan --json [--config <path>] [--manifest <path>] [--provider ${providerHelp}] [--tool <tool>] [--source-root <path>] [--source-layout auto|tool-scoped|agent-skills|claude-skills] [--contract-root <path>] [--policy generic|dogfood|none]`,
    `skillpress status --json [--config <path>] [--manifest <path>] [--provider ${providerHelp}] [--tool <tool>] [--source-root <path>] [--source-layout auto|tool-scoped|agent-skills|claude-skills] [--contract-root <path>] [--policy generic|dogfood|none]`,
    `skillpress doctor --json [--config <path>] [--manifest <path>] [--provider ${providerHelp}] [--tool <tool>] [--source-root <path>] [--source-layout auto|tool-scoped|agent-skills|claude-skills] [--contract-root <path>] [--policy generic|dogfood|none]`,
    `skillpress sync --json [--config <path>] [--provider ${providerHelp}] [--tool <tool>] [--manifest <path>] [--source-root <path>] [--source-layout auto|tool-scoped|agent-skills|claude-skills] [--contract-root <path>] [--policy generic|dogfood|none] [--dry-run]`,
    "skillpress publish --json --skill <name> [--scope global|forest|tree] [--lanes <lane1,lane2>] [--workspace-root <path>] [--dry-run]"
  ].join("\n");
}

const [command, ...args] = process.argv.slice(2);
const wantsJson = args.includes("--json");

function unsupportedVersionOption(args) {
  return args.find((arg) => arg !== "--json") ?? null;
}

if (command === "--version") {
  if (args.length > 0) {
    process.stderr.write("--version does not accept additional options\n");
    process.exitCode = 2;
  } else {
    const result = versionText();
    if (!result.ok) {
      process.stderr.write(`${result.message}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(`${result.text}\n`);
    }
  }
} else if (command === "--help" || command === "-h" || command === "help") {
  process.stdout.write(`${usage()}\n`);
} else if (command === "version") {
  const unsupported = unsupportedVersionOption(args);
  if (!wantsJson) {
    process.stderr.write("version currently requires --json\n");
    process.exitCode = 2;
  } else if (unsupported) {
    process.stderr.write(`version received unsupported option: ${unsupported}\n`);
    process.exitCode = 2;
  } else {
    const packet = versionPacket();
    printJson(packet);
    if (!packet.ok) {
      process.exitCode = 1;
    }
  }
} else if (command === "boundary") {
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
    const packet = statusPacket({
      configPath: readOption(args, "--config"),
      manifestPath: readOption(args, "--manifest"),
      provider: readOption(args, "--provider"),
      tool: readOption(args, "--tool"),
      sourceRoot: readOption(args, "--source-root"),
      sourceLayout: readOption(args, "--source-layout"),
      contractRoot: readOption(args, "--contract-root"),
      policyPacks: readOptions(args, "--policy")
    });
    printJson(packet);
  }
} else if (command === "repair-plan") {
  if (!wantsJson) {
    process.stderr.write("repair-plan currently requires --json\n");
    process.exitCode = 2;
  } else {
    const packet = repairPlanPacket({
      configPath: readOption(args, "--config"),
      manifestPath: readOption(args, "--manifest"),
      provider: readOption(args, "--provider"),
      tool: readOption(args, "--tool"),
      sourceRoot: readOption(args, "--source-root"),
      sourceLayout: readOption(args, "--source-layout"),
      contractRoot: readOption(args, "--contract-root"),
      policyPacks: readOptions(args, "--policy")
    });
    printJson(packet);
    if (!packet.ok) {
      process.exitCode = 1;
    }
  }
} else if (command === "doctor") {
  if (!wantsJson) {
    process.stderr.write("doctor currently requires --json\n");
    process.exitCode = 2;
  } else {
    const packet = doctorPacket({
      configPath: readOption(args, "--config"),
      manifestPath: readOption(args, "--manifest"),
      provider: readOption(args, "--provider"),
      tool: readOption(args, "--tool"),
      sourceRoot: readOption(args, "--source-root"),
      sourceLayout: readOption(args, "--source-layout"),
      contractRoot: readOption(args, "--contract-root"),
      policyPacks: readOptions(args, "--policy")
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
        configPath: readOption(args, "--config"),
        manifestPath: readOption(args, "--manifest"),
        provider: readOption(args, "--provider"),
        tool: readOption(args, "--tool"),
        sourceRoot: readOption(args, "--source-root"),
        sourceLayout: readOption(args, "--source-layout"),
        contractRoot: readOption(args, "--contract-root"),
        policyPacks: readOptions(args, "--policy"),
        dryRun: args.includes("--dry-run")
      });
      printJson(packet);
      if (!packet.ok) {
        process.exitCode = 1;
      }
    } catch (error) {
      const packet = {
        ok: false,
        type: "skillpress_error",
        schema_version: 1,
        code: error.code ?? "skillpress_sync_failed",
        message: error.message
      };
      printJson(packet);
      process.exitCode = 1;
    }
  }
} else if (command === "publish") {
  if (!wantsJson) {
    process.stderr.write("publish currently requires --json\n");
    process.exitCode = 2;
  } else {
    try {
      const packet = publishPacket({
        skillName: readOption(args, "--skill"),
        scope: readOption(args, "--scope"),
        lanes: readOptions(args, "--lanes"),
        workspaceRoot: readOption(args, "--workspace-root"),
        configPath: readOption(args, "--config"),
        sourceRoot: readOption(args, "--source-root"),
        sourceLayout: readOption(args, "--source-layout"),
        contractRoot: readOption(args, "--contract-root"),
        policyPacks: readOptions(args, "--policy"),
        dryRun: args.includes("--dry-run")
      });
      printJson(packet);
      if (!packet.ok) {
        process.exitCode = 1;
      }
    } catch (error) {
      const packet = {
        ok: false,
        type: "skillpress_error",
        schema_version: 1,
        code: error.code ?? "skillpress_publish_failed",
        message: error.message
      };
      printJson(packet);
      process.exitCode = 1;
    }
  }
} else {
  process.stderr.write(`${usage()}\n`);
  process.exitCode = 2;
}
