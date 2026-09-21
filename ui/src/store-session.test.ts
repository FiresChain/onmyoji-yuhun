import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, disposePinia, setActivePinia, type Pinia } from "pinia";
import { createHash } from "node:crypto";
import { YuhunWorkflow, filterShareFromDraft, type TeamCalculationReportDTO, type YuhunFilterShare } from "../../src/browser.js";
import type { StoredWorkbenchSessionV1, WorkbenchSessionV1 } from "./persistence.js";
import { useWorkbenchStore } from "./store.js";
import { exportPlanFile, parsePlanFile, type SavedPlan } from "./plan-library.js";

const persistence = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), plans: vi.fn(), putPlan: vi.fn(), deletePlan: vi.fn() }));
const api = vi.hoisted(() => ({ decode: vi.fn(), encode: vi.fn() }));
vi.mock("./persistence.js", async importOriginal => ({
  ...await importOriginal<typeof import("./persistence.js")>(),
  loadWorkbenchSession: persistence.load,
  saveWorkbenchSession: persistence.save,
  loadSavedPlans: persistence.plans,
  persistSavedPlan: persistence.putPlan,
  deleteSavedPlan: persistence.deletePlan
}));
vi.mock("./onmyoji-api.js", async importOriginal => ({
  ...await importOriginal<typeof import("./onmyoji-api.js")>(),
  decodeYuhunCode: api.decode,
  encodeYuhunDraft: api.encode
}));
// Keep real analysis and preview behavior, replacing only the Worker transport.
vi.mock("./worker/client.js", async importOriginal => {
  const actual = await importOriginal<typeof import("./worker/client.js")>();
  const { YuhunWorkflow } = await import("../../src/browser.js");
  return { ...actual, WorkflowClient: class {
    workflow = new YuhunWorkflow();
    importSnapshot(buffer: ArrayBuffer) { return this.workflow.importSnapshot(JSON.parse(new TextDecoder().decode(buffer)), createHash("sha256").update(new Uint8Array(buffer)).digest("hex")); }
    analyze = (...args: Parameters<YuhunWorkflow["analyze"]>) => this.workflow.analyze(...args);
    queryInventory = (...args: Parameters<YuhunWorkflow["queryInventory"]>) => this.workflow.queryInventory(...args);
    queryYuhunDetails = (...args: Parameters<YuhunWorkflow["queryYuhunDetails"]>) => this.workflow.queryYuhunDetails(...args);
    queryDecisions = (...args: Parameters<YuhunWorkflow["queryDecisions"]>) => this.workflow.queryDecisions(...args);
    queryYuhunDecisions = (...args: Parameters<YuhunWorkflow["queryYuhunDecisions"]>) => this.workflow.queryYuhunDecisions(...args);
    queryYuhunDecisionFacets = () => this.workflow.queryYuhunDecisionFacets();
    generatePlan = (...args: Parameters<YuhunWorkflow["generatePlan"]>) => this.workflow.generatePlan(...args);
    buildImportChecklist = () => this.workflow.buildImportChecklist();
    getGateState = () => this.workflow.getGateState();
    resetTeamCalculations() {}
    comparePlans = (...args: Parameters<YuhunWorkflow["comparePlans"]>) => this.workflow.comparePlans(...args);
  } };
});

const headerHex = "12".repeat(16);
const policy = { id: "test", confirmed: true, protectedSuitIds: [], retainInitialCountsBelowFour: false, retainedMainStats: [], retainedIntrinsicStats: [], fourLineSubStatCombinations: [] };
let saved: StoredWorkbenchSessionV1;
let savedLibrary: SavedPlan[];
let pinia: Pinia;
function newStore() {
  if (pinia) disposePinia(pinia);
  vi.clearAllTimers();
  pinia = createPinia();
  setActivePinia(pinia);
  return useWorkbenchStore();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  savedLibrary = [];
  persistence.plans.mockImplementation(async () => structuredClone(savedLibrary));
  persistence.putPlan.mockImplementation(async (plan: SavedPlan) => { savedLibrary = [...savedLibrary.filter(entry => entry.id !== plan.id), structuredClone(plan)]; });
  persistence.deletePlan.mockImplementation(async (id: string) => { savedLibrary = savedLibrary.filter(entry => entry.id !== id); });
  const json = { version: "test", timestamp: "test", data: { hero_equips: [{ id: "synthetic", equip_id: 1, suit_id: 300010, pos: 1, quality: 6, level: 0, born: 0, lock: false, garbage: false, base_attr: { type: "Speed", value: 12 }, attrs: [], random_attrs: [], random_attr_rates: [], single_attrs: [] }] } };
  const original = json.data.hero_equips[0]!;
  json.data.hero_equips = [
    ...Array.from({ length: 501 }, (_, i) => ({ ...original, id: `drop-${i}` })),
    ...Array.from({ length: 5499 }, (_, i) => ({ ...original, id: `locked-${i}`, lock: true }))
  ];
  const snapshotBuffer = new TextEncoder().encode(JSON.stringify(json)).buffer;
  const workflow = new YuhunWorkflow();
  const snapshotSummary = workflow.importSnapshot(json, createHash("sha256").update(new Uint8Array(snapshotBuffer)).digest("hex"));
  const analysis = workflow.analyze({ templateIds: [], riskTier: "tier1", defaultDisposition: "discard" });
  saved = { snapshotBuffer, session: {
    schemaVersion: 1, kind: "onmyoji-yuhun-workbench-session", containsAccountDerivedData: true, doNotCommit: true,
    savedAt: "test", snapshotSha256: snapshotSummary.sha256, snapshotSummary,
    settings: { templateIds: [], riskTier: "tier1", defaultDisposition: "discard", budgetPerTenThousand: 1, staticPolicy: policy, existingFilterCode: "" },
    teamTargets: [], presetRules: [], inventory: null, analysis, decisions: null, teamCalculations: [],
    plan: null, simulation: null, checklist: null, actuals: {}, gateState: {}, viewState: null
  } };
  persistence.load.mockImplementation(async () => structuredClone(saved));
  persistence.save.mockImplementation(async (session: WorkbenchSessionV1) => { saved = { ...saved, session: structuredClone(session) }; });
  const shares = new Map<string, YuhunFilterShare>([["source", filterShareFromDraft({ headerHex, planKind: "discard", groups: [] })]]);
  api.decode.mockImplementation(async (code: string) => shares.get(code));
  api.encode.mockImplementation(async draft => {
    const share = filterShareFromDraft({ ...draft, headerHex: draft.id ?? draft.headerHex ?? headerHex });
    const yuhunCode = `synthetic-${shares.size}`;
    shares.set(yuhunCode, share);
    return { yuhunCode, share };
  });
});
afterEach(() => { disposePinia(pinia); vi.clearAllTimers(); vi.useRealTimers(); });

function legacyEquippedReport() {
  const json = JSON.parse(new TextDecoder().decode(saved.snapshotBuffer));
  for (let index = 0; index < 12; index++) {
    const item = json.data.hero_equips[index];
    item.pos = index % 6;
    item.level = 15;
    item.base_attr = { type: "Attack", value: 486 };
    item.attrs = item.random_attrs = [{ type: "Speed", value: 3 + index }, { type: "CritRate", value: .1 }];
  }
  const snapshotBuffer = new TextEncoder().encode(JSON.stringify(json)).buffer;
  const workflow = new YuhunWorkflow();
  const snapshotSummary = workflow.importSnapshot(json, createHash("sha256").update(new Uint8Array(snapshotBuffer)).digest("hex"));
  // Inventory order differs from equipment order. Both shikigami use pieces
  // with identical suit/slot metadata but different substats.
  const reservedYuhunIds = Array.from({ length: 12 }, (_, index) => `drop-${(index + 6) % 12}`);
  const details = new Map(workflow.queryYuhunDetails(reservedYuhunIds).map(item => [item.yuhunId, item]));
  const expected = reservedYuhunIds.map(id => details.get(id)!);
  const pieces = expected.map(({ yuhunId, mainValue, subStats, intrinsicStats, ...piece }) => piece);
  const report: TeamCalculationReportDTO = {
    id: "legacy", label: "旧计算结果", scope: "ordered-dynamic-bounds", successfulCount: 2, unsupportedCount: 0, reservedYuhunIds,
    entities: [0, 1, 2].map(entityIndex => ({
      entityIndex, shikigamiId: 591, shikigamiName: "雪御前", metricId: 1, metricName: "伤害输出",
      status: entityIndex === 1 ? "no-match" : "success", message: "", score: entityIndex === 1 ? null : 20478.02, panel: null,
      pieces: entityIndex === 1 ? [] : pieces.slice(entityIndex === 0 ? 0 : 6, entityIndex === 0 ? 6 : 12),
      exact: false, candidateCount: 12, candidateCombinations: 64, evaluatedCombinations: 64, constraints: [], targetScoreRaw: null
    }))
  };
  saved = { snapshotBuffer, session: { ...saved.session, snapshotSummary, snapshotSha256: snapshotSummary.sha256, teamCalculations: [report] } };
  return { report, expected };
}

describe("equipped yuhun session compatibility", () => {
  it("restores pre-ID equipment stats in reservation order without changing calculation results", async () => {
    const { report, expected } = legacyEquippedReport();
    const store = newStore();
    await store.restoreLocalSession();
    expect(store.error).toBeNull();
    expect(store.teamCalculations[0]?.entities.flatMap(entity => entity.pieces)).toEqual(expected);
    expect(store.teamCalculations[0]?.entities.map(({ pieces, ...entity }) => entity)).toEqual(report.entities.map(({ pieces, ...entity }) => entity));
    expect(report.entities[0]?.pieces[0]?.mainValue).toBeUndefined();
  });

  it("fills missing substats when an existing piece already has its ID and main value", async () => {
    const { report, expected } = legacyEquippedReport();
    saved = { ...saved, session: { ...saved.session, teamCalculations: [{ ...report, reservedYuhunIds: [], entities: report.entities.map(entity => ({
      ...entity,
      pieces: entity.pieces.map(piece => {
        const detail = expected[(entity.entityIndex === 0 ? 0 : 6) + piece.position - 1]!;
        return { ...piece, yuhunId: detail.yuhunId, mainValue: detail.mainValue };
      })
    })) }] } };
    const store = newStore();
    await store.restoreLocalSession();
    expect(store.error).toBeNull();
    expect(store.teamCalculations[0]?.entities.flatMap(entity => entity.pieces)).toEqual(expected);
  });

  it("does not guess equipment from same-suit inventory when the reservation mapping is incomplete", async () => {
    const { report } = legacyEquippedReport();
    const incomplete = { ...report, reservedYuhunIds: report.reservedYuhunIds!.slice(1) };
    saved = { ...saved, session: { ...saved.session, teamCalculations: [incomplete] } };
    const store = newStore();
    await store.restoreLocalSession();
    expect(store.error).toBeNull();
    expect(store.teamCalculations).toEqual([incomplete]);
  });
});

describe("dual-code session persistence", () => {
  it("saves both imported codes as one plan and compares their combined discard and rescue behavior", async () => {
    const json = JSON.parse(new TextDecoder().decode(saved.snapshotBuffer));
    for (const item of json.data.hero_equips.slice(0, 100)) item.garbage = true;
    for (const item of json.data.hero_equips.slice(0, 200)) item.level = 15;
    const snapshotBuffer = new TextEncoder().encode(JSON.stringify(json)).buffer;
    const snapshotSummary = new YuhunWorkflow().importSnapshot(json, createHash("sha256").update(new Uint8Array(snapshotBuffer)).digest("hex"));
    saved = { snapshotBuffer, session: { ...saved.session, snapshotSummary, snapshotSha256: snapshotSummary.sha256, analysis: null } };
    const store = newStore();
    await store.restoreLocalSession();
    const unchanged = await store.importSavedPlan({ name: "原始状态", discardCode: null, rescueCode: null }, true);
    api.decode.mockResolvedValueOnce(filterShareFromDraft({ headerHex, planKind: "discard", groups: [{ name: "六星", criteria: { stars: [6] } }] }));
    api.decode.mockResolvedValueOnce(filterShareFromDraft({ headerHex, planKind: "enhance", groups: [{ name: "满级", criteria: { levelRanges: ["15"] } }] }));
    const imported = await store.importSavedPlan({ name: "双码方案", discardCode: " discard\n", rescueCode: " rescue\n" });
    expect(imported.discardCode).toBe("discard");
    expect(imported.rescueCode).toBe("rescue");
    store.comparisonBaseId = unchanged.id;
    store.comparisonNextId = imported.id;
    const result = await store.compareSavedPlans({});
    expect(result.total).toBe(401);
    expect(result.counts["extra-discard"]).toBe(301);
    expect(result.counts["extra-retain"]).toBe(100);
    expect(result.rows.every(row => !row.locked)).toBe(true);
    expect(api.decode).toHaveBeenCalledTimes(2);
    const restored = newStore();
    await restored.loadPlanLibrary();
    expect(restored.savedPlans).toHaveLength(2);
    expect(restored.savedPlans.find(plan => plan.id === imported.id)).toEqual(imported);
  });
  it("does not save either code when the imported pair has mismatched user IDs", async () => {
    const store = newStore();
    api.decode.mockResolvedValueOnce(filterShareFromDraft({ headerHex, planKind: "discard", groups: [{ name: "六星", criteria: { stars: [6] } }] }));
    api.decode.mockResolvedValueOnce(filterShareFromDraft({ headerHex: "34".repeat(16), planKind: "enhance", groups: [{ name: "满级", criteria: { levelRanges: ["15"] } }] }));
    await expect(store.importSavedPlan({ name: "无效组合", discardCode: "discard", rescueCode: "rescue" })).rejects.toThrow("用户 ID 不一致");
    expect(persistence.putPlan).not.toHaveBeenCalled();
    expect(store.savedPlans).toEqual([]);
    expect(savedLibrary).toEqual([]);
    expect(store.planLibraryBusy).toBe(false);
  });
  it("saves plans independently, imports exported codes, compares, renames and deletes", async () => {
    const store = newStore();
    await store.restoreLocalSession();
    await store.generatePlan();
    const entry = await store.saveCurrentPlan("基准");
    const file = parsePlanFile(exportPlanFile(entry));
    const imported = await store.importSavedPlan(file);
    expect(imported.criteria).toEqual(entry.criteria);
    const result = await store.compareSavedPlans({});
    expect(result.total).toBe(0);
    expect(result.counts["both-discard"]).toBe(501);
    expect(result.counts["both-retain"]).toBe(5499);
    store.setDesiredFreeSlots(0);
    expect(store.plan).toBeNull();
    await store.generatePlan();
    const empty = await store.saveCurrentPlan("全部保留");
    expect(empty.criteria.discard).toEqual([]);
    const diff = await store.compareSavedPlans({});
    expect(diff.counts["extra-retain"]).toBe(501);
    await store.renameSavedPlan(entry.id, "原方案");
    const restored = newStore();
    await restored.restoreLocalSession();
    await restored.loadPlanLibrary();
    expect(restored.savedPlans).toHaveLength(3);
    expect(restored.savedPlans.find(plan => plan.id === entry.id)?.name).toBe("原方案");
    restored.comparisonBaseId = entry.id;
    restored.comparisonNextId = imported.id;
    await restored.removeSavedPlan(imported.id);
    expect(restored.comparisonBaseId).toBe(entry.id);
    expect(restored.comparisonNextId).toBe("");
    expect(savedLibrary).toHaveLength(2);
  });
  it("keeps the library unchanged when storage or imported code validation fails", async () => {
    const store = newStore();
    await store.restoreLocalSession();
    await store.generatePlan();
    persistence.putPlan.mockRejectedValueOnce(new Error("存储失败"));
    await expect(store.saveCurrentPlan("未保存")).rejects.toThrow("存储失败");
    expect(store.savedPlans).toEqual([]);
    expect(store.planLibraryBusy).toBe(false);
    const wrong = filterShareFromDraft({ headerHex, planKind: "enhance", groups: [{ name: "test", criteria: {} }] });
    api.decode.mockResolvedValueOnce(wrong);
    await expect(store.importSavedPlan({ name: "类型错误", discardCode: "bad", rescueCode: null })).rejects.toThrow("类型不正确");
    expect(store.savedPlans).toEqual([]);
    expect(() => parsePlanFile({ schemaVersion: 2, kind: "onmyoji-yuhun-plan" })).toThrow("格式无效");
  });
  it("saves the imported user ID across stores and sends it to the encoder", async () => {
    const store = newStore();
    await store.restoreLocalSession();
    await store.generatePlan();
    const analysis = store.analysis;
    await store.importYuhunUserId("source");
    expect(store.yuhunUserId).toBe(headerHex);
    expect(store.analysis).toBe(analysis);
    expect(store.plan).toBeNull();
    expect(saved.session.plan).toBeNull();
    const restored = newStore();
    await restored.restoreLocalSession();
    expect(restored.yuhunUserId).toBe(headerHex);
    await restored.generatePlan();
    expect(restored.error).toBeNull();
    expect(api.encode.mock.lastCall?.[0].id).toBe(headerHex);
    expect(restored.copyAllowed).toBe(true);
    api.encode.mockImplementationOnce(async draft => ({
      yuhunCode: "wrong-id", share: filterShareFromDraft({ ...draft, headerHex: "34".repeat(16) })
    }));
    await restored.generatePlan();
    expect(restored.error?.message).toContain("ID 与设置不一致");
    expect(restored.copyAllowed).toBe(false);
  });
  it("rejects an invalid ID without replacing the saved ID or completed plan", async () => {
    const store = newStore();
    await store.restoreLocalSession();
    await store.importYuhunUserId("source");
    await store.generatePlan();
    const plan = store.plan;
    api.decode.mockResolvedValueOnce({ headerHex: "invalid" });
    await expect(store.importYuhunUserId("invalid-code")).rejects.toThrow("有效");
    expect(store.yuhunUserId).toBe(headerHex);
    expect(store.plan).toBe(plan);
    expect(store.busy).toBeNull();
  });
  it("preserves manual view preferences and resets to all scenes and smart selection", async () => {
    const store = newStore();
    await store.restoreLocalSession();
    const catalog = [{ id: "custom-d", label: "domain", categories: [{ id: "custom-c", label: "category", scenes: [{ id: "custom-s1", label: "one" }, { id: "custom-s2", label: "two" }] }] }];
    store.setTargetViewState(catalog, [], "custom-s1", catalog, "manual", 2);
    await vi.advanceTimersByTimeAsync(150);
    const restored = newStore();
    await restored.restoreLocalSession();
    expect(restored.targetViewState?.selectedSceneIds).toEqual([]);
    expect(restored.targetViewState?.teamSelectionMode).toBe("manual");
    expect(restored.targetViewState?.smartDifficultyDecreaseCount).toBe(2);
    restored.targetCatalog = catalog;
    await restored.generatePlan();
    restored.resetTeamCalculations();
    expect(restored.analysis).toBeNull();
    expect(restored.plan).toBeNull();
    expect(restored.targetViewState?.selectedSceneIds).toEqual(["custom-s1", "custom-s2"]);
    expect(restored.targetViewState?.teamSelectionMode).toBe("smart");
    expect(restored.targetViewState?.smartDifficultyDecreaseCount).toBe("auto");
  });
  it("defaults to 500, persists the capacity target and clears only the generated plan on changes", async () => {
    const store = newStore();
    await store.restoreLocalSession();
    expect(store.desiredFreeSlots).toBe(500);
    expect(store.desiredFreeSlotsMaximum).toBe(500);
    expect(store.requiredReleaseForTarget).toBe(500);
    await store.generatePlan();
    const analysis = store.analysis;
    store.actuals = { "discard-normal:0": "501" };
    store.setDesiredFreeSlots(300);
    expect(store.analysis).toBe(analysis);
    expect(store.plan).toBeNull();
    expect(store.actuals).toEqual({});
    expect(store.copyAllowed).toBe(false);
    await vi.advanceTimersByTimeAsync(150);
    expect(saved.session.settings.desiredFreeSlots).toBe(300);
    const restored = newStore();
    await restored.restoreLocalSession();
    expect(restored.desiredFreeSlots).toBe(300);
    restored.setDesiredFreeSlots(2000);
    expect(restored.desiredFreeSlots).toBe(500);
    restored.setDesiredFreeSlots(0);
    await restored.generatePlan();
    expect(restored.plan?.desiredFreeSlotsReached).toBe(true);
    expect(restored.plan?.discardCode).toBeNull();
  });
  it("persists impact allowance, invalidates codes and defaults legacy sessions to zero", async () => {
    const store = newStore();
    await store.restoreLocalSession();
    expect(store.retainedImpactPercent).toBe(0);
    await store.generatePlan();
    const analysis = store.analysis;
    store.setRetainedImpactPercent(2.5);
    expect(store.analysis).toBe(analysis);
    expect(store.plan).toBeNull();
    expect(store.copyAllowed).toBe(false);
    await vi.advanceTimersByTimeAsync(150);
    expect(saved.session.settings.retainedImpactPercent).toBe(2.5);
    const restored = newStore();
    await restored.restoreLocalSession();
    expect(restored.retainedImpactPercent).toBe(2.5);
    await restored.generatePlan();
    expect(restored.plan?.retentionImpact?.percent).toBe(2.5);
    expect(restored.plan?.retentionImpact?.affectedItems).toEqual([]);
    expect(restored.copyAllowed).toBe(true);
    await vi.advanceTimersByTimeAsync(150);
    const reopened = newStore();
    await reopened.restoreLocalSession();
    expect(reopened.plan?.retentionImpact?.percent).toBe(2.5);
    reopened.setRetainedImpactPercent(0);
    expect(reopened.plan).toBeNull();
  });
  it("makes startup and route guards await the same restoration", async () => {
    const store = newStore();
    let finishLoad!: (value: StoredWorkbenchSessionV1) => void;
    persistence.load.mockImplementationOnce(() => new Promise(resolve => { finishLoad = resolve; }));
    const startup = store.restoreLocalSession();
    const navigation = store.restoreLocalSession();
    let navigated = false;
    void navigation.then(() => { navigated = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(navigated).toBe(false);
    expect(store.restoreCompleted).toBe(false);
    finishLoad(structuredClone(saved));
    await Promise.all([startup, navigation]);
    expect(store.restoreCompleted).toBe(true);
    expect(store.snapshot).not.toBeNull();
    expect(store.analysis).not.toBeNull();
    expect(persistence.load).toHaveBeenCalledTimes(1);
  });
  it("saves completed generation and restores codes, gates, criteria and hits without codec calls", async () => {
    const first = newStore();
    await first.restoreLocalSession();
    await first.generatePlan();
    expect(first.error).toBeNull();
    expect(first.plan?.discardCode).toBeTruthy();
    expect(api.encode.mock.calls[0]![0]).not.toHaveProperty("headerHex");
    expect(api.encode.mock.calls[0]![0]).not.toHaveProperty("id");
    expect(api.decode.mock.calls.every(([code]) => code !== "source")).toBe(true);
    expect(first.copyAllowed).toBe(true);
    expect(saved.session.plan).toEqual(first.plan);
    expect(saved.session.gateState).toEqual(first.gateState);
    const plan = saved.session.plan;
    const checklist = saved.session.checklist;
    saved = { ...saved, session: { ...saved.session, actuals: { "discard-normal:0": "1" } } };
    api.decode.mockClear(); api.encode.mockClear();
    const restored = newStore();
    await restored.restoreLocalSession();
    expect(restored.error).toBeNull();
    expect(restored.plan).toEqual(plan);
    expect(restored.checklist).toEqual(checklist);
    expect(restored.actuals).toEqual({ "discard-normal:0": "1" });
    expect(restored.copyAllowed).toBe(true);
    const hits = await restored.queryPreviewYuhun("D", 0, "normal");
    expect(hits.total).toBe(restored.plan!.groups[0]!.expected);
    expect(hits.rows[0]?.suit).toBe("招财猫");
    expect(api.decode).not.toHaveBeenCalled(); expect(api.encode).not.toHaveBeenCalled();
    restored.invalidateHeader();
    await vi.advanceTimersByTimeAsync(150);
    expect(saved.session.plan).toBeNull();
    expect(restored.copyAllowed).toBe(false);
  });

  it("preserves a blocked copy gate and invalidates the restored plan on rule changes", async () => {
    const first = newStore(); await first.restoreLocalSession(); await first.generatePlan();
    saved = { ...saved, session: { ...saved.session, gateState: { ...saved.session.gateState, roundtripValid: false } } };
    const restored = newStore(); await restored.restoreLocalSession();
    expect(restored.plan).not.toBeNull(); expect(restored.copyAllowed).toBe(false);
    restored.savePresetRule({ pool: "discard", label: "新规则", suits: [], positions: [2], mainStats: [], requiredSubStats: [], subStatCounts: [] });
    await vi.advanceTimersByTimeAsync(150);
    expect(saved.session.plan).toBeNull(); expect(saved.session.checklist).toBeNull();
  });

  it("does not restore a plan against a mismatched snapshot", async () => {
    const first = newStore(); await first.restoreLocalSession(); await first.generatePlan();
    saved = { ...saved, session: { ...saved.session, snapshotSha256: "f".repeat(64) } };
    const restored = newStore(); await restored.restoreLocalSession();
    expect(restored.error?.message).toContain("快照校验失败");
    expect(restored.plan).toBeNull(); expect(restored.copyAllowed).toBe(false);
  });
});
