import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { defaultRetentionStrategies, type RetentionStrategySetting } from "../../../src/retention-strategies.js";
import { emptyYuhunFilter } from "../yuhun-filter.js";
import Codes from "./codes.vue";

const { mockStore } = vi.hoisted(() => ({ mockStore: { plan: null as any, analysis: null as any, snapshot: {} as object | null, gateState: {}, retentionStrategies: [] as RetentionStrategySetting[], teamCalculations: [], setRetentionStrategies: vi.fn(), retainedImpactPercent: 0, retainedImpactLimit: 0, setRetainedImpactPercent: vi.fn(), displayDecimalPlaces: 2, copyAllowed: false, busy: null as string | null, desiredFreeSlots: 500, desiredFreeSlotsMaximum: 2800, requiredReleaseForTarget: 316, setDesiredFreeSlots: vi.fn(), queryPreviewYuhun: vi.fn() } }));
vi.mock("../store.js", () => ({ useWorkbenchStore: () => mockStore }));
vi.mock("../manual-target-config.js", () => ({ yuhunImage: () => null, yuhunDisplayName: (name: string) => name, yuhunCategory: () => "其他" }));

describe("generated rule inspection", () => {
  it("shows final free-slot controls and a shortfall independently of copy gates", async () => {
    mockStore.analysis = {};
    mockStore.plan = { desiredFreeSlots: 500, requiredRelease: 316, finalNewDiscardCount: 126, desiredFreeSlotsReached: false, groups: [] };
    mockStore.setDesiredFreeSlots.mockImplementation(value => { mockStore.desiredFreeSlots = Math.max(0, Math.min(2800, Math.round(value / 100) * 100)); });
    const wrapper = mount(Codes);
    const input = wrapper.get('#desired-free-slots');
    expect(input.attributes('max')).toBe('2800');
    expect(input.attributes('step')).toBe('100');
    expect(wrapper.text()).toContain('尚差 190 件清理');
    await input.setValue('3000');
    expect(mockStore.setDesiredFreeSlots).toHaveBeenCalledWith(3000);
    expect((input.element as HTMLInputElement).value).toBe('2800');
    wrapper.unmount();
    mockStore.analysis = null;
    mockStore.desiredFreeSlots = 500;
  });
  it("shows the impact cap, affected items, strategy results and preset criteria together", async () => {
    mockStore.analysis = { impactEligibleCount: 10, strategyEligibleCount: 9 };
    mockStore.retainedImpactPercent = 20;
    mockStore.retainedImpactLimit = 2;
    mockStore.setRetainedImpactPercent.mockImplementation(value => { mockStore.retainedImpactPercent = value; });
    const criteria = { ...emptyYuhunFilter(), positions: [2], mainStats: ["speed"] };
    mockStore.plan = {
      groups: [],
      retentionImpact: {
        percent: 20, eligibleCount: 10, budget: 2, actualPercent: 20,
        affectedItems: [1, 2].map(row => ({ row, suit: "招财猫", position: 2, mainStat: "speed", mainValue: 12, reason: "补出新属性潜力" }))
      },
      presetCoverage: {
        rules: [
          { id: "preset-d", label: "二号防御加成", pool: "discard", criteria: emptyYuhunFilter(), matchedCount: 5 },
          { id: "preset-e", label: "二号双速", pool: "enhance", criteria, matchedCount: 1 }
        ],
        coveredCount: 6,
        uncoveredCount: 9
      },
      strategyRetention: {
        strategies: [{ id: "new-substat", label: "补出新属性潜力", priority: 3, retainedCount: 7, releasedCount: 2 }],
        releasedCount: 2
      }
    };
    const wrapper = mount(Codes, { global: { stubs: { YuhunSuitPicker: true } } });
    const presets = wrapper.get('[aria-labelledby="preset-preview-title"]');
    expect(presets.text()).toContain("覆盖 6 件 · 未覆盖 9 件");
    expect(presets.text()).toContain("命中 5 件");
    const strategy = wrapper.get('[aria-labelledby="strategy-preview-title"]');
    expect(strategy.text()).toContain("策略让步共 2 件");
    expect(strategy.text()).toContain("补出新属性潜力");
    const cap = wrapper.get('#retained-impact-percent');
    expect(cap.attributes("min")).toBe("0");
    expect(cap.attributes("max")).toBe("100");
    expect(wrapper.text()).toContain("优先级决定让步顺序，比例限制让步总量");
    expect(wrapper.get('#retained-impact-help').text()).toContain("最多额外清理 2 件");
    expect(wrapper.get('[data-testid="retained-impact-result"]').text()).toContain("实际影响保留项 2 件 / 2 件额度 · 20.00%");
    await cap.setValue('12.5');
    expect(mockStore.setRetainedImpactPercent).toHaveBeenCalledWith(12.5);
    await wrapper.findAll('button').find(button => button.text() === '查看影响明细')!.trigger('click');
    const impactDialog = wrapper.get('[aria-labelledby="impact-title"]');
    expect(impactDialog.text()).toContain("招财猫");
    expect(impactDialog.text()).toContain("补出新属性潜力");
    await impactDialog.get('button[aria-label="关闭"]').trigger('click');
    await presets.get('button[aria-label="查看二号双速规则"]').trigger('click');
    const dialog = wrapper.get('[aria-labelledby="preview-rule-title"]');
    expect(dialog.text()).toContain("预设强化规则");
    expect(dialog.findAll('input[type="checkbox"]').some(input => (input.element as HTMLInputElement).checked)).toBe(true);
    expect(dialog.findAll('input[type="checkbox"]').every(input => input.element.matches(":disabled"))).toBe(true);
    wrapper.unmount();
    mockStore.analysis = null;
    mockStore.retainedImpactPercent = 0;
    mockStore.retainedImpactLimit = 0;
  });
  it("edits priorities in a draft modal and applies them only when saved", async () => {
    mockStore.analysis = { impactEligibleCount: 10 };
    mockStore.plan = { groups: [] };
    mockStore.retentionStrategies = defaultRetentionStrategies();
    mockStore.setRetentionStrategies.mockResolvedValueOnce(true);
    const wrapper = mount(Codes, { attachTo: document.body });
    try {
      const trigger = wrapper.get('button[aria-haspopup="dialog"]');
      expect(trigger.text()).toContain("策略设置");
    expect(wrapper.find('#retained-impact-percent').exists()).toBe(true);
      await trigger.trigger('click');
      const dialogSelector = '[aria-labelledby="retention-settings-title"]';
      let dialog = wrapper.get(dialogSelector);
      expect(document.activeElement).toBe(dialog.element);
      const order = () => dialog.findAll("[data-strategy]").map(row => row.attributes("data-strategy"));
      expect(order()).toEqual(["direct-improvement", "equivalent-suit", "new-substat"]);
      expect(dialog.get('button[aria-label="上移现有属性提升"]').attributes("disabled")).toBeDefined();
      await dialog.get('button[aria-label="上移补出新属性潜力"]').trigger('click');
      await dialog.get('[data-strategy="new-substat"] input').setValue(false);
      expect(order()).toEqual(["direct-improvement", "new-substat", "equivalent-suit"]);
      expect(mockStore.retentionStrategies).toEqual(defaultRetentionStrategies());
      await dialog.trigger('keydown', { key: "Escape" });
      expect(wrapper.find(dialogSelector).exists()).toBe(false);
      expect(mockStore.setRetentionStrategies).not.toHaveBeenCalled();

      await trigger.trigger('click');
      dialog = wrapper.get(dialogSelector);
      expect(order()).toEqual(["direct-improvement", "equivalent-suit", "new-substat"]);
      expect(dialog.get('button[aria-label="下移补出新属性潜力"]').attributes("disabled")).toBeDefined();
      await dialog.get('button[aria-label="上移补出新属性潜力"]').trigger('click');
      await dialog.get('[data-strategy="new-substat"] input').setValue(false);
      await dialog.trigger('submit');
      await flushPromises();
      expect(wrapper.find(dialogSelector).exists()).toBe(false);
      expect(mockStore.setRetentionStrategies).toHaveBeenCalledWith([
        { id: "direct-improvement", enabled: true },
        { id: "new-substat", enabled: false },
        { id: "equivalent-suit", enabled: true }
      ]);
    } finally {
      wrapper.unmount();
      mockStore.analysis = null;
    }
  });
  it("opens the shared editor read-only and shows queried hit inventory", async () => {
    const criteria = { ...emptyYuhunFilter(), positions: [2], mainStats: ["speed"], subStats: [{ stat: "crit", requirement: "include" }] };
    mockStore.plan = { discardGroupCount: 1, rescueGroupCount: 0, discardCode: "example", rescueCode: null, groups: [{ code: "D", index: 0, name: "测试规则", pool: "normal", expected: 1, criteria }] };
    mockStore.queryPreviewYuhun.mockResolvedValue({ page: 1, pageSize: 25, total: 1, rows: [{ row: 1, suit: "招财猫", position: 2, star: 6, level: 0, mainStat: "speed", mainValue: 12, subStatValues: [{ stat: "crit", value: .03 }], intrinsicStats: [], garbage: false }] });
    const wrapper = mount(Codes, { global: { stubs: { YuhunSuitPicker: true } } });
    const ruleButtons = wrapper.findAll('[data-testid="preview-rule-D-0"] .icon-button');
    expect(ruleButtons).toHaveLength(2);
    expect(ruleButtons.every(button => button.text() === "" && button.attributes("aria-label"))).toBe(true);
    await ruleButtons[0]!.trigger("click");
    const dialog = wrapper.find('[aria-labelledby="preview-rule-title"]');
    expect(dialog.exists()).toBe(true);
    expect(dialog.find('[data-testid="open-rule-yuhun-picker"]').exists()).toBe(false);
    expect(dialog.findAll('input[type="checkbox"]').every(input => input.element.matches(":disabled"))).toBe(true);
    expect(dialog.findAll('.rule-sub-stat-option button').every(button => (button.element as HTMLButtonElement).disabled)).toBe(true);
    expect(dialog.findAll('input[type="checkbox"]').some(input => (input.element as HTMLInputElement).checked)).toBe(true);
    await dialog.find('footer button').trigger("click");
    await nextTick();
    expect(mockStore.queryPreviewYuhun).toHaveBeenCalledWith("D", 0, "normal", 1, "");
    expect(wrapper.find('[aria-labelledby="preview-rule-title"]').exists()).toBe(false);
    const hits = wrapper.find('[aria-labelledby="preview-hits-title"]');
    expect(hits.text()).toContain("招财猫");
    expect(hits.text()).toContain("+3.00%");
    expect(wrapper.find('button[title="复制弃置码"]').attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });
});
