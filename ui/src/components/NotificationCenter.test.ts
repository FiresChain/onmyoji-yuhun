import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia, type Pinia } from "pinia";
import { nextTick } from "vue";
import { useWorkbenchStore } from "../store.js";
import { NOTIFICATION_STORAGE_KEY, RELEASE_NOTIFICATIONS, loadNotificationState, saveNotificationState } from "../notifications.js";
import { setTelemetryConsent, telemetryConsent } from "../telemetry.js";
import NotificationCenter from "./NotificationCenter.vue";

vi.mock("../worker/client.js", async importOriginal => ({
  ...await importOriginal<typeof import("../worker/client.js")>(),
  WorkflowClient: class {}
}));

let pinia: Pinia;
let wrapper: VueWrapper | undefined;
function createStore() {
  wrapper?.unmount(); wrapper = undefined;
  if (pinia) disposePinia(pinia);
  pinia = createPinia();
  setActivePinia(pinia);
  return useWorkbenchStore();
}
async function show(store: ReturnType<typeof useWorkbenchStore>) {
  store.initializeNotifications();
  wrapper = mount(NotificationCenter, { attachTo: document.body, global: { stubs: { Teleport: true } } });
  await nextTick();
  await nextTick();
  return wrapper;
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date", "performance", "setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
});
afterEach(() => {
  wrapper?.unmount(); wrapper = undefined;
  disposePinia(pinia);
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("notifications and first-visit confirmation", () => {
  it("enforces five visible seconds, blocks dismissal and saves sharing only on confirmation", async () => {
    const store = createStore();
    const view = await show(store);
    expect(view.text()).toContain("请勿直接将生成的御魂码用于游戏");
    expect(view.get('footer button').attributes("disabled")).toBeDefined();
    await view.get('.notification-overlay').trigger("click");
    await view.get('.notification-dialog').trigger("keydown", { key: "Escape" });
    store.confirmTestWarning();
    expect(store.notificationDialog).toBe("warning");
    await vi.advanceTimersByTimeAsync(4900);
    expect(view.get('footer button').attributes("disabled")).toBeDefined();
    await vi.advanceTimersByTimeAsync(100);
    expect(view.get('footer button').attributes("disabled")).toBeUndefined();
    await view.get('footer button').trigger("click");
    expect(store.notificationDialog).toBe("sharing");
    const checkboxes = view.findAll('input[type="checkbox"]');
    expect(checkboxes.every(input => (input.element as HTMLInputElement).checked)).toBe(true);
    expect(telemetryConsent("team-target")).toBe(false);
    expect(telemetryConsent("performance")).toBe(false);
    await checkboxes[0]!.setValue(false);
    await view.get('footer button').trigger("click");
    expect(store.notificationDialog).toBeNull();
    expect(telemetryConsent("team-target")).toBe(false);
    expect(telemetryConsent("performance")).toBe(true);
    expect(store.dataSharing).toEqual({ "team-target": false, performance: true });
    const restored = createStore();
    restored.initializeNotifications();
    expect(restored.notificationDialog).toBeNull();
    expect(restored.unreadNotifications).toEqual([]);
  });

  it("pauses the reading countdown in a hidden tab", async () => {
    const store = createStore();
    await show(store);
    await vi.advanceTimersByTimeAsync(2000);
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(10000);
    expect(store.warningSecondsRemaining).toBe(3);
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(3000);
    expect(store.warningSecondsRemaining).toBe(0);
  });

  it("resumes unfinished sharing confirmation without overwriting a prior opt-out", async () => {
    saveNotificationState({ warningAcknowledged: true, sharingConfirmed: false, readVersions: [] });
    setTelemetryConsent("team-target", false);
    setTelemetryConsent("performance", false);
    const store = createStore();
    const view = await show(store);
    expect(store.notificationDialog).toBe("sharing");
    expect(view.findAll('input[type="checkbox"]').every(input => !(input.element as HTMLInputElement).checked)).toBe(true);
    await view.get('.notification-dialog').trigger("keydown", { key: "Escape" });
    expect(store.notificationDialog).toBe("sharing");
    await view.get('footer button').trigger("click");
    expect(loadNotificationState().sharingConfirmed).toBe(true);
    expect(telemetryConsent("team-target")).toBe(false);
    expect(telemetryConsent("performance")).toBe(false);
  });

  it("shows unseen releases once, and keeps read notifications available through the bell", async () => {
    saveNotificationState({ warningAcknowledged: true, sharingConfirmed: true, readVersions: ["older-version"] });
    const store = createStore();
    const view = await show(store);
    expect(store.notificationDialog).toBe("updates");
    expect(view.text()).toContain(RELEASE_NOTIFICATIONS[0]!.title);
    expect(store.unreadNotifications).toHaveLength(RELEASE_NOTIFICATIONS.length);
    await view.get('footer button').trigger("click");
    expect(loadNotificationState().readVersions).toContain(RELEASE_NOTIFICATIONS[0]!.version);
    expect(store.unreadNotifications).toEqual([]);
    store.openNotifications();
    await nextTick();
    expect(store.notificationDialog).toBe("inbox");
    store.viewNotification(RELEASE_NOTIFICATIONS[0]!.version);
    expect(store.notificationDialog).toBe("updates");
    store.closeNotifications();
    expect(store.notificationDialog).toBe("inbox");
    store.reviewTestWarning();
    store.confirmTestWarning();
    expect(store.notificationDialog).toBe("inbox");
    const restored = createStore();
    restored.initializeNotifications();
    expect(restored.notificationDialog).toBeNull();
  });

  it("does not dismiss the warning or confirm sharing when local persistence fails", async () => {
    const store = createStore();
    await show(store);
    await vi.advanceTimersByTimeAsync(5000);
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    store.confirmTestWarning();
    expect(store.notificationDialog).toBe("warning");
    expect(store.notificationState.warningAcknowledged).toBe(false);
    expect(store.notificationError).toContain("无法保存");
    write.mockRestore();
    store.confirmTestWarning();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    store.confirmDataSharing();
    expect(store.notificationDialog).toBe("sharing");
    expect(store.notificationState.sharingConfirmed).toBe(false);
    expect(telemetryConsent("team-target")).toBe(false);
  });

  it("treats malformed local state as a first visit", () => {
    localStorage.setItem(NOTIFICATION_STORAGE_KEY, "invalid-json");
    const store = createStore();
    store.initializeNotifications();
    expect(store.notificationDialog).toBe("warning");
  });
});
