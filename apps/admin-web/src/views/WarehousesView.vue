<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Plus, Refresh, OfficeBuilding } from '@element-plus/icons-vue';
import type { WarehouseData } from '@caicang/api-contract';
import { useCatalog } from '../composables/catalog';
import { useTenantStore } from '../stores/tenant';
import { warehouseErrors, type WarehouseForm } from '../api/catalog-form';
import { ApiFailure } from '../api/client';
import { failureMessage } from '../utils/feedback';
const catalog = useCatalog();
const tenants = useTenantStore();
const rows = ref<WarehouseData[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const selected = ref<WarehouseData | null>(null);
const loading = ref(false);
const error = ref('');
const choosing = ref('');
const dialog = ref(false);
const saving = ref(false);
const saveError = ref('');
const errors = ref<Partial<Record<keyof WarehouseForm, string>>>({});
const form = reactive<WarehouseForm>({ name: '', code: '', remark: '' });
let sequence = 0;
let alive = true;
const canWrite = computed(() => tenants.current?.permissions.includes('warehouses:write') === true);
async function load() {
  const version = ++sequence;
  loading.value = true;
  error.value = '';
  rows.value = [];
  selected.value = null;
  try {
    const [result, preferred] = await Promise.all([
      catalog.warehouses(page.value, pageSize.value),
      catalog.defaultWarehouse(),
    ]);
    if (version !== sequence) return;
    rows.value = result.data;
    total.value = result.pagination.total;
    selected.value = preferred;
  } catch (e) {
    if (version === sequence) {
      error.value = failureMessage(e);
      total.value = 0;
    }
  } finally {
    if (version === sequence) loading.value = false;
  }
}
function open() {
  if (!canWrite.value) return;
  Object.assign(form, { name: '', code: '', remark: '' });
  errors.value = {};
  saveError.value = '';
  dialog.value = true;
}
async function save() {
  if (saving.value || !canWrite.value) return;
  errors.value = warehouseErrors(form);
  if (Object.keys(errors.value).length) return;
  saving.value = true;
  saveError.value = '';
  try {
    await catalog.saveWarehouse(form);
    if (!alive) return;
    dialog.value = false;
    ElMessage.success('仓库已创建');
    page.value = 1;
    await load();
  } catch (e) {
    if (!alive) return;
    saveError.value = failureMessage(e);
    if (e instanceof ApiFailure && e.code === 'WAREHOUSE_CODE_ALREADY_EXISTS')
      errors.value.code = '当前商家已存在相同仓库编码';
  } finally {
    saving.value = false;
  }
}
async function choose(row: WarehouseData) {
  if (choosing.value || !row.isActive) return;
  choosing.value = row.id;
  try {
    const result = await catalog.defaultWarehouse(row.id);
    if (!alive) return;
    selected.value = result;
    ElMessage.success('默认业务仓库已保存');
  } catch (e) {
    if (alive) ElMessage.error(failureMessage(e));
  } finally {
    choosing.value = '';
  }
}
onMounted(load);
onBeforeUnmount(() => {
  sequence++;
  alive = false;
});
</script>
<template>
  <section>
    <div class="page-heading">
      <div>
        <span class="section-kicker">WAREHOUSES</span>
        <h1>仓库管理</h1>
        <p class="muted">管理收货空间，选择你常用的业务仓库。</p>
      </div>
      <el-button type="primary" :icon="Plus" :disabled="!canWrite" @click="open"
        >添加仓库</el-button
      >
    </div>
    <div class="surface default-warehouse">
      <span class="metric-icon teal"
        ><el-icon><OfficeBuilding /></el-icon
      ></span>
      <div>
        <small>当前默认业务仓库</small
        ><strong>{{ loading ? '正在确认…' : selected?.name || '尚无可用仓库' }}</strong>
        <p>按当前账号与商家保存在此浏览器，刷新后自动恢复；不会修改历史单据。</p>
      </div>
      <el-tag v-if="selected">{{ selected.code }}</el-tag>
    </div>
    <el-alert
      v-if="!canWrite"
      title="当前角色只能查看仓库和选择自己的默认业务仓库，不能添加仓库"
      type="info"
      :closable="false"
      class="form-alert"
    />
    <div class="surface catalog-panel">
      <div class="catalog-toolbar">
        <span class="muted">当前商家共 {{ total }} 个仓库</span
        ><el-button :icon="Refresh" :loading="loading" @click="load">刷新列表</el-button>
      </div>
      <div v-if="error" class="catalog-error">
        <el-alert :title="error" type="error" :closable="false" show-icon /><el-button @click="load"
          >重试加载</el-button
        >
      </div>
      <el-skeleton v-else-if="loading" :rows="5" animated class="loading-surface" /><template v-else
        ><el-table :data="rows" row-key="id" stripe empty-text="暂无仓库"
          ><el-table-column
            prop="name"
            label="仓库名称"
            min-width="170"
            show-overflow-tooltip
          /><el-table-column
            prop="code"
            label="仓库编码"
            min-width="130"
            show-overflow-tooltip
          /><el-table-column label="备注" min-width="150" show-overflow-tooltip
            ><template #default="{ row }">{{ row.remark || '—' }}</template></el-table-column
          ><el-table-column label="状态" width="90"
            ><template #default="{ row }"
              ><el-tag :type="row.isActive ? 'success' : 'info'">{{
                row.isActive ? '启用' : '停用'
              }}</el-tag></template
            ></el-table-column
          ><el-table-column label="创建时间" min-width="165"
            ><template #default="{ row }">{{
              new Date(row.createdAt).toLocaleString('zh-CN')
            }}</template></el-table-column
          ><el-table-column label="默认业务仓库" width="145" fixed="right"
            ><template #default="{ row }"
              ><el-tag v-if="selected?.id === row.id" type="success">当前默认</el-tag
              ><el-button
                v-else
                link
                type="primary"
                :disabled="!row.isActive || !!choosing"
                @click="choose(row)"
                >{{ choosing === row.id ? '正在保存…' : '设为默认' }}</el-button
              ></template
            ></el-table-column
          ></el-table
        >
        <div class="catalog-pagination">
          <span class="muted">历史仓库保留，不提供物理删除</span
          ><el-pagination
            v-model:current-page="page"
            v-model:page-size="pageSize"
            :total="total"
            :page-sizes="[10, 20, 50, 100]"
            layout="sizes, prev, pager, next"
            @current-change="load"
            @size-change="
              page = 1;
              load();
            "
          /></div
      ></template>
    </div>
    <el-dialog
      v-model="dialog"
      title="添加仓库"
      width="min(520px, 94vw)"
      :show-close="!saving"
      :close-on-click-modal="false"
      :close-on-press-escape="!saving"
      ><el-alert
        v-if="saveError"
        :title="saveError"
        type="error"
        :closable="false"
        show-icon
        class="form-alert"
      /><el-form :model="form" label-position="top" @submit.prevent="save"
        ><el-form-item label="仓库名称" prop="name" required :error="errors.name"
          ><el-input
            v-model="form.name"
            :validate-event="false"
            placeholder="输入仓库名称"
            :disabled="saving || !canWrite" /></el-form-item
        ><el-form-item label="仓库编码" prop="code" required :error="errors.code"
          ><el-input
            v-model="form.code"
            :validate-event="false"
            placeholder="当前商家内唯一"
            :disabled="saving || !canWrite"
            @input="errors.code = undefined" /></el-form-item
        ><el-form-item label="仓库备注（选填）" prop="remark" :error="errors.remark"
          ><el-input
            v-model="form.remark"
            :validate-event="false"
            type="textarea"
            :rows="3"
            placeholder="仓库用途或补充说明"
            :disabled="saving || !canWrite"
        /></el-form-item>
        <div class="dialog-actions">
          <el-button :disabled="saving" @click="dialog = false">取消</el-button
          ><el-button native-type="submit" type="primary" :loading="saving" :disabled="!canWrite"
            >保存仓库</el-button
          >
        </div></el-form
      ></el-dialog
    >
  </section>
</template>
