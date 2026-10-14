import { createApp } from 'vue';
import { ElButton, ElCard, ElTag } from 'element-plus';
import 'element-plus/theme-chalk/base.css';
import 'element-plus/theme-chalk/el-button.css';
import 'element-plus/theme-chalk/el-card.css';
import 'element-plus/theme-chalk/el-tag.css';
import App from './App.vue';

createApp(App)
  .component('ElButton', ElButton)
  .component('ElCard', ElCard)
  .component('ElTag', ElTag)
  .mount('#app');
