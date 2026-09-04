import { YUHUN_SUIT_IDS_BY_NAME } from "./mappings.js";

/** The version of the JSON target-template schema implemented by this module. */
export const TEMPLATE_SCHEMA_VERSION = 1 as const;
export const TEMPLATE_AXIS = "speed" as const;
export const TEMPLATE_METRIC = "speedSum" as const;

export const RISK_TIERS = ["tier0", "tier1"] as const;
export type RiskTier = (typeof RISK_TIERS)[number];

export interface TemplateSetRequirement {
  readonly suitIds: readonly number[];
  readonly count: number;
}

/**
 * Version 1 target template.
 *
 * `suitIds` contains the suit IDs accepted by one set requirement, while
 * `count` is the minimum number of equipped pieces satisfying that requirement.
 */
export interface YuhunTemplate {
  readonly version: typeof TEMPLATE_SCHEMA_VERSION;
  readonly id: string;
  readonly axis: typeof TEMPLATE_AXIS;
  readonly sets: readonly TemplateSetRequirement[];
  readonly metric: typeof TEMPLATE_METRIC;
  readonly riskTier: RiskTier;
}

/** Short aliases for callers that use the generic target-template terminology. */
export type Template = YuhunTemplate;
export type TargetTemplate = YuhunTemplate;

const TEMPLATE_KEYS = new Set(["version", "id", "axis", "sets", "metric", "riskTier"]);
const SET_REQUIREMENT_KEYS = new Set(["suitIds", "count"]);

type UnknownRecord = Record<string, unknown>;

function fail(path: string, message: string): never {
  throw new Error(`Invalid yuhun template at ${path}: ${message}`);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): UnknownRecord {
  if (!isRecord(value)) return fail(path, "expected an object");
  return value;
}

function requireExactKeys(record: UnknownRecord, allowed: ReadonlySet<string>, path: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) return fail(`${path}.${key}`, "unknown field");
  }
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      return fail(path, `missing field ${key}`);
    }
  }
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") return fail(path, "expected a string");
  return value;
}

function requireNonEmptyId(value: unknown, path: string): string {
  const id = requireString(value, path);
  if (id.length === 0 || id.trim() !== id) return fail(path, "expected a non-empty trimmed string");
  return id;
}

function requireInteger(value: unknown, path: string, minimum: number, maximum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    return fail(path, `expected an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function requireRiskTier(value: unknown, path: string): RiskTier {
  if (value !== "tier0" && value !== "tier1") return fail(path, "expected tier0 or tier1");
  return value;
}

function freezeTemplate(template: YuhunTemplate): YuhunTemplate {
  const sets = template.sets.map((requirement) => Object.freeze({
    suitIds: Object.freeze([...requirement.suitIds]),
    count: requirement.count
  }));
  return Object.freeze({
    version: template.version,
    id: template.id,
    axis: template.axis,
    sets: Object.freeze(sets),
    metric: template.metric,
    riskTier: template.riskTier
  });
}

/**
 * Validate and defensively copy a target template.
 *
 * The input is never mutated. The returned value and its nested arrays are
 * frozen, which prevents accidental changes to templates shared by reports.
 */
export function validateTemplate(value: unknown): YuhunTemplate {
  const record = requireRecord(value, "template");
  requireExactKeys(record, TEMPLATE_KEYS, "template");

  if (record.version !== TEMPLATE_SCHEMA_VERSION) {
    return fail("template.version", `expected ${TEMPLATE_SCHEMA_VERSION}`);
  }
  const id = requireNonEmptyId(record.id, "template.id");
  if (record.axis !== TEMPLATE_AXIS) return fail("template.axis", `expected ${TEMPLATE_AXIS}`);
  if (record.metric !== TEMPLATE_METRIC) return fail("template.metric", `expected ${TEMPLATE_METRIC}`);
  const riskTier = requireRiskTier(record.riskTier, "template.riskTier");

  if (!Array.isArray(record.sets)) return fail("template.sets", "expected an array");
  const sets: TemplateSetRequirement[] = [];
  for (const [index, rawRequirement] of record.sets.entries()) {
    const path = `template.sets[${index}]`;
    const requirement = requireRecord(rawRequirement, path);
    requireExactKeys(requirement, SET_REQUIREMENT_KEYS, path);
    if (!Array.isArray(requirement.suitIds) || requirement.suitIds.length === 0) {
      return fail(`${path}.suitIds`, "expected a non-empty array");
    }

    const suitIds: number[] = [];
    const seenSuitIds = new Set<number>();
    for (const [suitIndex, rawSuitId] of requirement.suitIds.entries()) {
      const suitId = requireInteger(rawSuitId, `${path}.suitIds[${suitIndex}]`, 1, Number.MAX_SAFE_INTEGER);
      if (seenSuitIds.has(suitId)) {
        return fail(`${path}.suitIds[${suitIndex}]`, "duplicate suit ID");
      }
      seenSuitIds.add(suitId);
      suitIds.push(suitId);
    }
    const count = requireInteger(requirement.count, `${path}.count`, 1, 6);
    sets.push({ suitIds, count });
  }

  return freezeTemplate({
    version: TEMPLATE_SCHEMA_VERSION,
    id,
    axis: TEMPLATE_AXIS,
    sets,
    metric: TEMPLATE_METRIC,
    riskTier
  });
}

/** Runtime type guard for untrusted JSON values. */
export function isTemplate(value: unknown): value is YuhunTemplate {
  try {
    validateTemplate(value);
    return true;
  } catch {
    return false;
  }
}

/** Validate a template without changing its value, for assertion-style callers. */
export function assertValidTemplate(value: unknown): asserts value is YuhunTemplate {
  validateTemplate(value);
}

export const ZHAOCAI_SUIT_ID = YUHUN_SUIT_IDS_BY_NAME.招财猫;

export const ZHAOCAI_SPEED_TEMPLATE = validateTemplate({
  version: TEMPLATE_SCHEMA_VERSION,
  id: "zhaocai-speed",
  axis: TEMPLATE_AXIS,
  sets: [{ suitIds: [ZHAOCAI_SUIT_ID], count: 4 }],
  metric: TEMPLATE_METRIC,
  // Tier 1 is the default user-facing risk tier in the project specification.
  riskTier: "tier1"
});

export const SCATTERED_SPEED_TEMPLATE = validateTemplate({
  version: TEMPLATE_SCHEMA_VERSION,
  id: "scattered-speed",
  axis: TEMPLATE_AXIS,
  sets: [],
  metric: TEMPLATE_METRIC,
  riskTier: "tier1"
});

/** The built-in templates in stable report/CLI order. */
export const BUILT_IN_TEMPLATES: readonly YuhunTemplate[] = Object.freeze([
  ZHAOCAI_SPEED_TEMPLATE,
  SCATTERED_SPEED_TEMPLATE
]);

// Common aliases retained for consumers that use a shorter naming convention.
export const ZHAOCAI_SPEED = ZHAOCAI_SPEED_TEMPLATE;
export const SCATTERED_SPEED = SCATTERED_SPEED_TEMPLATE;
export const BUILTIN_TEMPLATES = BUILT_IN_TEMPLATES;

function validateTemplateCollection(value: unknown): readonly YuhunTemplate[] {
  if (!Array.isArray(value)) return fail("templates", "expected an array");
  const templates = value.map((template, index) => {
    try {
      return validateTemplate(template);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(error.message.replace(/^Invalid yuhun template at /, `Invalid templates[${index}] at `));
      }
      throw error;
    }
  });
  const ids = new Set<string>();
  for (const template of templates) {
    if (ids.has(template.id)) return fail("templates", `duplicate template id ${template.id}`);
    ids.add(template.id);
  }
  return templates;
}

/** Find a template by its stable ID; unknown IDs return undefined. */
export function findTemplateById(
  id: string,
  templates: readonly YuhunTemplate[] = BUILT_IN_TEMPLATES
): YuhunTemplate | undefined {
  if (typeof id !== "string" || id.trim() !== id || id.length === 0) {
    return fail("id", "expected a non-empty trimmed string");
  }
  if (!Array.isArray(templates)) return fail("templates", "expected an array");
  // Validate caller-provided JSON at the boundary while preserving the object
  // identity returned from the supplied collection.
  validateTemplateCollection(templates);
  return templates.find((template) => template.id === id);
}

/** Look up a template and throw a useful error when the ID is unknown. */
export function getTemplateById(
  id: string,
  templates: readonly YuhunTemplate[] = BUILT_IN_TEMPLATES
): YuhunTemplate {
  const template = findTemplateById(id, templates);
  if (template === undefined) return fail("id", `unknown template ID ${id}`);
  return template;
}

/** Return a shallow copy of the built-in list so callers cannot alter its order. */
export function listTemplates(): YuhunTemplate[] {
  return [...BUILT_IN_TEMPLATES];
}

// Additional descriptive aliases for API users and older callers.
export const findTemplate = findTemplateById;
export const getTemplate = getTemplateById;
export const validateYuhunTemplate = validateTemplate;
export const parseTemplate = validateTemplate;
export const isValidTemplate = isTemplate;
