import { GENERATED_HEADER_END, GENERATED_HEADER_START } from "./render.js";

const HEADER_START = GENERATED_HEADER_START;
const HEADER_END = GENERATED_HEADER_END;

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

export function parseGeneratedHeader(content) {
  const text = String(content);
  if (!text.startsWith(HEADER_START)) {
    return { present: false, fields: {}, errors: [] };
  }
  const end = text.indexOf(HEADER_END);
  if (end === -1) {
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
  const block = text.slice(HEADER_START.length, end);
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

function hasAllowedReason(content) {
  return /(?:why allowed|allowed reason|external user|explicitly requested)\s*:/i.test(content);
}

export function lintPolicyRules(content, context = {}) {
  const text = String(content);
  const lower = text.toLowerCase();
  const findings = [];
  const skill = context.skill ?? null;
  const tool = context.tool ?? null;
  const location = context.path ?? null;
  const dogfoodish = /dogfood/.test(lower) || /dogfood/i.test(String(skill)) || /dogfood/i.test(String(location));

  if (
    dogfoodish &&
    /\b(?:allow_missing_checks|allow_pending_checks|REMOGRAM_ALLOW_MISSING_CHECKS|REMOGRAM_ALLOW_PENDING_CHECKS)\b/i.test(text)
  ) {
    findings.push(finding("policy_missing_pending_check_waiver_forbidden", "Dogfood skills must not allow missing or pending checks", {
      skill,
      tool
    }));
  }

  if (/\bnpm\s+link\b/i.test(text) && /\b(?:lane|dogfood|worktree|local)\b/i.test(text)) {
    findings.push(finding("policy_lane_npm_link_forbidden", "Lane and dogfood instructions must not use npm link", {
      skill,
      tool
    }));
  }

  if (/\borigin\/main\b/.test(text) && !/\bcanonical_integration_ref\b/.test(text)) {
    findings.push(finding("policy_hardcoded_origin_main", "Generic workflow skills must use configured canonical_integration_ref instead of hardcoded origin/main", {
      skill,
      tool
    }));
  }

  if (/\bremogram\s+cr\s+(?:view|checks|merge-plan)\b/.test(text)) {
    findings.push(finding("policy_stale_remogram_cr_command", "Skill text uses stale remogram cr command names", {
      skill,
      tool
    }));
  }

  if (/\b(?:compatibility|fallback|shim|bypass)\b/i.test(text) && !hasAllowedReason(text)) {
    findings.push(finding("policy_unjustified_compatibility_language", "Compatibility, fallback, shim, or bypass language requires an explicit allowed reason", {
      skill,
      tool
    }));
  }

  return findings;
}

function commandKey(match) {
  return [match[1], match[2]].filter(Boolean).join(" ");
}

export function lintCommandContracts(content, contracts = {}, context = {}) {
  const text = String(content);
  const findings = [];
  const remogramAllowed = new Set(contracts.remogram ?? []);
  const runlaneAllowed = new Set(contracts.runlane ?? []);
  const topogramAllowed = new Set(contracts.topogram ?? []);
  const commandPatterns = [
    {
      tool: "remogram",
      allowed: remogramAllowed,
      regex: /\bremogram\s+(?!-)([a-z-]+)(?:\s+(?!-)([a-z-]+))?\b/g
    },
    {
      tool: "runlane",
      allowed: runlaneAllowed,
      regex: /\brunlane\s+(?!-)([a-z-]+)(?:\s+(?!-)([a-z-]+))?\b/g
    },
    {
      tool: "topogram",
      allowed: topogramAllowed,
      regex: /\btopogram\s+(?!-)([a-z-]+)(?:\s+(?!-)([a-z-]+))?\b/g
    }
  ];

  for (const pattern of commandPatterns) {
    if (pattern.allowed.size === 0) {
      continue;
    }
    for (const match of text.matchAll(pattern.regex)) {
      const key = commandKey(match);
      const baseKey = match[1];
      if (!pattern.allowed.has(key) && !pattern.allowed.has(baseKey)) {
        findings.push(finding("command_contract_unknown", `Command '${pattern.tool} ${key}' is not in the ${pattern.tool} contract`, {
          tool: pattern.tool,
          command: `${pattern.tool} ${key}`,
          skill: context.skill ?? null,
          path: context.path ?? null
        }));
      }
    }
  }
  return findings;
}

export function lintSkillContent(content, context = {}) {
  return [
    ...lintMarkdownFences(content),
    ...lintPolicyRules(content, context),
    ...lintCommandContracts(content, context.contracts ?? {}, context)
  ];
}
