import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ConfigProvider, App as AntdApp, theme as antdTheme } from 'antd'
import { useSettingsStore } from './stores/settings'
import { useAuthStore } from './stores/auth'
import AppLayout from './components/AppLayout'
import LoginPage from './pages/LoginPage'
import DocumentsPage from './pages/DocumentsPage'
import QueryPage from './pages/QueryPage'
import GraphPage from './pages/GraphPage'
import UsersPage from './pages/UsersPage'
import ProfilePage from './pages/ProfilePage'
import KnowledgeBasesPage from './pages/KnowledgeBasesPage'
import OrganizationsPage from './pages/OrganizationsPage'
import 'antd/dist/reset.css'

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
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
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
