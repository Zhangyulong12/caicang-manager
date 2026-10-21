<script setup lang="ts">
import { useAuthStore } from '../stores/auth';
import { useTenantStore } from '../stores/tenant';
import { roleNames } from '../router/policy';
const auth = useAuthStore();
const tenants = useTenantStore();
</script>
<template>
  <section>
    <div class="page-heading">
      <div>
        <span class="section-kicker">SETTINGS</span>
        <h1>系统设置</h1>
        <p class="muted">查看工作空间与当前账号，成员管理表单后续开放。</p>
      </div>
    </div>
    <div class="surface settings-panel">
      <h2>商家与账号</h2>
      <el-descriptions :column="1" border
        ><el-descriptions-item label="商家名称">{{
          tenants.current?.tenant.name
        }}</el-descriptions-item
        ><el-descriptions-item label="商家编号">{{
          tenants.current?.tenant.id
        }}</el-descriptions-item
        ><el-descriptions-item label="登录邮箱">{{ auth.user?.email }}</el-descriptions-item
        ><el-descriptions-item label="当前角色">{{
          tenants.current ? roleNames[tenants.current.membership.role] : ''
        }}</el-descriptions-item></el-descriptions
      >
      <h3>当前服务端权限</h3>
      <div class="permission-tags">
        <el-tag v-for="permission in tenants.current?.permissions" :key="permission" type="info">{{
          permission
        }}</el-tag>
      </div>
    </div>
  </section>
</template>
