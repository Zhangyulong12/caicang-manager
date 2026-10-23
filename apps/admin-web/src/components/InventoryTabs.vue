<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
const route = useRoute();
const tabs = [
  { path: '/inventory', label: '库存总览' },
  { path: '/inventory/balances', label: '商品库存' },
  { path: '/inventory/movements', label: '变动流水' },
  { path: '/inventory/pending', label: '待入库采购' },
] as const;
const active = computed(() => route.path);
</script>
<template>
  <nav class="inventory-tabs" aria-label="库存子页面">
    <router-link
      v-for="tab in tabs"
      :key="tab.path"
      :to="tab.path"
      :class="{ active: active === tab.path }"
      :aria-current="active === tab.path ? 'page' : undefined"
      >{{ tab.label }}</router-link
    >
  </nav>
</template>
