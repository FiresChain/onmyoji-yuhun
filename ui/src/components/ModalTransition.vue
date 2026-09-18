<script setup lang="ts">
import { nextTick } from "vue";
import { useModalTrigger } from "../modal-trigger.js";

const props = defineProps<{ trigger?: HTMLElement | null }>();
const emit = defineEmits<{
  'after-enter': [element: Element];
  'before-leave': [element: Element];
  'after-leave': [element: Element];
}>();
const currentTrigger = useModalTrigger();
const triggers = new WeakMap<Element, HTMLElement | null>();

function beforeEnter(element: Element): void {
  const trigger = props.trigger ?? currentTrigger();
  triggers.set(element, trigger && !element.contains(trigger) ? trigger : null);
}

function beforeLeave(element: Element): void {
  const overlay = element as HTMLElement;
  const panel = overlay.querySelector<HTMLElement>(':scope > [role="dialog"], :scope > [role="alertdialog"]');
  const trigger = props.trigger ?? triggers.get(element);
  const target = trigger?.isConnected ? trigger.getBoundingClientRect() : null;
  const bounds = panel?.getBoundingClientRect();
  const visible = target && target.width > 0 && target.height > 0
    && target.bottom > 0 && target.right > 0 && target.top < window.innerHeight && target.left < window.innerWidth;
  const dx = bounds && visible ? target.left + target.width / 2 - bounds.left - bounds.width / 2 : 0;
  const dy = bounds && visible ? target.top + target.height / 2 - bounds.top - bounds.height / 2 : 0;
  overlay.style.setProperty("--modal-close-x", `${dx}px`);
  overlay.style.setProperty("--modal-close-y", `${dy}px`);
  if (panel) panel.inert = true;
  emit("before-leave", element);
}

async function afterLeave(element: Element): Promise<void> {
  const trigger = props.trigger ?? triggers.get(element);
  triggers.delete(element);
  emit("after-leave", element);
  await nextTick();
  if (document.activeElement === document.body && trigger?.isConnected) trigger.focus({ preventScroll: true });
}
</script>

<template>
  <Transition name="modal-motion" appear @before-enter="beforeEnter" @after-enter="emit('after-enter', $event)" @before-leave="beforeLeave" @after-leave="afterLeave">
    <slot />
  </Transition>
</template>

<style>
.modal-motion-enter-active { transition: background-color .22s ease-out, backdrop-filter .22s ease-out; }
.modal-motion-leave-active { transition: background-color .32s ease, backdrop-filter .32s ease; }
.modal-motion-enter-active > :is([role="dialog"], [role="alertdialog"]),
.modal-motion-leave-active > :is([role="dialog"], [role="alertdialog"]) { transform-origin: center; will-change: transform, opacity; }
.modal-motion-enter-active > :is([role="dialog"], [role="alertdialog"]) { transition: transform .22s cubic-bezier(.2, .8, .2, 1), opacity .22s ease-out; }
.modal-motion-leave-active > :is([role="dialog"], [role="alertdialog"]) { pointer-events: none; transition: transform .32s cubic-bezier(.4, 0, .8, .4), opacity .32s ease-in; }
.modal-motion-enter-from, .modal-motion-leave-to { background-color: transparent !important; backdrop-filter: none !important; }
.modal-motion-enter-from > :is([role="dialog"], [role="alertdialog"]) { transform: scale(.9); opacity: 0; }
.modal-motion-leave-to > :is([role="dialog"], [role="alertdialog"]) { transform: translate(var(--modal-close-x, 0px), var(--modal-close-y, 0px)) scale(0); opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .modal-motion-enter-active, .modal-motion-leave-active,
  .modal-motion-enter-active > :is([role="dialog"], [role="alertdialog"]),
  .modal-motion-leave-active > :is([role="dialog"], [role="alertdialog"]) { transition-duration: .01ms; }
  .modal-motion-enter-from > :is([role="dialog"], [role="alertdialog"]),
  .modal-motion-leave-to > :is([role="dialog"], [role="alertdialog"]) { transform: none; }
}
</style>
