<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Box, ArrowLeft, CircleCheck } from '@element-plus/icons-vue';
import { navigation } from '../router/policy';
const route = useRoute();
const router = useRouter();
const item = computed(() => navigation.find((entry) => entry.path === route.path));
</script>
<template>
  <section>
    <div class="page-heading">
      <div>
        <span class="section-kicker">WORKSPACE MODULE</span>
        <h1>{{ item?.title }}</h1>
        <p class="muted">{{ item?.description }}</p>
      </div>
    </div>
    <div class="surface module-empty">
      <span class="module-icon"
        ><el-icon><Box /></el-icon></span
      ><span class="subtle-chip">管理页面待开放</span>
      <h2>
        {{ route.path === '/products' ? '商品管理工作区即将开放' : '让业务一步一步，有序衔接' }}
      </h2>
      <p class="muted">
        {{
          route.path === '/products'
            ? '在这里管理 SKU、条码与商品资料。商品列表与编辑功能正在准备中，敬请期待。'
            : '此工作区正在准备中，相关业务功能将逐步开放。'
        }}
      </p>
      <div class="module-facts">
        <span
          ><el-icon><CircleCheck /></el-icon>已登录真实账号</span
        ><span
          ><el-icon><CircleCheck /></el-icon>当前商家独立授权</span
        >
      </div>
      <el-button :icon="ArrowLeft" @click="router.push('/')">返回工作台</el-button>
    </div>
  </section>
</template>
