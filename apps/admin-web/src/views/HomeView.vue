<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  Goods,
  OfficeBuilding,
  User,
  ArrowRight,
  Refresh,
  CircleCheck,
  Warning,
  Box,
} from '@element-plus/icons-vue';
import { useAuthStore } from '../stores/auth';
import { useTenantStore } from '../stores/tenant';
import { roleNames } from '../router/policy';
import type { ApiPageResponse, ProductData, WarehouseData } from '@caicang/api-contract';
import { failureMessage } from '../utils/feedback';
const auth = useAuthStore();
const tenants = useTenantStore();
const router = useRouter();
const loading = ref(false);
const error = ref('');
const productTotal = ref<number | null>(null);
const warehouseTotal = ref<number | null>(null);
const updatedAt = ref('');
async function load() {
  const tenantId = tenants.current?.tenant.id;
  if (!tenantId) return;
  loading.value = true;
  error.value = '';
  try {
    const [products, warehouses] = await Promise.all([
      auth.client.request<ProductData[]>('/products?pageSize=1', { tenantId }),
      auth.client.request<WarehouseData[]>('/warehouses?pageSize=1', { tenantId }),
    ]);
    if (tenants.current?.tenant.id !== tenantId) return;
    productTotal.value = (products as ApiPageResponse<ProductData>).pagination.total;
    warehouseTotal.value = (warehouses as ApiPageResponse<WarehouseData>).pagination.total;
    updatedAt.value = new Date().toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (e) {
    error.value = failureMessage(e);
    productTotal.value = null;
    warehouseTotal.value = null;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>
<template>
  <section>
    <div class="page-heading">
      <div>
        <span class="section-kicker">OVERVIEW</span>
        <h1>工作台概览</h1>
        <p class="muted">欢迎回来，{{ auth.user?.displayName }}。一起把今天的业务打理好。</p>
      </div>
      <el-button :icon="Refresh" :loading="loading" @click="load">刷新数据</el-button>
    </div>
    <el-alert
      v-if="error"
      :title="error"
      type="error"
      :closable="false"
      show-icon
      class="form-alert"
    />
    <div class="welcome-banner">
      <div>
        <span class="welcome-badge">当前工作空间</span>
        <h2>{{ tenants.current?.tenant.name }}</h2>
        <p>从商品建档开始，让采购、入库与发货有序衔接。</p>
        <el-button class="welcome-button" @click="router.push('/products')"
          >查看商品工作区<el-icon><ArrowRight /></el-icon
        ></el-button>
      </div>
      <div class="banner-boxes" aria-hidden="true">
        <el-icon><Box /></el-icon>
      </div>
    </div>
    <div class="metrics-grid">
      <div class="surface metric-card">
        <span class="metric-icon teal"
          ><el-icon><Goods /></el-icon
        ></span>
        <div>
          <p>商品档案</p>
          <strong>{{ loading ? '…' : (productTotal ?? '—') }}</strong
          ><small>当前商家已建立的 SKU</small>
        </div>
      </div>
      <div class="surface metric-card">
        <span class="metric-icon amber"
          ><el-icon><OfficeBuilding /></el-icon
        ></span>
        <div>
          <p>仓库数量</p>
          <strong>{{ loading ? '…' : (warehouseTotal ?? '—') }}</strong
          ><small>包含默认与历史仓库</small>
        </div>
      </div>
      <div class="surface metric-card">
        <span class="metric-icon blue"
          ><el-icon><User /></el-icon
        ></span>
        <div>
          <p>我的角色</p>
          <strong class="metric-role">{{
            tenants.current ? roleNames[tenants.current.membership.role] : '—'
          }}</strong
          ><small>由当前商家成员关系授权</small>
        </div>
      </div>
    </div>
    <div class="home-lower">
      <section class="surface workspace-info">
        <div class="section-heading">
          <h2>工作空间信息</h2>
          <span class="subtle-chip">{{
            error ? '连接异常' : loading ? '正在更新' : '已连接'
          }}</span>
        </div>
        <dl>
          <div>
            <dt>商家名称</dt>
            <dd>{{ tenants.current?.tenant.name }}</dd>
          </div>
          <div>
            <dt>当前账号</dt>
            <dd>{{ auth.user?.email }}</dd>
          </div>
          <div>
            <dt>数据范围</dt>
            <dd>仅当前商家</dd>
          </div>
          <div>
            <dt>最近更新</dt>
            <dd>{{ updatedAt || '等待服务响应' }}</dd>
          </div>
        </dl>
        <p class="service-state">
          <el-icon><Warning v-if="error" /><CircleCheck v-else /></el-icon
          >{{
            error
              ? '数据暂时不可用，请重试'
              : loading
                ? '正在读取当前商家数据…'
                : '工作空间连接正常，资料已更新'
          }}
        </p>
      </section>
      <section class="surface next-steps">
        <div class="section-heading">
          <h2>开始使用采仓管家</h2>
          <span class="muted">循序建立业务资料</span>
        </div>
        <div class="step-row">
          <span>01</span>
          <div>
            <strong>选择商家与工作空间</strong>
            <p>每个商家独立管理资料和成员权限。</p>
          </div>
          <el-icon class="step-check"><CircleCheck /></el-icon>
        </div>
        <div class="step-row">
          <span>02</span>
          <div>
            <strong>建立商品与仓库资料</strong>
            <p>集中管理商品与仓库，资料管理页面即将开放。</p>
          </div>
        </div>
        <div class="step-row">
          <span>03</span>
          <div>
            <strong>衔接采购与出入库</strong>
            <p>后续逐步开放，保持每一步真实、可追溯。</p>
          </div>
        </div>
      </section>
    </div>
  </section>
</template>
