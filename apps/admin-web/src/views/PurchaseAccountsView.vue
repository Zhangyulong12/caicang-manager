<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { PurchaseAccountData, PurchasePlatform } from '@caicang/api-contract';
import { usePurchases } from '../composables/purchases';
import { useTenantStore } from '../stores/tenant';
import {
  accountErrors,
  accountForm,
  accountPayload,
  blankAccount,
} from '../api/purchase-account-form';
import { platformNames } from '../api/purchase-form';
import { failureMessage } from '../utils/feedback';

const api = usePurchases(),
  tenants = useTenantStore(),
  router = useRouter();
const rows = ref<PurchaseAccountData[]>([]),
  search = ref(''),
  platform = ref<PurchasePlatform | ''>(''),
  active = ref(''),
  page = ref(1),
  total = ref(0),
  loading = ref(false),
  error = ref('');
const visible = ref(false),
  selected = ref<PurchaseAccountData | null>(null),
  form = reactive(blankAccount()),
  errors = ref<Record<string, string>>({}),
  saveError = ref(''),
  busy = ref(false),
  deletingId = ref('');
const canWrite = computed(() => tenants.current?.permissions.includes('purchase:write') === true);
let sequence = 0,
  alive = true;

async function load() {
  const version = ++sequence;
  loading.value = true;
  error.value = '';
  rows.value = [];
  try {
    const result = await api.accounts({
      page: page.value,
      pageSize: 20,
      search: search.value.trim(),
      ...(platform.value ? { platform: platform.value } : {}),
      ...(active.value ? { isActive: active.value === 'true' } : {}),
    });
    if (version !== sequence) return;
    rows.value = result.data;
    total.value = result.pagination.total;
  } catch (cause) {
    if (version === sequence) {
      error.value = failureMessage(cause);
      total.value = 0;
    }
  } finally {
    if (version === sequence) loading.value = false;
  }
}

function query() {
  page.value = 1;
  void load();
}

function open(row: PurchaseAccountData | null) {
  selected.value = row;
  Object.assign(form, row ? accountForm(row) : blankAccount());
  errors.value = {};
  saveError.value = '';
  visible.value = true;
}

async function save() {
  if (busy.value || !canWrite.value) return;
  errors.value = accountErrors(form);
  if (Object.keys(errors.value).length) return;
  busy.value = true;
  saveError.value = '';
  try {
    await api.saveAccount(accountPayload(form), selected.value?.id);
    if (!alive) return;
    visible.value = false;
    ElMessage.success('采购账号已保存');
    await load();
  } catch (cause) {
    if (alive) saveError.value = failureMessage(cause);
  } finally {
    busy.value = false;
  }
}

/** 删除只对从未被采购单引用的账号开放；有历史的账号由服务端 409 兜底。 */
async function remove(row: PurchaseAccountData) {
  if (!canWrite.value || row.hasOrders) return;
  try {
    await ElMessageBox.confirm(
      `删除后无法恢复，账号「${row.alias}」当前没有任何采购记录。`,
      '删除采购账号',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  deletingId.value = row.id;
  try {
    await api.deleteAccount(row.id);
    if (!alive) return;
    ElMessage.success('采购账号已删除');
    await load();
  } catch (cause) {
    if (alive) ElMessage.error(failureMessage(cause));
  } finally {
    deletingId.value = '';
  }
}

function records(row: PurchaseAccountData) {
  void router.push({ path: '/purchases', query: { purchaseAccountId: row.id } });
}

onMounted(load);
onBeforeUnmount(() => {
  alive = false;
  sequence++;
});
</script>

<template>
  <section>
    <div class="page-heading">
      <div>
        <span class="section-kicker">PURCHASE ACCOUNTS</span>
        <h1>采购账号管理</h1>
        <p class="muted">
          用平台和账号别名追溯采购来源，不保存任何平台登录密码。停用后历史记录仍可查。
        </p>
      </div>
      <el-button type="primary" :disabled="!canWrite" @click="open(null)">新增采购账号</el-button>
    </div>
    <el-alert
      v-if="!canWrite"
      title="当前角色只可查询采购账号"
      type="info"
      :closable="false"
      class="form-alert"
    />
    <div class="surface catalog-panel">
      <form class="catalog-toolbar purchase-filters" @submit.prevent="query">
        <el-input
          v-model="search"
          placeholder="搜索账号别名"
          aria-label="账号别名搜索"
          maxlength="100"
          clearable
        />
        <el-select v-model="platform" aria-label="账号平台筛选" @change="query">
          <el-option label="全部平台" value="" />
          <el-option
            v-for="(label, value) in platformNames"
            :key="value"
            :label="label"
            :value="value"
          />
        </el-select>
        <el-select v-model="active" aria-label="账号状态筛选" @change="query">
          <el-option label="全部状态" value="" />
          <el-option label="启用" value="true" />
          <el-option label="停用" value="false" />
        </el-select>
        <el-button native-type="submit" :loading="loading">查询</el-button>
      </form>
      <div v-if="error" class="catalog-error">
        <el-alert :title="error" type="error" :closable="false" />
        <el-button @click="load">重试加载</el-button>
      </div>
      <el-skeleton v-else-if="loading" :rows="5" animated />
      <template v-else>
        <el-table
          :data="rows"
          row-key="id"
          empty-text="暂无采购账号。先建一个「淘宝主账号」，采购单就能选到它。"
        >
          <el-table-column label="平台" width="110">
            <template #default="{ row }">{{
              platformNames[row.platform as PurchasePlatform]
            }}</template>
          </el-table-column>
          <el-table-column prop="alias" label="账号别名" min-width="160" />
          <el-table-column prop="remark" label="备注" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">{{ row.remark || '—' }}</template>
          </el-table-column>
          <el-table-column label="状态" width="96">
            <template #default="{ row }">
              <el-tag :type="row.isActive ? 'success' : 'info'">{{
                row.isActive ? '启用' : '停用'
              }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="采购记录" width="120">
            <template #default="{ row }">
              <el-tag :type="row.hasOrders ? 'warning' : 'info'" effect="plain">{{
                row.hasOrders ? '已关联' : '未使用'
              }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="240">
            <template #default="{ row }">
              <el-button link type="primary" :disabled="!canWrite" @click="open(row)"
                >编辑 / 停用</el-button
              >
              <el-button link @click="records(row)">采购记录</el-button>
              <el-tooltip
                :disabled="!row.hasOrders"
                content="已有采购记录，不能删除；请改为停用"
                placement="top"
              >
                <span>
                  <el-button
                    link
                    type="danger"
                    :disabled="!canWrite || row.hasOrders"
                    :loading="deletingId === row.id"
                    @click="remove(row)"
                    >删除</el-button
                  >
                </span>
              </el-tooltip>
            </template>
          </el-table-column>
        </el-table>
        <div class="catalog-pagination">
          <span class="muted">共 {{ total }} 个账号 · 已有采购记录的账号只能停用</span>
          <el-pagination
            v-model:current-page="page"
            :page-size="20"
            :total="total"
            layout="prev, pager, next"
            @current-change="load"
          />
        </div>
      </template>
    </div>
    <el-dialog
      v-model="visible"
      :title="selected ? '编辑采购账号' : '新增采购账号'"
      width="min(560px, 94vw)"
      :show-close="!busy"
      :close-on-click-modal="false"
      :close-on-press-escape="!busy"
    >
      <el-alert
        v-if="saveError"
        :title="saveError"
        type="error"
        :closable="false"
        class="form-alert"
      />
      <el-form label-position="top" :disabled="busy || !canWrite" @submit.prevent="save">
        <el-form-item label="采购平台" required :error="errors.platform">
          <el-select
            v-model="form.platform"
            aria-label="账号采购平台"
            :disabled="selected?.hasOrders === true"
          >
            <el-option
              v-for="(label, value) in platformNames"
              :key="value"
              :label="label"
              :value="value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="账号别名" required :error="errors.alias">
          <el-input
            v-model="form.alias"
            aria-label="账号别名"
            maxlength="100"
            placeholder="例如：淘宝主账号"
          />
        </el-form-item>
        <el-form-item label="账号备注" :error="errors.remark">
          <el-input
            v-model="form.remark"
            aria-label="账号备注"
            type="textarea"
            maxlength="2000"
            placeholder="只写业务备注，例如「女装类目专用」，不要填平台密码"
          />
        </el-form-item>
        <el-form-item label="启用状态">
          <el-switch v-model="form.isActive" active-text="启用" inactive-text="停用" />
        </el-form-item>
        <p class="muted">
          停用后不能用于新采购或确认下单，历史订单仍可查询。已有采购记录的账号不可修改平台，也不能删除。
        </p>
        <div class="dialog-actions">
          <el-button :disabled="busy" @click="visible = false">取消</el-button>
          <el-button native-type="submit" type="primary" :loading="busy" :disabled="!canWrite"
            >保存账号</el-button
          >
        </div>
      </el-form>
    </el-dialog>
  </section>
</template>
