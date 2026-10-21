<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { ArrowRight, Lock, Message, User } from '@element-plus/icons-vue';
import BrandMark from '../components/BrandMark.vue';
import { useAuthStore } from '../stores/auth';
import { safeRedirect } from '../router/policy';
import { failureMessage } from '../utils/feedback';
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const registering = computed(() => route.path === '/register');
const form = ref<FormInstance>();
const values = reactive({ displayName: '', email: '', password: '', confirm: '' });
const submitting = ref(false);
const errorMessage = ref('');
const rules = computed<FormRules>(() => ({
  email: [
    { required: true, message: '请输入邮箱地址', trigger: 'blur' },
    { type: 'email', message: '请输入正确的邮箱格式', trigger: 'blur' },
    { max: 320, message: '邮箱地址过长', trigger: 'blur' },
  ],
  displayName: [{ max: 100, message: '显示名称最多 100 个字符', trigger: 'blur' }],
  password: [
    {
      validator: (_rule, value: string, done) => {
        if (!value) return done(new Error('请输入密码'));
        if (new globalThis.TextEncoder().encode(value).length > 72 || /[\p{Cc}\p{Cs}]/u.test(value))
          return done(new Error('密码最多 72 个 UTF-8 字节，不能包含控制字符'));
        if (
          registering.value &&
          ([...value].length < 12 ||
            !/[a-z]/.test(value) ||
            !/[A-Z]/.test(value) ||
            !/\d/.test(value) ||
            !/[^a-zA-Z0-9]/.test(value))
        )
          return done(new Error('至少 12 位，包含大小写字母、数字和符号'));
        done();
      },
      trigger: 'blur',
    },
  ],
  confirm: [
    {
      validator: (_rule, value: string, done) =>
        value === values.password ? done() : done(new Error('两次输入的密码不一致')),
      trigger: 'blur',
    },
  ],
}));
watch(registering, () => {
  values.password = '';
  values.confirm = '';
  errorMessage.value = '';
  form.value?.clearValidate();
});
async function submit() {
  if (submitting.value || !(await form.value?.validate().catch(() => false))) return;
  submitting.value = true;
  errorMessage.value = '';
  try {
    if (registering.value) {
      await auth.client.register({
        email: values.email.trim(),
        password: values.password,
        ...(values.displayName.trim() ? { displayName: values.displayName.trim() } : {}),
      });
      values.password = '';
      values.confirm = '';
      ElMessage.success('注册成功，请使用新账号登录');
      await router.replace({ path: '/login', query: route.query });
    } else {
      await auth.login(values.email.trim(), values.password);
      values.password = '';
      await router.replace(safeRedirect(route.query.redirect));
    }
  } catch (error) {
    errorMessage.value = failureMessage(error);
  } finally {
    submitting.value = false;
  }
}
</script>
<template>
  <main class="auth-page">
    <section class="auth-story">
      <a class="brand auth-brand" href="/login"
        ><BrandMark /><span>采仓管家<small>CAICANG MANAGER</small></span></a
      >
      <div class="story-content">
        <span class="story-label"><span class="status-dot"></span> 自采自仓 · 协同管理</span>
        <h1>采购有据，<br />仓储有序。</h1>
        <p>从采购到仓库，再到每一次发货。<br />让商品、成本与库存，都有清晰的去向。</p>
        <div class="warehouse-art" aria-hidden="true">
          <svg viewBox="0 0 500 290" fill="none">
            <path d="m35 184 217-112 213 112-215 114Z" fill="#203e49" />
            <path d="m93 135 154-80 154 80v91l-154 79-154-79Z" fill="#244a54" />
            <path d="m93 135 154 80 154-80-154-80-154 80Z" fill="#3c6f75" />
            <path d="m247 215 154-80v91l-154 79v-90Z" fill="#17343e" />
            <path d="m93 135 154 80v90L93 226v-91Z" fill="#2a545d" />
            <path d="m72 133 175-93 176 93-21 12-155-81-154 81-21-12Z" fill="#9accc1" />
            <path d="m117 158 51 27v56l-51-26v-57ZM185 194l40 21v56l-40-21v-56Z" fill="#14303b" />
            <path d="m270 220 42-22v44l-42 22v-44ZM329 189l42-22v44l-42 22v-44Z" fill="#4d968c" />
            <path d="m40 210 40-21 40 21v43l-40 21-40-21v-43Z" fill="#c99260" />
            <path d="m40 210 40 22 40-22-40-21-40 21Z" fill="#efd0a4" />
            <path d="M80 232v42" stroke="#ac784c" stroke-width="2" />
            <circle cx="444" cy="99" r="27" stroke="#47766e" stroke-dasharray="4 5" />
            <path d="m429 101 15 8 15-8M444 109V92" stroke="#8bd0ba" stroke-width="2" />
          </svg>
        </div>
        <div class="flow-pills">
          <span>01 采购建档</span><i></i><span>02 验收入库</span><i></i><span>03 出库发货</span>
        </div>
      </div>
      <p class="story-footer">为每一份认真经营，提供有序的工作空间。</p>
    </section>
    <section class="auth-form-side">
      <div class="auth-form-wrap">
        <span class="section-kicker">你的仓储工作空间</span>
        <h2>{{ registering ? '创建账号' : '欢迎回来' }}</h2>
        <p class="muted auth-subtitle">
          {{ registering ? '从一个账号开始，让业务井井有条。' : '登录采仓管家，开始今天的工作。' }}
        </p>
        <el-alert
          v-if="errorMessage"
          :title="errorMessage"
          type="error"
          :closable="false"
          show-icon
          class="form-alert"
        /><el-form
          ref="form"
          :model="values"
          :rules="rules"
          label-position="top"
          size="large"
          @submit.prevent="submit"
          ><el-form-item v-if="registering" label="显示名称（选填）" prop="displayName"
            ><el-input
              v-model="values.displayName"
              placeholder="怎么称呼你"
              :prefix-icon="User"
              autocomplete="nickname"
              maxlength="100"
              :disabled="submitting" /></el-form-item
          ><el-form-item label="邮箱地址" prop="email"
            ><el-input
              v-model="values.email"
              placeholder="name@example.com"
              :prefix-icon="Message"
              autocomplete="username"
              maxlength="320"
              :disabled="submitting" /></el-form-item
          ><el-form-item label="密码" prop="password"
            ><el-input
              v-model="values.password"
              type="password"
              show-password
              :prefix-icon="Lock"
              :placeholder="registering ? '至少 12 位，含大小写、数字及符号' : '请输入登录密码'"
              :autocomplete="registering ? 'new-password' : 'current-password'"
              :disabled="submitting" /></el-form-item
          ><el-form-item v-if="registering" label="确认密码" prop="confirm"
            ><el-input
              v-model="values.confirm"
              type="password"
              show-password
              placeholder="再次输入密码"
              autocomplete="new-password"
              :prefix-icon="Lock"
              :disabled="submitting"
          /></el-form-item>
          <p class="auth-hint">
            <el-icon><Lock /></el-icon
            >{{
              registering
                ? '密码使用安全哈希保存，请勿使用其他平台的密码'
                : '请在可信设备上使用，离开时记得退出登录'
            }}
          </p>
          <el-button
            class="full-width auth-submit"
            type="primary"
            size="large"
            native-type="submit"
            :loading="submitting"
            >{{ registering ? '创建账号' : '登录工作空间'
            }}<el-icon v-if="!submitting" class="button-arrow"><ArrowRight /></el-icon></el-button
        ></el-form>
        <p class="auth-switch">
          {{ registering ? '已经有账号？' : '还没有账号？' }}
          <router-link :to="{ path: registering ? '/login' : '/register', query: route.query }">{{
            registering ? '去登录' : '立即注册'
          }}</router-link>
        </p>
      </div>
      <footer class="auth-copyright">© 2026 采仓管家 · 让仓储更有条理</footer>
    </section>
  </main>
</template>
