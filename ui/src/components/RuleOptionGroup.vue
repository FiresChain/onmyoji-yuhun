<script setup lang="ts">
defineProps<{ label: string; options: readonly { value: string | number; label: string }[]; selected: readonly (string | number)[] }>();
const emit = defineEmits<{ toggle: [value: string | number] }>();
</script>
<template>
  <section class="rule-field"><strong>{{ label }}</strong><div class="option-grid"><label v-for="option in options" :key="option.value"><input type="checkbox" :checked="selected.includes(option.value)" @change="emit('toggle', option.value)" /><span>{{ option.label }}</span></label></div></section>
</template>
