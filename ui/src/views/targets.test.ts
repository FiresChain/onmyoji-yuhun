import { mount } from "@vue/test-utils";
import { createPinia, disposePinia } from "pinia";
import { expect, it, vi } from "vitest";
import { useWorkbenchStore } from "../store.js";
import Targets from "./targets.vue";

vi.mock("../worker/client.js", async importOriginal => ({
  ...await importOriginal<typeof import("../worker/client.js")>(),
  WorkflowClient: class {}
}));

it("moves and disables retention strategies using the Targets controls", async () => {
  const pinia = createPinia();
  const store = useWorkbenchStore(pinia);
  const wrapper = mount(Targets, { global: { plugins: [pinia] } });
  try {
    const priority = wrapper.get("#retention");
    const order = () => priority.findAll("[data-strategy]").map(row => row.attributes("data-strategy"));
    expect(order()).toEqual(["direct-improvement", "equivalent-suit", "new-substat"]);
    expect(priority.get('button[aria-label="上移现有属性提升"]').attributes("disabled")).toBeDefined();
    expect(priority.get('button[aria-label="下移补出新属性潜力"]').attributes("disabled")).toBeDefined();
    await priority.get('button[aria-label="上移补出新属性潜力"]').trigger("click");
    expect(order()).toEqual(["direct-improvement", "new-substat", "equivalent-suit"]);
    await priority.get('[data-strategy="new-substat"] input').setValue(false);
    expect(store.retentionStrategies[1]).toEqual({ id: "new-substat", enabled: false });
    await priority.get('button[aria-label="下移补出新属性潜力"]').trigger("click");
    expect(order()).toEqual(["direct-improvement", "equivalent-suit", "new-substat"]);
    expect((priority.get('[data-strategy="new-substat"] input').element as HTMLInputElement).checked).toBe(false);
    expect(priority.get('button[aria-label="下移补出新属性潜力"]').attributes("disabled")).toBeDefined();
  } finally {
    wrapper.unmount();
    disposePinia(pinia);
  }
});
