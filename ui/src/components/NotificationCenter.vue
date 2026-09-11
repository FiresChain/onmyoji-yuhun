<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { Bell, ChevronRight, TriangleAlert, X } from "@lucide/vue";
import { RELEASE_NOTIFICATIONS, TEST_WARNING } from "../notifications.js";
import { useWorkbenchStore } from "../store.js";

const store = useWorkbenchStore();
const dialog = ref<HTMLElement | null>(null);
const title = computed(() => store.notificationDialog === "warning" ? TEST_WARNING.title
  : store.notificationDialog === "sharing" ? "数据共享"
  : store.notificationDialog === "updates" ? "更新内容" : "通知");
const canDismiss = computed(() => store.notificationDialog === "updates" || store.notificationDialog === "inbox");
let readingTimer: ReturnType<typeof setInterval> | null = null;
let previousFocus: HTMLElement | null = null;
let previousOverflow = "";

function tickReading(): void { store.tickWarningReading(!document.hidden); }
function stopReading(): void {
  if (readingTimer !== null) clearInterval(readingTimer);
  readingTimer = null;
  document.removeEventListener("visibilitychange", tickReading);
}

watch(() => store.notificationDialog, async (current, previous) => {
  stopReading();
  if (current !== null && !previous) {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  if (current === null) {
    document.body.style.overflow = previousOverflow;
    await nextTick();
    previousFocus?.focus();
    return;
  }
  await nextTick();
  if (store.notificationDialog !== current) return;
  dialog.value?.focus();
  if (current === "warning" && !store.notificationState.warningAcknowledged) {
    tickReading();
    readingTimer = setInterval(tickReading, 100);
    document.addEventListener("visibilitychange", tickReading);
  }
}, { immediate: true, flush: "post" });

function keydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    if (canDismiss.value) store.closeNotifications();
  }
  if (event.key !== "Tab") return;
  const controls = [...(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [href], [tabindex="0"]') ?? [])];
  const first = controls[0];
  const last = controls.at(-1);
  if (!first || !last) { event.preventDefault(); return; }
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.value)) {
    event.preventDefault(); first.focus();
  }
}

onBeforeUnmount(() => {
  stopReading();
  if (store.notificationDialog !== null) document.body.style.overflow = previousOverflow;
});
</script>

<template>
  <Teleport to="body">
    <div v-if="store.notificationDialog !== null" class="notification-overlay" @keydown="keydown" @click.self="canDismiss && store.closeNotifications()">
      <section ref="dialog" class="notification-dialog" :class="{ 'test-warning': store.notificationDialog === 'warning' }" :role="store.notificationDialog === 'warning' ? 'alertdialog' : 'dialog'" aria-modal="true" aria-labelledby="notification-title" :aria-describedby="store.notificationDialog === 'warning' ? 'test-warning-content' : undefined" tabindex="-1">
        <header><div><TriangleAlert v-if="store.notificationDialog === 'warning'" :size="22" /><Bell v-else :size="21" /><h2 id="notification-title">{{ title }}</h2></div><button v-if="canDismiss" class="icon-button" title="关闭" aria-label="关闭通知" @click="store.closeNotifications"><X :size="18" /></button></header>
        <div class="notification-body">
          <div v-if="store.notificationDialog === 'warning'" id="test-warning-content" class="warning-content"><p v-for="paragraph in TEST_WARNING.paragraphs" :key="paragraph">{{ paragraph }}</p></div>
          <template v-else-if="store.notificationDialog === 'sharing'">
            <label class="sharing-choice"><input v-model="store.sharingDraft['team-target']" type="checkbox" /><span><strong>阵容数据</strong><small>共享导入的阵容码、关卡和难度。</small></span></label>
            <label class="sharing-choice"><input v-model="store.sharingDraft.performance" type="checkbox" /><span><strong>性能指标</strong><small>共享计算耗时、规模和设备性能。</small></span></label>
          </template>
          <template v-else-if="store.notificationDialog === 'updates'">
            <article v-for="entry in store.displayedUpdates" :key="entry.version" class="release-entry"><div class="release-meta"><span>{{ entry.version }}</span><time>{{ entry.date }}</time></div><h3>{{ entry.title }}</h3><ul><li v-for="change in entry.changes" :key="change">{{ change }}</li></ul></article>
          </template>
          <template v-else>
            <button class="notification-item warning-item" @click="store.reviewTestWarning"><TriangleAlert :size="18" /><span><strong>{{ TEST_WARNING.title }}</strong><small>测试通知</small></span><ChevronRight :size="16" /></button>
            <button v-for="entry in RELEASE_NOTIFICATIONS" :key="entry.version" class="notification-item" @click="store.viewNotification(entry.version)"><i v-if="!store.notificationState.readVersions.includes(entry.version)" class="unread-dot" /><span><strong>{{ entry.title }}</strong><small>{{ entry.version }} · {{ entry.date }}</small></span><ChevronRight :size="16" /></button>
          </template>
          <p v-if="store.notificationError" class="notification-error" role="alert">{{ store.notificationError }}</p>
        </div>
        <footer v-if="store.notificationDialog !== 'inbox'">
          <button v-if="store.notificationDialog === 'warning'" class="primary" :disabled="!store.notificationState.warningAcknowledged && store.warningSecondsRemaining > 0" @click="store.confirmTestWarning">{{ store.notificationState.warningAcknowledged ? '关闭' : store.warningSecondsRemaining > 0 ? `请阅读 ${store.warningSecondsRemaining} 秒` : '我已阅读并确认' }}</button>
          <button v-else-if="store.notificationDialog === 'sharing'" class="primary" @click="store.confirmDataSharing">确认</button>
          <button v-else class="primary" @click="store.closeNotifications">知道了</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.notification-overlay { position: fixed; z-index: 200; inset: 0; display: grid; place-items: center; padding: 20px; background: rgb(20 25 27 / 60%); }
.notification-dialog { width: min(540px, 100%); max-height: calc(100dvh - 40px); display: flex; flex-direction: column; background: white; color: var(--ink); border: 1px solid var(--line); border-radius: 8px; box-shadow: 0 24px 80px rgb(0 0 0 / 30%); outline: none; }
.notification-dialog > header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 18px 20px; border-bottom: 1px solid var(--line); }.notification-dialog > header > div { display: flex; align-items: center; gap: 10px; }.notification-dialog h2 { font-size: 19px; margin: 0; }
.notification-body { overflow: auto; padding: 20px; }.notification-dialog > footer { display: flex; justify-content: flex-end; padding: 14px 20px; border-top: 1px solid var(--line); }.notification-dialog > footer button { min-width: 140px; }
.test-warning { border-color: #c69046; }.test-warning > header { background: #fff6e8; color: #8b5819; border-bottom-color: #ead1ac; }.warning-content p { font-size: 15px; line-height: 1.8; margin: 0 0 14px; }.warning-content p:first-child { font-weight: 700; color: #a13b30; }.warning-content p:last-child { margin-bottom: 0; }
.sharing-choice { display: flex; align-items: flex-start; gap: 12px; padding: 15px; border: 1px solid var(--line); border-radius: 5px; cursor: pointer; }.sharing-choice + .sharing-choice { margin-top: 12px; }.sharing-choice input { width: 17px; height: 17px; margin-top: 2px; accent-color: var(--green); }.sharing-choice > span { display: grid; gap: 6px; }.sharing-choice strong { font-size: 14px; }.sharing-choice small { color: var(--muted); font-size: 12px; }
.release-entry + .release-entry { margin-top: 22px; padding-top: 20px; border-top: 1px solid var(--line); }.release-meta { display: flex; justify-content: space-between; gap: 12px; color: var(--muted); font-size: 12px; }.release-entry h3 { margin: 12px 0; font-size: 16px; }.release-entry ul { margin: 0; padding-left: 20px; }.release-entry li { margin: 8px 0; font-size: 14px; line-height: 1.6; }
.notification-item { display: flex; width: 100%; align-items: center; gap: 12px; padding: 14px 0; border: 0; background: transparent; text-align: left; }.notification-item + .notification-item { border-top: 1px solid var(--line); }.notification-item > span { display: grid; flex: 1; gap: 7px; }.notification-item strong { font-size: 14px; }.notification-item small { font-size: 12px; color: var(--muted); }.notification-item.warning-item { color: #8b5819; }.unread-dot { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: var(--red); }.notification-error { margin: 14px 0 0; font-size: 13px; color: var(--red); }
</style>
