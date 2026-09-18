<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { TriangleAlert } from "@lucide/vue";
import { useWorkbenchStore } from "../store.js";
import ModalTransition from "./ModalTransition.vue";

const store = useWorkbenchStore();
const emit = defineEmits<{ closing: [value: boolean] }>();
const cancelButton = ref<HTMLButtonElement | null>(null);
const confirmButton = ref<HTMLButtonElement | null>(null);

watch(() => store.confirmationRequest, async request => {
  if (!request) return;
  await nextTick();
  cancelButton.value?.focus();
});

function cycleFocus(): void {
  (document.activeElement === cancelButton.value ? confirmButton.value : cancelButton.value)?.focus();
}
</script>

<template>
  <Teleport to="body">
    <ModalTransition @before-leave="emit('closing', true)" @after-leave="emit('closing', false)">
      <div v-if="store.confirmationRequest" class="catalog-delete-overlay confirmation-overlay" @click.self="store.answerConfirmation(false)" @keydown.esc.prevent.stop="store.answerConfirmation(false)" @keydown.tab.prevent="cycleFocus">
        <section class="catalog-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-message">
          <header><span><TriangleAlert :size="20" /></span><h2 id="confirmation-title">{{ store.confirmationRequest.title }}</h2></header>
          <div class="catalog-delete-body"><p id="confirmation-message">{{ store.confirmationRequest.message }}</p></div>
          <footer><button ref="cancelButton" @click="store.answerConfirmation(false)">取消</button><button ref="confirmButton" class="danger-command" @click="store.answerConfirmation(true)">确认</button></footer>
        </section>
      </div>
    </ModalTransition>
  </Teleport>
</template>

<style scoped>
.confirmation-overlay { z-index: 210; }
#confirmation-message { white-space: pre-line; overflow-wrap: anywhere; }
</style>
