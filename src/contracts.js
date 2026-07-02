import fs from "node:fs";
import path from "node:path";
import { DEFAULT_CONTRACT_ROOT } from "./source.js";
import { isPathInside } from "./providers.js";
import { assertSafeToolId } from "./source.js";

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
  if (!fs.existsSync(root)) {
    return { root, contracts, issues };
  }
  for (const dirent of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!dirent.isFile() || !dirent.name.endsWith(".commands.json")) {
      continue;
    }
    const filePath = path.join(root, dirent.name);
    try {
      const document = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const tool = assertSafeToolId(document.tool ?? dirent.name.replace(/\.commands\.json$/, ""));
      contracts[tool] = normalizeCommands(document, tool);
    } catch (error) {
      issues.push({
        code: "command_contract_invalid",
        severity: "error",
        message: "Command contract could not be read",
        tool: null,
        path: filePath,
        error: error.message
      });
    }
  }
  return { root, contracts, issues };
}
