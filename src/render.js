export const GENERATED_HEADER_START = "<!-- skillpress";
export const GENERATED_HEADER_END = "-->";

export function stripGeneratedHeader(content) {
  const text = String(content);
  if (!text.startsWith(GENERATED_HEADER_START)) {
    return text;
  }
  const end = text.indexOf(GENERATED_HEADER_END);
  if (end === -1) {
    return text;
  }
  const after = text.slice(end + GENERATED_HEADER_END.length);
  return after.startsWith("\n") ? after.slice(1) : after;
}

export function generatedHeaderFields({ source, provider, generatedAt = new Date().toISOString() }) {
  return {
    source_path: source.source_path,
    source_hash: source.source_hash,
    generated_at: generatedAt,
    target: provider,
    tool: source.tool,
    skill: source.skill
  };
}

export function renderGeneratedHeader(fields) {
  return [
    GENERATED_HEADER_START,
    `source_path: ${fields.source_path}`,
    `source_hash: ${fields.source_hash}`,
    `generated_at: ${fields.generated_at}`,
    `target: ${fields.target}`,
    `tool: ${fields.tool}`,
    `skill: ${fields.skill}`,
    GENERATED_HEADER_END
  ].join("\n");
}

export function renderSkill({ source, provider, generatedAt }) {
  const body = stripGeneratedHeader(source.content);
  const header = renderGeneratedHeader(generatedHeaderFields({ source, provider, generatedAt }));
  return `${header}\n${body}`;
}
