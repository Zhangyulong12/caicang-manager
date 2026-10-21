<script setup lang="ts">
import { computed, watch, onBeforeUnmount, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Edit, ArrowLeft, Refresh } from '@element-plus/icons-vue';
import type { ProductData } from '@caicang/api-contract';
import { useTenantStore } from '../stores/tenant';
import { useCatalog } from '../composables/catalog';
import { failureMessage } from '../utils/feedback';
import ProductEditor from '../components/ProductEditor.vue';
const route = useRoute();
const router = useRouter();
const tenants = useTenantStore();
const catalog = useCatalog();
const product = ref<ProductData | null>(null);
const loading = ref(false);
const error = ref('');
const editor = ref(false);
let alive = true;
let sequence = 0;
const canWrite = computed(() => tenants.current?.permissions.includes('products:write') === true);
async function load() {
  const version = ++sequence;
  editor.value = false;
  loading.value = true;
  error.value = '';
  product.value = null;
  try {
    const result = await catalog.product(String(route.params.id));
    if (alive && version === sequence) product.value = result;
  } catch (e) {
    if (alive && version === sequence) error.value = failureMessage(e);
  } finally {
    if (alive && version === sequence) loading.value = false;
  }
}
watch(() => route.params.id, load, { immediate: true });
onBeforeUnmount(() => {
  alive = false;
});
</script>
<template>
  <section>
    <div class="page-heading">
      <div>
        <span class="section-kicker">PRODUCT DETAILS</span>
        <h1>商品详情</h1>
        <p class="muted">商品资料仅属于当前商家。</p>
      </div>
      <el-button :icon="ArrowLeft" @click="router.push('/products')">返回列表</el-button>
    </div>
    <el-skeleton v-if="loading" :rows="8" animated class="surface loading-surface" />
    <div v-else-if="error" class="surface catalog-error">
      <el-alert :title="error" type="error" show-icon :closable="false" /><el-button @click="load"
        >重试加载</el-button
      >
    </div>
    <div v-else-if="product" class="surface product-detail">
      <div class="detail-heading">
        <div>
          <h2>{{ product.name }}</h2>
          <el-tag :type="product.isActive ? 'success' : 'info'">{{
            product.isActive ? '启用' : '停用'
          }}</el-tag>
        </div>
        <div>
          <el-button :icon="Refresh" @click="load">刷新</el-button
          ><el-button type="primary" :icon="Edit" :disabled="!canWrite" @click="editor = true"
            >编辑商品</el-button
          >
        </div>
      </div>
      <el-descriptions :column="1" border
        ><el-descriptions-item label="SKU 编码">{{ product.sku }}</el-descriptions-item
        ><el-descriptions-item label="商品条码">{{
          product.barcode || '未填写'
        }}</el-descriptions-item
        ><el-descriptions-item label="规格">{{
          product.specification || '未填写'
        }}</el-descriptions-item
        ><el-descriptions-item label="单位">{{ product.unit }}</el-descriptions-item
        ><el-descriptions-item label="参考进货价">{{
          product.referencePurchasePrice === null
            ? '未填写'
            : product.referencePurchasePrice + ' 元'
        }}</el-descriptions-item
        ><el-descriptions-item label="备注"
          ><span class="preserve-lines">{{
            product.remark || '未填写'
          }}</span></el-descriptions-item
        ><el-descriptions-item label="创建时间">{{
          new Date(product.createdAt).toLocaleString('zh-CN')
        }}</el-descriptions-item
        ><el-descriptions-item label="更新时间">{{
          new Date(product.updatedAt).toLocaleString('zh-CN')
        }}</el-descriptions-item></el-descriptions
      >
      <p class="muted catalog-form-note">
        商品参考价不是历史订单成交价；停用和编辑商品不会覆盖历史单据。
      </p>
    </div>
    <ProductEditor
      v-if="product"
      v-model:visible="editor"
      :product="product"
      @saved="product = $event"
    />
  </section>
</template>
