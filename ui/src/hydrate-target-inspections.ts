/** Legacy restoration is background work, not an unbounded API fan-out.
 * At most one request and 20 starts/minute per run, leaving room under the
 * existing edge WAF's 5/10s limit (including preflight/collect), as well as the
 * Worker's 120/minute codec quota. Failures stop the pass; no automatic retry.
 */
export async function hydrateTargetInspections<T>(
  targets: readonly T[],
  inspect: (target: T) => Promise<unknown | null>,
  active: () => boolean,
): Promise<void> {
  for (const [index, target] of targets.entries()) {
    if (!active()) return;
    if (index > 0) await new Promise<void>(resolve => setTimeout(resolve, 3000));
    if (!active()) return;
    try {
      if (await inspect(target) === null) return;
    } catch { return; }
  }
}
