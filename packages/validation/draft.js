import { createHash } from "node:crypto";
import { CONTRACT_VERSIONS } from "@brash-twin/contracts";

const IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SEVERITIES = new Set(["ERROR", "WARNING", "INFO"]);

export class DraftValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DraftValidationError";
    this.code = code;
  }
}

export class DraftValidatorRegistry {
  #rules;
  #descriptor;

  constructor({
    name = "brash-draft-validator",
    version = "0.1.0",
    rules = defaultDraftValidationRules(),
  } = {}) {
    requiredText(name, "name");
    requiredText(version, "version");
    if (!Array.isArray(rules) || rules.length === 0) {
      throw new DraftValidationError("VALIDATOR_RULES_REQUIRED", "At least one validation rule is required.");
    }
    const codes = new Set();
    this.#rules = rules.map((rule, index) => {
      if (!rule || typeof rule !== "object" || typeof rule.evaluate !== "function") {
        throw new DraftValidationError("VALIDATOR_RULE_INVALID", `rules[${index}] must provide evaluate().`);
      }
      issueCode(rule.code, `rules[${index}].code`);
      if (codes.has(rule.code)) {
        throw new DraftValidationError("VALIDATOR_RULE_DUPLICATE", `Rule ${rule.code} is declared more than once.`);
      }
      codes.add(rule.code);
      return Object.freeze({ code: rule.code, evaluate: rule.evaluate });
    });
    this.#descriptor = Object.freeze({
      name,
      version,
      configurationSha256: createHash("sha256")
        .update(JSON.stringify({ name, version, rules: [...codes].sort() }))
        .digest("hex"),
    });
  }

  get descriptor() {
    return this.#descriptor;
  }

  evaluate(snapshot) {
    validateSnapshot(snapshot);
    const issues = [];
    for (const rule of this.#rules) {
      const emitted = rule.evaluate(snapshot);
      if (emitted === undefined || emitted === null) continue;
      if (!Array.isArray(emitted)) {
        throw new DraftValidationError("VALIDATOR_RESULT_INVALID", `Rule ${rule.code} must return an array.`);
      }
      for (const candidate of emitted) issues.push(normalizeIssue(rule.code, candidate));
    }
    return issues;
  }
}

export function createDraftValidationReport({
  reportId,
  jobId,
  draft,
  artifacts,
  registry,
  startedAt,
  completedAt,
}) {
  identifier(reportId, "reportId");
  identifier(jobId, "jobId");
  if (!(registry instanceof DraftValidatorRegistry)) {
    throw new DraftValidationError("VALIDATOR_REGISTRY_REQUIRED", "A DraftValidatorRegistry is required.");
  }
  const snapshot = Object.freeze({ draft: structuredClone(draft), artifacts: structuredClone(artifacts) });
  const candidates = registry.evaluate(snapshot);
  const issues = candidates.map((candidate, index) => Object.freeze({
    issueId: `${jobId}-issue-${index + 1}`,
    ...candidate,
  }));
  const summary = Object.freeze({
    errorCount: issues.filter((issue) => issue.severity === "ERROR").length,
    warningCount: issues.filter((issue) => issue.severity === "WARNING").length,
    infoCount: issues.filter((issue) => issue.severity === "INFO").length,
  });
  return Object.freeze({
    schemaVersion: CONTRACT_VERSIONS.draftValidationReport,
    reportId,
    jobId,
    draftId: draft.draftId,
    canonicalFrameId: draft.canonicalFrameId,
    validator: registry.descriptor,
    inputs: Object.freeze(artifacts.map((artifact) => Object.freeze({
      bindingId: artifact.bindingId,
      artifactSha256: artifact.artifactSha256,
      role: artifact.role,
      ...(artifact.reviewDecision === undefined ? {} : { reviewDecision: artifact.reviewDecision }),
    }))),
    startedAt: iso(startedAt, "startedAt"),
    completedAt: iso(completedAt, "completedAt"),
    outcome: summary.errorCount === 0 ? "PASSED" : "FAILED",
    summary,
    issues: Object.freeze(issues),
  });
}

export function serializeDraftValidationReport(report) {
  if (!report || report.schemaVersion !== CONTRACT_VERSIONS.draftValidationReport) {
    throw new DraftValidationError("VALIDATION_REPORT_INVALID", "A v2 draft validation report is required.");
  }
  return Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export function defaultDraftValidationRules() {
  return [
    rule("DRAFT_INPUT_REQUIRED", ({ artifacts }) => artifacts.length === 0 ? [{
      severity: "ERROR",
      message: "The draft has no artifacts to validate.",
      location: null,
    }] : []),
    rule("SOURCE_ARTIFACT_REQUIRED", ({ artifacts }) => artifacts.some((artifact) => artifact.kind === "SOURCE") ? [] : [{
      severity: "ERROR",
      message: "The draft requires at least one source artifact.",
      location: null,
    }]),
    rule("VALIDATION_REPORT_INPUT_FORBIDDEN", ({ artifacts }) => artifacts
      .filter((artifact) => artifact.role === "VALIDATION_REPORT")
      .map((artifact) => ({
        severity: "ERROR",
        message: "A validation report cannot validate another validation report.",
        location: artifactLocation(artifact),
      }))),
    rule("ARTIFACT_IDENTITY_DUPLICATE", ({ artifacts }) => duplicateIssues(artifacts)),
    rule("SOURCE_PROVENANCE_INVALID", ({ artifacts }) => artifacts
      .filter((artifact) => artifact.kind === "SOURCE"
        && (artifact.inputBindings.length > 0 || artifact.producer !== null))
      .map((artifact) => ({
        severity: "ERROR",
        message: "Source artifact provenance must not declare inputs or a producer.",
        location: artifactLocation(artifact),
      }))),
    rule("DERIVED_PROVENANCE_INVALID", ({ artifacts }) => derivedProvenanceIssues(artifacts)),
    rule("REGISTRATION_APPROVAL_REQUIRED", ({ artifacts }) => registrationApprovalIssues(artifacts)),
    rule("CANONICAL_FRAME_UNUSED", ({ draft, artifacts }) => artifacts
      .some((artifact) => artifact.coordinateFrameId === draft.canonicalFrameId) ? [] : [{
        severity: "WARNING",
        message: `No spatial artifact is directly expressed in canonical frame ${draft.canonicalFrameId}.`,
        location: { coordinateFrameId: draft.canonicalFrameId, jsonPointer: "" },
      }]),
  ];
}

function registrationApprovalIssues(artifacts) {
  const approvalsByReport = new Map();
  const approvedAcceptanceBindings = new Set();
  for (const acceptance of artifacts.filter((artifact) => artifact.role === "REGISTRATION_ACCEPTANCE")) {
    const input = acceptance.inputBindings.length === 1 ? acceptance.inputBindings[0] : null;
    if (!input || acceptance.reviewDecision !== "APPROVED") continue;
    approvalsByReport.set(input.bindingId, input.artifactSha256);
    approvedAcceptanceBindings.add(acceptance.bindingId);
  }
  const issues = artifacts.filter((artifact) => artifact.role === "REGISTRATION_REPORT")
    .filter((report) => approvalsByReport.get(report.bindingId) !== report.artifactSha256)
    .map((report) => ({
      severity: "ERROR",
      message: "Registered survey evidence requires an immutable APPROVED registration acceptance before validation can pass.",
      location: artifactLocation(report),
    }));
  for (const artifact of artifacts.filter((candidate) => [
    "REGISTERED_POINT_CLOUD",
    "ASSET_CANDIDATE_REPORT",
  ].includes(candidate.role))) {
    if (artifact.inputBindings.some((input) => approvedAcceptanceBindings.has(input.bindingId))) continue;
    issues.push({
      severity: "ERROR",
      message: `${artifact.role} must directly reference a content-verified APPROVED registration acceptance.`,
      location: artifactLocation(artifact),
    });
  }
  return issues;
}

function derivedProvenanceIssues(artifacts) {
  const byId = new Map(artifacts.map((artifact) => [artifact.bindingId, artifact]));
  const issues = [];
  for (const artifact of artifacts.filter((candidate) => candidate.kind === "DERIVED")) {
    if (artifact.inputBindings.length === 0 || artifact.producer === null) {
      issues.push({
        severity: "ERROR",
        message: "Derived artifact provenance requires inputs and a producer.",
        location: artifactLocation(artifact),
      });
      continue;
    }
    for (const input of artifact.inputBindings) {
      const stored = byId.get(input.bindingId);
      if (!stored || stored.artifactSha256 !== input.artifactSha256) {
        issues.push({
          severity: "ERROR",
          message: `Derived input ${input.bindingId} is missing or has a different content identity.`,
          location: artifactLocation(artifact),
        });
      }
    }
  }
  return issues;
}

function duplicateIssues(artifacts) {
  const seen = new Set();
  const issues = [];
  for (const artifact of artifacts) {
    const key = `${artifact.role}\0${artifact.artifactSha256}`;
    if (seen.has(key)) {
      issues.push({
        severity: "ERROR",
        message: `Artifact ${artifact.artifactSha256} is bound more than once as ${artifact.role}.`,
        location: artifactLocation(artifact),
      });
    }
    seen.add(key);
  }
  return issues;
}

function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || !snapshot.draft || !Array.isArray(snapshot.artifacts)) {
    throw new DraftValidationError("VALIDATION_SNAPSHOT_INVALID", "Draft and artifact snapshot data are required.");
  }
  identifier(snapshot.draft.draftId, "draft.draftId");
  requiredText(snapshot.draft.canonicalFrameId, "draft.canonicalFrameId");
  for (const [index, artifact] of snapshot.artifacts.entries()) {
    identifier(artifact.bindingId, `artifacts[${index}].bindingId`);
    if (!SHA256.test(artifact.artifactSha256)) {
      throw new DraftValidationError("VALIDATION_ARTIFACT_INVALID", `artifacts[${index}] has an invalid SHA-256.`);
    }
    requiredText(artifact.role, `artifacts[${index}].role`);
    if (artifact.reviewDecision !== undefined
      && !["APPROVED", "REJECTED", "INVALID"].includes(artifact.reviewDecision)) {
      throw new DraftValidationError("VALIDATION_ARTIFACT_INVALID", `artifacts[${index}] has an invalid review decision.`);
    }
    if (!["SOURCE", "DERIVED"].includes(artifact.kind)
      || !Array.isArray(artifact.inputBindings)) {
      throw new DraftValidationError("VALIDATION_ARTIFACT_INVALID", `artifacts[${index}] is malformed.`);
    }
  }
  if (snapshot.artifacts.length > 100) {
    throw new DraftValidationError("VALIDATION_INPUT_LIMIT", "A validation snapshot may contain at most 100 artifacts.");
  }
}

function normalizeIssue(defaultCode, candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new DraftValidationError("VALIDATOR_ISSUE_INVALID", `Rule ${defaultCode} emitted an invalid issue.`);
  }
  const code = candidate.code ?? defaultCode;
  issueCode(code, "issue.code");
  if (!SEVERITIES.has(candidate.severity)) {
    throw new DraftValidationError("VALIDATOR_ISSUE_INVALID", `Rule ${defaultCode} emitted an invalid severity.`);
  }
  requiredText(candidate.message, "issue.message");
  return Object.freeze({
    code,
    severity: candidate.severity,
    message: candidate.message,
    location: normalizeLocation(candidate.location),
  });
}

function normalizeLocation(location) {
  if (location === null || location === undefined) return null;
  if (typeof location !== "object" || Array.isArray(location)) {
    throw new DraftValidationError("VALIDATOR_LOCATION_INVALID", "Issue location must be an object or null.");
  }
  const allowed = ["artifactBindingId", "coordinateFrameId", "jsonPointer", "position", "boundsMinimum", "boundsMaximum"];
  const unsupported = Object.keys(location).filter((field) => !allowed.includes(field));
  if (unsupported.length > 0) {
    throw new DraftValidationError("VALIDATOR_LOCATION_INVALID", `Unsupported location fields: ${unsupported.join(", ")}.`);
  }
  if (location.artifactBindingId !== undefined) identifier(location.artifactBindingId, "location.artifactBindingId");
  if (location.coordinateFrameId !== undefined) requiredText(location.coordinateFrameId, "location.coordinateFrameId");
  if (location.jsonPointer !== undefined
    && (typeof location.jsonPointer !== "string" || !/^(?:|\/.*)$/.test(location.jsonPointer))) {
    throw new DraftValidationError("VALIDATOR_LOCATION_INVALID", "location.jsonPointer must be empty or start with '/'.");
  }
  for (const field of ["position", "boundsMinimum", "boundsMaximum"]) {
    if (location[field] !== undefined && !vector3(location[field])) {
      throw new DraftValidationError("VALIDATOR_LOCATION_INVALID", `location.${field} must contain three finite numbers.`);
    }
  }
  return Object.freeze(structuredClone(location));
}

function artifactLocation(artifact) {
  return {
    artifactBindingId: artifact.bindingId,
    ...(artifact.coordinateFrameId === null ? {} : { coordinateFrameId: artifact.coordinateFrameId }),
    jsonPointer: "",
  };
}

function rule(code, evaluate) {
  return Object.freeze({ code, evaluate });
}

function identifier(value, field) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new DraftValidationError("VALIDATION_IDENTIFIER_INVALID", `${field} must be a lowercase kebab-case identifier.`);
  }
}

function requiredText(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new DraftValidationError("VALIDATION_FIELD_REQUIRED", `${field} is required.`);
  }
}

function issueCode(value, field) {
  if (typeof value !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(value)) {
    throw new DraftValidationError("VALIDATOR_CODE_INVALID", `${field} must be an uppercase issue code.`);
  }
}

function iso(value, field) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new DraftValidationError("VALIDATION_DATE_INVALID", `${field} is invalid.`);
  return date.toISOString();
}

function vector3(value) {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}
