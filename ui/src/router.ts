import { createRouter, createWebHashHistory } from "vue-router";
import { useWorkbenchStore } from "./store.js";

export const STEPS = [
  { path: "/snapshot", id: "snapshot", label: "数据快照" },
  { path: "/targets", id: "targets", label: "目标与策略" },
  { path: "/analysis", id: "analysis", label: "分析结果" },
  { path: "/codes", id: "codes", label: "双码与预演" },
  { path: "/reconcile", id: "reconcile", label: "游戏对账" }
] as const;

export const router = createRouter({
  // GitHub Pages has no SPA history fallback for project sites.
  history: createWebHashHistory("/onmyoji-yuhun/"),
  routes: [
    { path: "/", redirect: "/snapshot" },
    ...STEPS.map((step) => ({ path: step.path, name: step.id, component: () => import(`./views/${step.id}.vue`) })),
    { path: "/policy", redirect: { path: "/targets", hash: "#retention" } },
    { path: "/:pathMatch(.*)*", redirect: "/snapshot" }
  ]
});

router.beforeEach(async (to) => {
  const store = useWorkbenchStore();
  if (!store.restoreCompleted) await store.restoreLocalSession();
  const route = String(to.name ?? "snapshot");
  if (route === "targets" || route === "analysis") {
    return store.snapshot === null ? "/snapshot" : true;
  }
  if (route === "codes") {
    return store.analysis === null && store.plan === null ? "/analysis" : true;
  }
  return true;
});
