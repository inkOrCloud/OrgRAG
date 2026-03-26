import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ConfigProvider, App as AntdApp, theme as antdTheme, Spin } from 'antd'
import { useSettingsStore } from './stores/settings'
import { useAuthStore } from './stores/auth'
import AppLayout from './components/AppLayout'
import LoginPage from './pages/LoginPage'
import SetupPage from './pages/SetupPage'
import DocumentsPage from './pages/DocumentsPage'
import QueryPage from './pages/QueryPage'
import GraphPage from './pages/GraphPage'
import UsersPage from './pages/UsersPage'
import ProfilePage from './pages/ProfilePage'
import KnowledgeBasesPage from './pages/KnowledgeBasesPage'
import OrganizationsPage from './pages/OrganizationsPage'
import { getAuthStatus } from './api/client'
import 'antd/dist/reset.css'

/**
 * Checks setup status once at app boot and blocks rendering until known.
 * Redirects everything to /setup when setup_required is true.
 */
function SetupGuard({ children }: { children: React.ReactNode }) {
  const { setupRequired, setSetupRequired } = useAuthStore()
  const [checking, setChecking] = useState(setupRequired === null)

  useEffect(() => {
    if (setupRequired !== null) return  // already known
    getAuthStatus()
      .then((res) => setSetupRequired(res.setup_required ?? false))
      .catch(() => setSetupRequired(false))   // if server unreachable, let LoginPage handle it
      .finally(() => setChecking(false))
  }, [setupRequired, setSetupRequired])

  if (checking) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" />
      </div>
    )
  }

  if (setupRequired) return <Navigate to="/setup" replace />
  return <>{children}</>
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <>{children}</>
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isAdmin } = useAuthStore()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (!isAdmin()) return <Navigate to="/documents" replace />
  return <>{children}</>
}

export default function App() {
  const { isDark } = useSettingsStore()

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 8,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        },
        components: {
          Layout: {
            siderBg: isDark ? '#141414' : '#fff',
            headerBg: isDark ? '#1f1f1f' : '#fff',
          },
        },
      }}
    >
      <AntdApp>
        <BrowserRouter basename="/webui">
          <Routes>
            {/* Setup wizard – always accessible, no auth required */}
            <Route path="/setup" element={<SetupPage />} />

            {/* Login – guarded: redirects to /setup if setup not done */}
            <Route
              path="/login"
              element={
                <SetupGuard>
                  <LoginPage />
                </SetupGuard>
              }
            />

            {/* Main app – guarded: redirects to /setup if not done, then /login */}
            <Route
              path="/"
              element={
                <SetupGuard>
                  <ProtectedRoute>
                    <AppLayout />
                  </ProtectedRoute>
                </SetupGuard>
              }
            >
              <Route index element={<Navigate to="/documents" replace />} />
              <Route path="documents" element={<DocumentsPage />} />
              <Route path="query" element={<QueryPage />} />
              <Route path="graph" element={<GraphPage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route
                path="users"
                element={
                  <AdminRoute>
                    <UsersPage />
                  </AdminRoute>
                }
              />
              <Route path="knowledge-bases" element={<KnowledgeBasesPage />} />
              <Route path="organizations" element={<OrganizationsPage />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AntdApp>
    </ConfigProvider>
  )
}
