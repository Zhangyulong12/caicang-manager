<template>
  <main class="status-page">
    <span class="status-code">403</span>
    <h1>当前角色没有此页面的访问权限</h1>
    <p class="muted">请联系商家管理员，或切换到你有权访问的工作空间。</p>
    <router-link to="/" class="el-button el-button--primary">返回首页</router-link
    ><router-link to="/select-tenant" class="el-button">切换商家</router-link>
  </main>
</template>
