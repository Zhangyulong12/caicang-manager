<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  House,
  Goods,
  ShoppingCart,
  Box,
  Download,
  OfficeBuilding,
  Upload,
  DataAnalysis,
  Setting,
  ArrowDown,
  Menu,
  Close,
  Switch,
} from '@element-plus/icons-vue';
import BrandMark from '../components/BrandMark.vue';
import UserMenu from '../components/UserMenu.vue';
import { useTenantStore } from '../stores/tenant';
import { navigation, roleNames } from '../router/policy';
const route = useRoute();
const router = useRouter();
const tenants = useTenantStore();
const mobileOpen = ref(false);
const icons = {
  House,
  Goods,
  ShoppingCart,
  Box,
  Download,
  OfficeBuilding,
  Upload,
  DataAnalysis,
  Setting,
};
const menu = computed(() =>
  navigation.filter((item) => tenants.current?.permissions.includes(item.permission)),
);
function switchTenant() {
  mobileOpen.value = false;
  void router.push('/select-tenant');
}
</script>
<template>
  <div class="app-shell">
    <div v-if="mobileOpen" class="sidebar-mask" @click="mobileOpen = false"></div>
    <aside class="sidebar" :class="{ 'is-open': mobileOpen }">
      <div class="sidebar-brand brand">
        <BrandMark /><span>采仓管家<small>CAICANG MANAGER</small></span
        ><button class="icon-button mobile-close" aria-label="收起导航" @click="mobileOpen = false">
          <el-icon><Close /></el-icon>
        </button>
      </div>
      <button class="tenant-switch" type="button" aria-label="切换当前商家" @click="switchTenant">
        <span class="tenant-symbol"
          ><el-icon><OfficeBuilding /></el-icon></span
        ><span
          ><small>当前工作空间</small><strong>{{ tenants.current?.tenant.name }}</strong></span
        ><el-icon><ArrowDown /></el-icon>
      </button>
      <p class="nav-caption">工作台</p>
      <nav class="nav-menu" aria-label="主导航">
        <router-link
          v-for="item in menu"
          :key="item.path"
          :to="item.path"
          class="nav-link"
          :class="{
            active:
              route.path === item.path ||
              (item.path === '/products' && route.path.startsWith('/products/')),
          }"
          @click="mobileOpen = false"
          ><el-icon><component :is="icons[item.icon as keyof typeof icons]" /></el-icon
          ><span>{{ item.title }}</span
          ><small v-if="item.soon" class="nav-soon">待开放</small></router-link
        >
      </nav>
      <div class="sidebar-bottom">
        <span class="status-dot"></span>
        <div><strong>自采自仓 · 有序经营</strong><small>CAICANG WORKSPACE / V1.0</small></div>
      </div>
    </aside>
    <div class="main-column">
      <header class="topbar">
        <div class="breadcrumb">
          <button
            class="icon-button mobile-toggle"
            aria-label="展开导航"
            @click="mobileOpen = true"
          >
            <el-icon><Menu /></el-icon></button
          ><span>工作空间</span><span class="breadcrumb-slash">/</span
          ><strong>{{ route.meta.title || '首页' }}</strong>
        </div>
        <div class="topbar-right">
          <span v-if="tenants.current" class="role-chip">{{
            roleNames[tenants.current.membership.role]
          }}</span
          ><UserMenu />
        </div>
      </header>
      <main class="page-content">
        <router-view :key="tenants.current?.tenant.id"></router-view>
      </main>
      <footer class="app-footer">
        <span>采仓管家 · 让每一次采购与发货都有迹可循</span
        ><button class="text-button" @click="switchTenant">
          <el-icon><Switch /></el-icon> 切换商家
        </button>
      </footer>
    </div>
  </div>
</template>
