import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, disposePinia, setActivePinia, type Pinia } from "pinia";
import { createHash } from "node:crypto";
import { YuhunWorkflow, filterShareFromDraft, type YuhunFilterShare } from "../../src/browser.js";
import type { StoredWorkbenchSessionV1, WorkbenchSessionV1 } from "./persistence.js";
import { useWorkbenchStore } from "./store.js";

const persistence = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
const api = vi.hoisted(() => ({ decode: vi.fn(), encode: vi.fn() }));
vi.mock("./persistence.js", async importOriginal => ({
  ...await importOriginal<typeof import("./persistence.js")>(),
  loadWorkbenchSession: persistence.load,
  saveWorkbenchSession: persistence.save
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
    queryDecisions = (...args: Parameters<YuhunWorkflow["queryDecisions"]>) => this.workflow.queryDecisions(...args);
    queryYuhunDecisions = (...args: Parameters<YuhunWorkflow["queryYuhunDecisions"]>) => this.workflow.queryYuhunDecisions(...args);
    queryYuhunDecisionFacets = () => this.workflow.queryYuhunDecisionFacets();
    generatePlan = (...args: Parameters<YuhunWorkflow["generatePlan"]>) => this.workflow.generatePlan(...args);
    buildImportChecklist = () => this.workflow.buildImportChecklist();
    getGateState = () => this.workflow.getGateState();
  } };
});

const headerHex = "12".repeat(16);
const policy = { id: "test", confirmed: true, protectedSuitIds: [], retainInitialCountsBelowFour: false, retainedMainStats: [], retainedIntrinsicStats: [], fourLineSubStatCombinations: [] };
let saved: StoredWorkbenchSessionV1;
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
  const json = { version: "test", timestamp: "test", data: { hero_equips: [{ id: "synthetic", equip_id: 1, suit_id: 300010, pos: 1, quality: 6, level: 0, born: 0, lock: false, garbage: false, base_attr: { type: "Speed", value: 12 }, attrs: [], random_attrs: [], random_attr_rates: [], single_attrs: [] }] } };
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
    const share = filterShareFromDraft({ ...draft, headerHex: draft.headerHex ?? headerHex });
    const yuhunCode = `synthetic-${shares.size}`;
    shares.set(yuhunCode, share);
    return { yuhunCode, share };
  });
});
afterEach(() => { disposePinia(pinia); vi.clearAllTimers(); vi.useRealTimers(); });

describe("dual-code session persistence", () => {
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
