import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router.js";
import { loadManualTargetCatalog } from "./manual-target-config.js";
import "./styles.css";

void loadManualTargetCatalog()
  .catch((error: unknown) => {
    console.error("[onmyoji-yuhun] 无法加载 R2 资产目录", error);
  })
  .finally(() => {
    createApp(App).use(createPinia()).use(router).mount("#app");
  });
