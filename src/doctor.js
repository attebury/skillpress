import { statusPacket } from "./status.js";

const SEVERITY_MAP = Object.freeze({
  error: "error",
  warning: "warning",
  info: "advisory"
});

export function doctorPacket(options = {}) {
  const status = statusPacket(options);
  const findings = status.issues.map((entry) => ({
    severity: SEVERITY_MAP[entry.severity] ?? "warning",
    code: entry.code,
    message: entry.message,
    skill: entry.skill ?? null,
    provider: entry.provider ?? null,
    path: entry.path ?? null
  }));
  const errors = findings.filter((entry) => entry.severity === "error").length;
  const warnings = findings.filter((entry) => entry.severity === "warning").length;
  return {
    ok: errors === 0,
    type: "skillpress_doctor",
    schema_version: 1,
    status: errors > 0 ? "fail" : warnings > 0 ? "degraded" : "pass",
    findings,
    summary: {
      total: findings.length,
      errors,
      warnings,
      advisories: findings.filter((entry) => entry.severity === "advisory").length
    },
    status_summary: status.summary,
    ...(options.provider || options.tool
      ? {
          filters: {
            provider: options.provider ?? null,
            tool: options.tool ?? null
          }
        }
      : {}),
    ...(status.config?.diagram?.telemetry ? { config: status.config } : {})
  };
}
