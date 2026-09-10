import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { emptyYuhunFilter } from "../yuhun-filter.js";
import Codes from "./codes.vue";

const { mockStore } = vi.hoisted(() => ({ mockStore: { plan: null as any, gateState: {}, copyAllowed: false, queryPreviewYuhun: vi.fn() } }));
vi.mock("../store.js", () => ({ useWorkbenchStore: () => mockStore }));
vi.mock("../manual-target-config.js", () => ({ yuhunImage: () => null, yuhunDisplayName: (name: string) => name, yuhunCategory: () => "其他" }));

describe("generated rule inspection", () => {
  it("opens the shared editor read-only and shows queried hit inventory", async () => {
    const criteria = { ...emptyYuhunFilter(), positions: [2], mainStats: ["speed"], subStats: [{ stat: "crit", requirement: "include" }] };
    mockStore.plan = { discardGroupCount: 1, rescueGroupCount: 0, discardCode: "example", rescueCode: null, groups: [{ code: "D", index: 0, name: "测试规则", pool: "normal", expected: 1, criteria }] };
    mockStore.queryPreviewYuhun.mockResolvedValue({ page: 1, pageSize: 25, total: 1, rows: [{ row: 1, suit: "招财猫", position: 2, star: 6, level: 0, mainStat: "speed", mainValue: 12, subStatValues: [{ stat: "crit", value: .03 }], intrinsicStats: [], garbage: false }] });
    const wrapper = mount(Codes, { global: { stubs: { EChart: true, YuhunSuitPicker: true } } });
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
    expect(hits.text()).toContain("+3%");
    expect(wrapper.find('button[title="复制弃置码"]').attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });
});
