import fs from "node:fs";
import path from "node:path";
import { DEFAULT_CONTRACT_ROOT } from "./source.js";
import { isPathInside } from "./providers.js";

const CONTRACT_TOOLS = Object.freeze(["remogram", "runlane", "topogram"]);

function normalizeCommands(document, tool) {
  const commands = Array.isArray(document?.commands) ? document.commands : [];
  return commands
    .map((entry) => typeof entry === "string" ? entry : entry?.command)
    .filter((entry) => typeof entry === "string" && entry.length > 0)
    .map((entry) => entry.replace(new RegExp(`^${tool}\\s+`), "").trim());
}

export function loadCommandContracts({ cwd = process.cwd(), contractRoot = DEFAULT_CONTRACT_ROOT } = {}) {
  const resolvedCwd = path.resolve(cwd);
  const root = path.resolve(resolvedCwd, contractRoot ?? DEFAULT_CONTRACT_ROOT);
  const contracts = {};
  const issues = [];
  if (!isPathInside(root, resolvedCwd)) {
    for (const tool of CONTRACT_TOOLS) {
      contracts[tool] = [];
    }
    return {
      root,
      contracts,
      issues: [{
        code: "command_contract_root_outside_repo",
        severity: "error",
        message: "Command contract root must stay inside the repository",
        path: root
      }]
    };
  }
  for (const tool of CONTRACT_TOOLS) {
    const filePath = path.join(root, `${tool}.commands.json`);
    if (!fs.existsSync(filePath)) {
      contracts[tool] = [];
      continue;
    }
    try {
      const document = JSON.parse(fs.readFileSync(filePath, "utf8"));
      contracts[tool] = normalizeCommands(document, tool);
    } catch (error) {
      contracts[tool] = [];
      issues.push({
        code: "command_contract_invalid",
        severity: "error",
        message: `Command contract for ${tool} could not be read`,
        tool,
        path: filePath,
        error: error.message
      });
    }
  }
  return { root, contracts, issues };
}
