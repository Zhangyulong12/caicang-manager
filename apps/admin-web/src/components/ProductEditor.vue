<script setup lang="ts">
import { computed, reactive, ref, watch, onBeforeUnmount } from 'vue';
import { ElMessage } from 'element-plus';
import type { ProductData } from '@caicang/api-contract';
import { useTenantStore } from '../stores/tenant';
import { useCatalog } from '../composables/catalog';
import { ApiFailure } from '../api/client';
import {
  blankProduct,
  productForm,
  productErrors,
  previewProductName,
  type ProductForm,
} from '../api/catalog-form';
import { failureMessage } from '../utils/feedback';
const props = defineProps<{ visible: boolean; product: ProductData | null }>();
const emit = defineEmits<{ 'update:visible': [value: boolean]; saved: [value: ProductData] }>();
const tenants = useTenantStore();
const catalog = useCatalog();
const form = reactive(blankProduct());
const errors = ref<Partial<Record<keyof ProductForm, string>>>({});
const advanced = ref<string[]>([]);
const busy = ref(false);
const error = ref('');
let alive = true;
const canWrite = computed(() => tenants.current?.permissions.includes('products:write') === true);
const autoName = computed(() => previewProductName(form));
// 这些字段折叠在高级选项里，出错时要自动展开，否则用户看不到提示。
const advancedFields: (keyof ProductForm)[] = [
  'barcode',
  'specification',
  'unit',
  'remark',
  'isActive',
];
watch(
  () => props.visible,
  (open) => {
    if (open) {
      const next = props.product ? productForm(props.product) : blankProduct();
      // 名称本来就是自动生成的就留空，让"留空即自动"这件事在表单里看得见。
      if (props.product && next.name === previewProductName(next)) next.name = '';
      Object.assign(form, next);
      errors.value = {};
      error.value = '';
      const filled =
        props.product !== null &&
        [props.product.barcode, props.product.specification, props.product.remark].some(
          (value) => !!value,
        );
      advanced.value = filled ? ['advanced'] : [];
    }
  },
);
function validate(key: keyof ProductForm) {
  errors.value[key] = productErrors(form)[key];
}
async function save() {
  if (busy.value || !canWrite.value) return;
  errors.value = productErrors(form);
  if (advancedFields.some((key) => errors.value[key])) advanced.value = ['advanced'];
  if (Object.keys(errors.value).length) return;
  busy.value = true;
  error.value = '';
  try {
    const result = await catalog.saveProduct(form, props.product?.id);
    if (!alive) return;
    ElMessage.success(props.product ? '商品已更新' : '商品已创建');
    emit('update:visible', false);
    emit('saved', result);
  } catch (e) {
    if (!alive) return;
    error.value = failureMessage(e);
    if (e instanceof ApiFailure) {
      if (e.code === 'PRODUCT_SKU_ALREADY_EXISTS') errors.value.sku = '当前商家已存在相同 SKU 编码';
      if (e.code === 'PRODUCT_BARCODE_ALREADY_EXISTS') {
        errors.value.barcode = '当前商家已存在相同商品条码';
        advanced.value = ['advanced'];
      }
    }
  } finally {
    busy.value = false;
  }
}
onBeforeUnmount(() => {
  alive = false;
});
</script>
<template>
  <el-dialog
    :model-value="visible"
    :title="product ? '编辑商品' : '添加商品'"
    width="min(680px, 94vw)"
    :show-close="!busy"
    :close-on-click-modal="false"
    :close-on-press-escape="!busy"
    @update:model-value="emit('update:visible', $event)"
  >
    <el-alert
      v-if="error"
      :title="error"
      type="error"
      :closable="false"
      show-icon
      class="form-alert"
    />
    <el-alert
      v-if="!canWrite"
      title="当前角色只可查看商品，不能保存修改"
      type="info"
      :closable="false"
      class="form-alert"
    />
    <el-form :model="form" label-position="top" @submit.prevent="save">
      <div class="catalog-form-grid">
        <el-form-item label="商品货号" prop="articleNo" :error="errors.articleNo">
          <el-input
            v-model="form.articleNo"
            :maxlength="80"
            placeholder="同款共用，例如 T20"
            :disabled="busy || !canWrite"
            :validate-event="false"
            @blur="validate('articleNo')"
          />
        </el-form-item>
        <el-form-item label="颜色" prop="color" :error="errors.color">
          <el-input
            v-model="form.color"
            :maxlength="80"
            placeholder="例如 黑色"
            :disabled="busy || !canWrite"
            :validate-event="false"
            @blur="validate('color')"
          />
        </el-form-item>
        <el-form-item label="尺码" prop="size" :error="errors.size">
          <el-input
            v-model="form.size"
            :maxlength="80"
            placeholder="例如 L / 42 / 均码"
            :disabled="busy || !canWrite"
            :validate-event="false"
            @blur="validate('size')"
          />
        </el-form-item>
        <el-form-item label="SKU 编码" prop="sku" required :error="errors.sku">
          <el-input
            v-model="form.sku"
            :validate-event="false"
            placeholder="每个颜色尺码各一个，商家内唯一"
            :disabled="busy || !canWrite"
            @input="errors.sku = undefined"
            @blur="validate('sku')"
          />
        </el-form-item>
        <el-form-item
          label="参考进货价（元，选填）"
          prop="referencePurchasePrice"
          :error="errors.referencePurchasePrice"
        >
          <el-input
            v-model="form.referencePurchasePrice"
            :validate-event="false"
            placeholder="例如：18.50"
            inputmode="decimal"
            :disabled="busy || !canWrite"
            @blur="validate('referencePurchasePrice')"
          />
        </el-form-item>
        <el-form-item label="商品名称（选填）" prop="name" :error="errors.name">
          <el-input
            v-model="form.name"
            :validate-event="false"
            placeholder="留空自动生成"
            :disabled="busy || !canWrite"
            @blur="validate('name')"
          />
        </el-form-item>
      </div>
      <p class="muted catalog-form-note product-name-preview">
        名称留空时使用：<strong>{{ autoName || '填好货号、颜色、尺码或 SKU 后自动显示' }}</strong>
      </p>
      <el-collapse v-model="advanced" class="catalog-advanced">
        <el-collapse-item title="高级选项：条码、规格、单位、备注、启用状态" name="advanced">
          <div class="catalog-form-grid">
            <el-form-item label="商品条码（选填）" prop="barcode" :error="errors.barcode">
              <el-input
                v-model="form.barcode"
                :validate-event="false"
                placeholder="可留空，保留前导零"
                :disabled="busy || !canWrite"
                @input="errors.barcode = undefined"
                @blur="validate('barcode')"
              />
            </el-form-item>
            <el-form-item label="规格" prop="specification" :error="errors.specification">
              <el-input
                v-model="form.specification"
                :validate-event="false"
                placeholder="例如：500ml、双口"
                :disabled="busy || !canWrite"
                @blur="validate('specification')"
              />
            </el-form-item>
            <el-form-item label="单位" prop="unit" required :error="errors.unit">
              <el-input
                v-model="form.unit"
                :validate-event="false"
                placeholder="默认按件计"
                :disabled="busy || !canWrite"
                @blur="validate('unit')"
              />
            </el-form-item>
            <el-form-item label="启用状态">
              <el-switch
                v-model="form.isActive"
                active-text="启用"
                inactive-text="停用"
                :disabled="busy || !canWrite"
              />
            </el-form-item>
          </div>
          <el-form-item label="备注" prop="remark" :error="errors.remark">
            <el-input
              v-model="form.remark"
              :validate-event="false"
              type="textarea"
              :rows="3"
              placeholder="商品补充说明"
              :disabled="busy || !canWrite"
              @blur="validate('remark')"
            />
          </el-form-item>
        </el-collapse-item>
      </el-collapse>
      <p class="muted catalog-form-note">
        参考价仅用于商品建档，不会改动历史采购单的实际价格与成本快照；SKU 与非空条码在同商家内唯一。
      </p>
      <div class="dialog-actions">
        <el-button :disabled="busy" @click="emit('update:visible', false)">取消</el-button>
        <el-button native-type="submit" type="primary" :loading="busy" :disabled="!canWrite">
          保存商品
        </el-button>
      </div>
    </el-form>
  </el-dialog>
</template>
