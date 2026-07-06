import { GENERATED_HEADER_END, GENERATED_HEADER_START } from "./render.js";

const HEADER_START = GENERATED_HEADER_START;
const HEADER_END = GENERATED_HEADER_END;
const POLICY_PACKS = new Set(["generic", "linter", "security", "ci", "performance"]);

function uniquePolicies(policies = ["linter"], customPolicyRules = []) {
  if (policies.includes("none")) {
    return [];
  }
  const customPacks = new Set(customPolicyRules.map((r) => r.pack).filter(Boolean));
  const selected = [];
  for (let policy of policies) {
    if (policy === "generic") {
      policy = "linter";
    }
    if ((POLICY_PACKS.has(policy) || customPacks.has(policy)) && !selected.includes(policy)) {
      selected.push(policy);
    }
  }
  return selected;
}

export function lintMarkdownFences(content) {
  const findings = [];
  const lines = String(content).split(/\r?\n/);
  let open = null;
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)(`{3,}|~{3,})(.*)$/);
    if (!match) {
      continue;
    }
    const marker = match[2][0];
    const length = match[2].length;
    if (!open) {
      open = { marker, length, line: index + 1 };
      continue;
    }
    if (open.marker === marker && length >= open.length) {
      open = null;
    }
  }
  if (open) {
    findings.push({
      code: "markdown_fence_unbalanced",
      severity: "error",
      line: open.line,
      message: `Markdown fence opened on line ${open.line} is not closed`
    });
  }
  return findings;
}

function parseFrontmatterLine(line, fields, currentPrefix = null) {
  const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
  if (!match) {
    return null;
  }
  const key = currentPrefix ? `${currentPrefix}_${match[1]}` : match[1];
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  fields[key] = value;
  return match[1];
}

export function parseSkillFrontmatter(content) {
  const text = String(content);
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) {
    return {
      present: false,
      fields: {},
      body_start: 0,
      errors: []
    };
  }
  const lines = text.split(/\r?\n/);
  const fields = {};
  const errors = [];
  let currentObject = null;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "---") {
      const bodyStart = lines.slice(0, index + 1).join("\n").length + 1;
      return {
        present: true,
        fields,
        body_start: bodyStart,
        errors
      };
    }
    if (line.trim() === "") {
      continue;
    }
    const nestedMatch = line.match(/^\s{2,}([A-Za-z0-9_-]+):\s*(.*)$/);
    if (nestedMatch && currentObject) {
      parseFrontmatterLine(`${nestedMatch[1]}: ${nestedMatch[2]}`, fields, currentObject);
      continue;
    }
    const objectMatch = line.match(/^([A-Za-z0-9_-]+):\s*$/);
    if (objectMatch) {
      currentObject = objectMatch[1];
      continue;
    }
    currentObject = null;
    if (!parseFrontmatterLine(line, fields)) {
      errors.push({
        code: "frontmatter_invalid_line",
        severity: "error",
        line: index + 1,
        message: "Skill frontmatter line must use key: value syntax"
      });
    }
  }
  return {
    present: true,
    fields,
    body_start: text.length,
    errors: [{
      code: "frontmatter_unclosed",
      severity: "error",
      message: "Skill frontmatter is not closed"
    }, ...errors]
  };
}

function findGeneratedHeaderRange(text) {
  if (text.startsWith(HEADER_START)) {
    const end = text.indexOf(HEADER_END);
    return end === -1 ? { start: 0, end: -1 } : { start: 0, end: end + HEADER_END.length };
  }
  const frontmatter = parseSkillFrontmatter(text);
  if (!frontmatter.present || frontmatter.errors.some((entry) => entry.code === "frontmatter_unclosed")) {
    return null;
  }
  const start = text.indexOf(HEADER_START, frontmatter.body_start);
  if (start === -1) {
    return null;
  }
  const between = text.slice(frontmatter.body_start, start);
  if (!/^\s*$/.test(between)) {
    return null;
  }
  const end = text.indexOf(HEADER_END, start);
  return end === -1 ? { start, end: -1 } : { start, end: end + HEADER_END.length };
}

export function parseGeneratedHeader(content) {
  const text = String(content);
  const range = findGeneratedHeaderRange(text);
  if (!range) {
    return { present: false, fields: {}, errors: [] };
  }
  if (range.end === -1) {
    return {
      present: true,
      fields: {},
      errors: [{
        code: "generated_header_unclosed",
        severity: "error",
        message: "Skillpress generated header is not closed"
      }]
    };
  }
  const block = text.slice(range.start + HEADER_START.length, range.end - HEADER_END.length);
  const fields = {};
  const errors = [];
  for (const [offset, rawLine] of block.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (line === "") {
      continue;
    }
    const separator = line.indexOf(":");
    if (separator === -1) {
      errors.push({
        code: "generated_header_invalid_line",
        severity: "error",
        line: offset + 1,
        message: "Generated header line must use key: value syntax"
      });
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!/^[a-z_]+$/.test(key) || value.length === 0) {
      errors.push({
        code: "generated_header_invalid_field",
        severity: "error",
        line: offset + 1,
        message: "Generated header field is invalid"
      });
      continue;
    }
    fields[key] = value;
  }
  return { present: true, fields, errors };
}

export function compareHeaderToManifest(header, manifestEntry) {
  if (!manifestEntry) {
    return [];
  }
  if (!header.present) {
    return [{
      code: "generated_header_missing",
      severity: "error",
      message: "Manifest-managed installed skill is missing a Skillpress generated header"
    }];
  }
  const findings = [...header.errors];
  if (manifestEntry.source_hash && header.fields.source_hash !== manifestEntry.source_hash) {
    findings.push({
      code: "generated_header_stale",
      severity: "error",
      field: "source_hash",
      expected: manifestEntry.source_hash,
      actual: header.fields.source_hash ?? null,
      message: "Generated header source_hash does not match manifest"
    });
  }
  if (manifestEntry.skill_md_hash && header.fields.skill_md_hash !== manifestEntry.skill_md_hash) {
    findings.push({
      code: "generated_header_stale",
      severity: "error",
      field: "skill_md_hash",
      expected: manifestEntry.skill_md_hash,
      actual: header.fields.skill_md_hash ?? null,
      message: "Generated header skill_md_hash does not match manifest"
    });
  }
  if (manifestEntry.source_tree_hash && header.fields.source_tree_hash !== manifestEntry.source_tree_hash) {
    findings.push({
      code: "generated_header_stale",
      severity: "error",
      field: "source_tree_hash",
      expected: manifestEntry.source_tree_hash,
      actual: header.fields.source_tree_hash ?? null,
      message: "Generated header source_tree_hash does not match manifest"
    });
  }
  if (manifestEntry.source_path && header.fields.source_path !== manifestEntry.source_path) {
    findings.push({
      code: "generated_header_stale",
      severity: "error",
      field: "source_path",
      expected: manifestEntry.source_path,
      actual: header.fields.source_path ?? null,
      message: "Generated header source_path does not match manifest"
    });
  }
  if (header.fields.target && header.fields.target !== manifestEntry.provider) {
    findings.push({
      code: "generated_header_stale",
      severity: "error",
      field: "target",
      expected: manifestEntry.provider,
      actual: header.fields.target,
      message: "Generated header target does not match manifest provider"
    });
  }
  return findings;
}

function finding(code, message, details = {}) {
  return {
    code,
    severity: "error",
    message,
    ...details
  };
}

export function lintSkillShape(content, context = {}) {
  const findings = [];
  const frontmatter = parseSkillFrontmatter(content);
  if (!frontmatter.present) {
    findings.push(finding("frontmatter_missing", "SKILL.md must start with Agent Skills frontmatter", {
      skill: context.skill ?? null,
      tool: context.tool ?? null
    }));
    return findings;
  }
  for (const error of frontmatter.errors) {
    findings.push({
      ...error,
      skill: context.skill ?? null,
      tool: context.tool ?? null
    });
  }
  if (!frontmatter.fields.name) {
    findings.push(finding("frontmatter_name_missing", "Skill frontmatter must include name", {
      skill: context.skill ?? null,
      tool: context.tool ?? null
    }));
  }
  if (!frontmatter.fields.description) {
    findings.push(finding("frontmatter_description_missing", "Skill frontmatter must include description", {
      skill: context.skill ?? null,
      tool: context.tool ?? null
    }));
  }
  return findings;
}

export function lintReferencedFiles(content, source = null) {
  if (!source?.files) {
    return [];
  }
  const findings = [];
  const files = new Set(source.files.map((file) => file.relative_path));
  const linkRegex = /\[[^\]]+\]\(([^)]+)\)/g;
  for (const match of String(content).matchAll(linkRegex)) {
    const target = match[1].trim();
    if (!target || target.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("/")) {
      continue;
    }
    const cleanTarget = target.split("#")[0].split("?")[0];
    if (!cleanTarget || cleanTarget.includes("..")) {
      continue;
    }
    if (!files.has(cleanTarget)) {
      findings.push(finding("skill_reference_missing", "SKILL.md references a file that is not in the skill directory", {
        skill: source.skill,
        tool: source.tool ?? null,
        reference: cleanTarget
      }));
    }
  }
  return findings;
}

export function lintSecurityRules(content, context = {}) {
  const text = String(content);
  const findings = [];
  const skill = context.skill ?? null;
  const tool = context.tool ?? null;
  const location = context.path ?? null;

  if (/curl\s+.*\|\s*(?:bash|sh|zsh)/i.test(text)) {
    findings.push(finding("security_shell_piping", "Direct piping of curl outputs to shell is forbidden for security safety", {
      skill,
      tool,
      path: location
    }));
  }

  if (/\bsudo\b/.test(text)) {
    findings.push(finding("security_sudo_execution", "Unauthorized privilege escalation using sudo is forbidden", {
      skill,
      tool,
      path: location
    }));
  }

  if (/\b(?:api_key|token|password|secret|passwd)\s*[:=]\s*["'][A-Za-z0-9+/=_-]{16,}["']/i.test(text)) {
    findings.push(finding("security_credential_exposure", "Hardcoded credential or token secret assignments are forbidden", {
      skill,
      tool,
      path: location
    }));
  }

  return findings;
}

export function lintCiRules(content, context = {}) {
  const text = String(content);
  const findings = [];
  const skill = context.skill ?? null;
  const tool = context.tool ?? null;
  const location = context.path ?? null;

  if (/\b(?:read\s+-p|rm\s+-i|cp\s+-i|mv\s+-i)\b/.test(text)) {
    findings.push(finding("ci_interactive_prompts", "Interactive CLI prompts that block execution are forbidden", {
      skill,
      tool,
      path: location
    }));
  }

  if (/\bnode\s+[a-zA-Z0-9_-]+\.js\b/.test(text)) {
    findings.push(finding("ci_arbitrary_node_execution", "Executing raw node scripts directly is forbidden; define and use npm scripts instead", {
      skill,
      tool,
      path: location
    }));
  }

  return findings;
}

export function lintPerformanceRules(content, context = {}) {
  const text = String(content);
  const findings = [];
  const skill = context.skill ?? null;
  const tool = context.tool ?? null;
  const location = context.path ?? null;

  if (/(?:\/Users\/[a-zA-Z0-9_-]+|\/home\/[a-zA-Z0-9_-]+)\b/i.test(text)) {
    findings.push(finding("performance_absolute_paths", "Hardcoded absolute system home paths are forbidden; use portable workspace variables or relative paths", {
      skill,
      tool,
      path: location
    }));
  }

  const lines = text.split(/\r?\n/);
  let insideBlock = false;
  let blockLinesCount = 0;
  for (const line of lines) {
    if (/^(\s*)(`{3,}|~{3,})/.test(line)) {
      if (insideBlock) {
        if (blockLinesCount > 40) {
          findings.push(finding("performance_oversized_code_block", "Markdown code block contains more than 40 lines which bloats prompt context", {
            skill,
            tool,
            path: location
          }));
          break;
        }
        insideBlock = false;
      } else {
        insideBlock = true;
        blockLinesCount = 0;
      }
    } else if (insideBlock) {
      blockLinesCount += 1;
    }
  }

  return findings;
}

function commandKey(match) {
  return [match[1], match[2]].filter(Boolean).join(" ");
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function lintCommandContracts(content, contracts = {}, context = {}) {
  const text = String(content);
  const findings = [];
  for (const [tool, commands] of Object.entries(contracts).sort(([left], [right]) => left.localeCompare(right))) {
    const allowed = new Set(commands ?? []);
    if (allowed.size === 0) {
      continue;
    }
    const regex = new RegExp(`\\b${escapeRegex(tool)}\\s+(?!-)([a-z-]+)(?:\\s+(?!-)([a-z-]+))?\\b`, "g");
    for (const match of text.matchAll(regex)) {
      const key = commandKey(match);
      const baseKey = match[1];
      if (!allowed.has(key) && !allowed.has(baseKey)) {
        findings.push(finding("command_contract_unknown", `Command '${tool} ${key}' is not in the ${tool} contract`, {
          tool,
          command: `${tool} ${key}`,
          skill: context.skill ?? null,
          path: context.path ?? null
        }));
      }
    }
  }
  return findings;
}

export function lintSkillContent(content, context = {}) {
  const policies = uniquePolicies(context.policyPacks ?? ["linter"], context.customPolicyRules);
  const findings = [];
  if (policies.includes("linter")) {
    findings.push(
      ...lintMarkdownFences(content),
      ...lintSkillShape(content, context),
      ...lintReferencedFiles(content, context.source ?? null),
      ...lintCommandContracts(content, context.contracts ?? {}, context)
    );
  }


  if (policies.includes("security")) {
    findings.push(...lintSecurityRules(content, context));
  }
  if (policies.includes("ci")) {
    findings.push(...lintCiRules(content, context));
  }
  if (policies.includes("performance")) {
    findings.push(...lintPerformanceRules(content, context));
  }

  if (Array.isArray(context.customPolicyRules)) {
    for (const rule of context.customPolicyRules) {
      let pack = rule.pack ?? "linter";
      if (pack === "generic") {
        pack = "linter";
      }
      if (policies.includes(pack)) {
        try {
          const regex = new RegExp(rule.pattern);
          if (regex.test(content)) {
            findings.push({
              code: rule.id,
              severity: rule.severity ?? "error",
              message: rule.message,
              skill: context.skill ?? null,
              tool: context.tool ?? null,
              path: context.path ?? null
            });
          }
        } catch (err) {
          // ignore invalid RegExp (already checked at config load time)
        }
      }
    }
  }

  return findings;
}

export function stripSkillFrontmatter(content) {
  const text = String(content);
  const frontmatter = parseSkillFrontmatter(text);
  if (!frontmatter.present || frontmatter.errors.length > 0) {
    return text;
  }
  return text.slice(frontmatter.body_start).replace(/^\s+/, "");
}
