import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { useAuth } from './composables/useAuth'
import './styles/main.css'

const { initialize } = useAuth()

const app = createApp(App)
app.use(router)

// Initialize auth before mounting so the router guard has session info
initialize().then(() => {
  app.mount('#app')
})
