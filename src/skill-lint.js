const HEADER_START = "<!-- skillpress";
const HEADER_END = "-->";

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
