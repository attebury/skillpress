export const GENERATED_HEADER_START = "<!-- skillpress";
export const GENERATED_HEADER_END = "-->";

function parseFrontmatterBounds(text) {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) {
    return null;
  }
  const lines = text.split(/\r?\n/);
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "---") {
      return { end: lines.slice(0, index + 1).join("\n").length + 1 };
    }
  }
  return null;
}

function generatedHeaderRange(text) {
  if (text.startsWith(GENERATED_HEADER_START)) {
    const end = text.indexOf(GENERATED_HEADER_END);
    return end === -1 ? null : { start: 0, end: end + GENERATED_HEADER_END.length };
  }
  const frontmatter = parseFrontmatterBounds(text);
  if (!frontmatter) {
    return null;
  }
  const start = text.indexOf(GENERATED_HEADER_START, frontmatter.end);
  if (start === -1 || !/^\s*$/.test(text.slice(frontmatter.end, start))) {
    return null;
  }
  const end = text.indexOf(GENERATED_HEADER_END, start);
  return end === -1 ? null : { start, end: end + GENERATED_HEADER_END.length };
}

export function stripGeneratedHeader(content) {
  const text = String(content);
  const range = generatedHeaderRange(text);
  if (!range) {
    return text;
  }
  const before = text.slice(0, range.start);
  const after = text.slice(range.end);
  return `${before}${after.startsWith("\n") ? after.slice(1) : after}`;
}

export function generatedHeaderFields({ source, provider, generatedAt = new Date().toISOString() }) {
  return {
    source_path: source.source_path,
    source_hash: source.source_hash,
    skill_md_hash: source.skill_md_hash,
    source_tree_hash: source.source_tree_hash,
    generated_at: generatedAt,
    target: provider,
    tool: source.tool ?? "",
    skill: source.skill
  };
}

export function renderGeneratedHeader(fields) {
  return [
    GENERATED_HEADER_START,
    `source_path: ${fields.source_path}`,
    `source_hash: ${fields.source_hash}`,
    `skill_md_hash: ${fields.skill_md_hash}`,
    `source_tree_hash: ${fields.source_tree_hash}`,
    `generated_at: ${fields.generated_at}`,
    `target: ${fields.target}`,
    `tool: ${fields.tool}`,
    `skill: ${fields.skill}`,
    GENERATED_HEADER_END
  ].join("\n");
}

function skillBodyWithoutFrontmatter(content) {
  const text = stripGeneratedHeader(content);
  const frontmatter = parseFrontmatterBounds(text);
  if (!frontmatter) {
    return text;
  }
  return text.slice(frontmatter.end).replace(/^\s+/, "");
}

function yamlValue(value) {
  return JSON.stringify(String(value ?? ""));
}

export function renderCursorRule({ source, provider, generatedAt }) {
  const header = renderGeneratedHeader(generatedHeaderFields({ source, provider, generatedAt }));
  const frontmatter = source.frontmatter?.fields ?? {};
  const description = frontmatter.description ?? `Agent skill: ${source.skill}`;
  return [
    "---",
    `description: ${yamlValue(description)}`,
    "alwaysApply: false",
    "---",
    header,
    skillBodyWithoutFrontmatter(source.content)
  ].join("\n");
}

export function renderSkill({ source, provider, generatedAt }) {
  const body = stripGeneratedHeader(source.content);
  const header = renderGeneratedHeader(generatedHeaderFields({ source, provider, generatedAt }));
  return `${header}\n${body}`;
}

export function renderEntrypoint({ source, providerTarget, generatedAt }) {
  if (providerTarget.kind === "cursor-rule") {
    return renderCursorRule({ source, provider: providerTarget.id, generatedAt });
  }
  return renderSkill({ source, provider: providerTarget.id, generatedAt });
}

export function expectedEntrypointBody({ source, providerTarget }) {
  if (providerTarget.kind === "cursor-rule") {
    return stripGeneratedHeader(renderCursorRule({ source, provider: providerTarget.id, generatedAt: "" }));
  }
  return source.content;
}
