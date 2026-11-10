import { mount } from "@vue/test-utils";
import { createPinia, disposePinia } from "pinia";
import { expect, it, vi } from "vitest";
import Targets from "./targets.vue";

vi.mock("../worker/client.js", async importOriginal => ({
  ...await importOriginal<typeof import("../worker/client.js")>(),
  WorkflowClient: class {}
}));

it("keeps preset rules on Targets and omits the priority editor", () => {
  const pinia = createPinia();
  const wrapper = mount(Targets, { global: { plugins: [pinia] } });
  try {
    expect(wrapper.get("#retention").get("h2").text()).toBe("预置方案");
    expect(wrapper.find("[data-strategy]").exists()).toBe(false);
    expect(wrapper.find('[data-rule-pool="discard"]').exists()).toBe(true);
    expect(wrapper.find('[data-rule-pool="enhance"]').exists()).toBe(true);
  } finally {
    wrapper.unmount();
    disposePinia(pinia);
  }
});
