import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { useAuth } from './composables/useAuth'
import { bootstrapSSO } from './lib/sso'
import './styles/main.css'

const { initialize } = useAuth()

const app = createApp(App)
app.use(router)

bootstrapSSO()
  .then(() => initialize())
  .then(() => app.mount('#app'))
