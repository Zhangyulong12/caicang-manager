<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowRight, Plus, OfficeBuilding, Refresh } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import BrandMark from '../components/BrandMark.vue';
import UserMenu from '../components/UserMenu.vue';
import { useAuthStore } from '../stores/auth';
import { useTenantStore } from '../stores/tenant';
import { safeRedirect, roleNames } from '../router/policy';
import { failureMessage } from '../utils/feedback';
const auth = useAuthStore();
const tenants = useTenantStore();
const router = useRouter();
const route = useRoute();
const loading = ref(false);
const choosing = ref('');
const error = ref('');
const creating = ref(false);
const showCreate = ref(false);
const name = ref('');
async function load(page = 1) {
  loading.value = true;
  error.value = '';
  try {
    await tenants.list(page);
  } catch (e) {
    error.value = failureMessage(e);
  } finally {
    loading.value = false;
  }
}
async function choose(id: string) {
  if (choosing.value) return;
  choosing.value = id;
  try {
    if (await tenants.select(id))
      await router.replace(
        safeRedirect(route.query.redirect) === '/select-tenant'
          ? '/'
          : safeRedirect(route.query.redirect),
      );
  } catch (e) {
    ElMessage.error(failureMessage(e));
    await load(tenants.page);
  } finally {
    choosing.value = '';
  }
}
async function create() {
  if (!name.value.trim() || name.value.trim().length > 150 || creating.value) return;
  creating.value = true;
  try {
    if (await tenants.create(name.value.trim())) {
      showCreate.value = false;
      name.value = '';
      ElMessage.success('商家与默认仓库已创建');
      await router.replace('/');
    }
  } catch (e) {
    ElMessage.error(failureMessage(e));
  } finally {
    creating.value = false;
  }
}
onMounted(() => load());
</script>
<template>
  <div class="workspace-page">
    <header class="workspace-header">
      <div class="brand">
        <BrandMark /><span>采仓管家<small>CAICANG MANAGER</small></span>
      </div>
      <UserMenu />
    </header>
    <main class="workspace-content">
      <span class="section-kicker">WORKSPACES</span>
      <h1>选择你的工作空间</h1>
      <p class="muted">你好，{{ auth.user?.displayName }}。选择一个商家，继续今天的工作。</p>
      <div class="workspace-toolbar">
        <span class="muted"
          >你已加入的商家 <b>{{ tenants.total }}</b></span
        >
        <div>
          <el-button :icon="Refresh" :loading="loading" @click="load(tenants.page)"
            >刷新列表</el-button
          ><el-button type="primary" :icon="Plus" @click="showCreate = true">创建商家</el-button>
        </div>
      </div>
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon /><el-skeleton
        v-if="loading"
        :rows="5"
        animated
        class="surface loading-surface"
      />
      <div v-else-if="tenants.choices.length" class="workspace-grid">
        <button
          v-for="item in tenants.choices"
          :key="item.tenant.id"
          class="workspace-card"
          :disabled="!!choosing"
          @click="choose(item.tenant.id)"
        >
          <span class="workspace-icon"
            ><el-icon><OfficeBuilding /></el-icon></span
          ><span class="workspace-card-name">{{ item.tenant.name }}</span
          ><span class="workspace-role">{{ roleNames[item.membership.role] }}</span
          ><span class="workspace-enter"
            >{{ choosing === item.tenant.id ? '正在进入…' : '进入工作空间'
            }}<el-icon><ArrowRight /></el-icon
          ></span>
        </button>
      </div>
      <div v-else-if="!error" class="surface workspace-empty">
        <el-icon :size="48"><OfficeBuilding /></el-icon>
        <h2>为你的业务创建第一个商家</h2>
        <p class="muted">
          创建后将自动拥有默认仓库。已有团队？请联系商家管理员将你的注册邮箱加入团队。
        </p>
        <el-button type="primary" :icon="Plus" @click="showCreate = true">创建第一个商家</el-button>
      </div>
      <el-pagination
        v-if="tenants.total > 20"
        background
        layout="prev, pager, next"
        :current-page="tenants.page"
        :page-size="20"
        :total="tenants.total"
        @current-change="load"
      />
      <p class="workspace-note">每个商家的商品、仓库与业务资料独立管理。</p>
    </main>
    <el-dialog
      v-model="showCreate"
      title="创建商家"
      width="min(440px, 92vw)"
      :close-on-click-modal="!creating"
      :show-close="!creating"
      :close-on-press-escape="!creating"
      ><p class="muted dialog-hint">创建后你将成为所有者，并自动获得默认仓库。</p>
      <el-form label-position="top" @submit.prevent="create"
        ><el-form-item label="商家名称"
          ><el-input
            v-model="name"
            placeholder="例如：青禾数码"
            maxlength="150"
            show-word-limit
            :disabled="creating" /></el-form-item
        ><el-button
          type="primary"
          native-type="submit"
          :loading="creating"
          :disabled="!name.trim()"
          class="full-width"
          >创建并进入</el-button
        ></el-form
      ></el-dialog
    >
  </div>
</template>
