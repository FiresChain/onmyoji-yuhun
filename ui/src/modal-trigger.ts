import { onBeforeUnmount, onMounted } from "vue";

let subscribers = 0;
let lastTrigger: HTMLElement | null = null;
let lastTriggeredAt = 0;

function rememberTrigger(event: MouseEvent): void {
  const target = event.target instanceof Element ? event.target : null;
  lastTrigger = target?.closest<HTMLElement>('button, a[href], [role="button"], summary, [tabindex]')
    ?? (target instanceof HTMLElement ? target : target?.parentElement ?? null);
  lastTriggeredAt = Date.now();
}

// Capture clicks before Vue updates, including keyboard activation and Safari's
// mouse clicks that do not focus buttons. Each modal keeps its own opening trigger.
export function useModalTrigger(): () => HTMLElement | null {
  onMounted(() => {
    if (subscribers++ === 0) document.addEventListener("click", rememberTrigger, true);
  });
  onBeforeUnmount(() => {
    if (--subscribers === 0) {
      document.removeEventListener("click", rememberTrigger, true);
      lastTrigger = null;
    }
  });
  return () => Date.now() - lastTriggeredAt < 1_000 && lastTrigger?.isConnected ? lastTrigger : null;
}
