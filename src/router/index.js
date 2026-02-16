import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '../composables/useAuth'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/LoginView.vue'),
    meta: { requiresGuest: true }
  },
  {
    path: '/',
    name: 'Dashboard',
    component: () => import('../views/DashboardView.vue'),
    meta: { requiresAuth: true }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to, _from, next) => {
  const { isAuthenticated, loading } = useAuth()

  if (loading.value) {
    const interval = setInterval(() => {
      if (!loading.value) {
        clearInterval(interval)
        doNavigationGuard(to, isAuthenticated, next)
      }
    }, 10)
    return
  }

  doNavigationGuard(to, isAuthenticated, next)
})

function doNavigationGuard(to, isAuthenticated, next) {
  if (to.meta.requiresAuth && !isAuthenticated.value) {
    next({ name: 'Login' })
  } else if (to.meta.requiresGuest && isAuthenticated.value) {
    next({ name: 'Dashboard' })
  } else {
    next()
  }
}

export default router
