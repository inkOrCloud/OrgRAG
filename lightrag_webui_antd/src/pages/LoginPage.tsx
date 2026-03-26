import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Form,
  Input,
  Button,
  Card,
  Typography,
  Alert,
  Divider,
  Space,
  Switch,
  Tooltip,
} from 'antd'
import { UserOutlined, LockOutlined, ThunderboltOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons'
import { getAuthStatus, login } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'

const { Title, Text } = Typography

export default function LoginPage() {
  const navigate = useNavigate()
  const { isAuthenticated, setAuthInfo } = useAuthStore()
  const { isDark, toggleDark } = useSettingsStore()

  const [loading, setLoading] = useState(false)
  const [guestLoading, setGuestLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [authConfigured, setAuthConfigured] = useState(true)
  const [checking, setChecking] = useState(true)
  const [webuiTitle, setWebuiTitle] = useState('LightRAG')

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/', { replace: true })
      return
    }

    getAuthStatus()
      .then((res) => {
        setWebuiTitle(res.webui_title || 'LightRAG')
        setAuthConfigured(res.auth_configured)
        if (!res.auth_configured && res.access_token) {
          setAuthInfo({
            token: res.access_token,
            isGuest: true,
            authMode: res.auth_mode,
            coreVersion: res.core_version,
            apiVersion: res.api_version,
            webuiTitle: res.webui_title,
            webuiDescription: res.webui_description,
          })
          navigate('/', { replace: true })
        }
      })
      .catch(() => setError(`无法连接到 ${webuiTitle} 服务器，请检查 API 地址是否正确。`))
      .finally(() => setChecking(false))
  }, [isAuthenticated, navigate, setAuthInfo])

  const handleLogin = async (values: { username: string; password: string }) => {
    setLoading(true)
    setError(null)
    try {
      const res = await login(values.username, values.password)
      setAuthInfo({
        token: res.access_token,
        isGuest: false,
        role: res.role,
        username: values.username,
        authMode: res.auth_mode,
        coreVersion: res.core_version,
        apiVersion: res.api_version,
        webuiTitle: res.webui_title,
        webuiDescription: res.webui_description,
      })
      navigate('/', { replace: true })
    } catch {
      setError('用户名或密码错误，请重试。')
    } finally {
      setLoading(false)
    }
  }

  const handleGuestLogin = async () => {
    setGuestLoading(true)
    setError(null)
    try {
      const res = await getAuthStatus()
      if (res.access_token) {
        setAuthInfo({
          token: res.access_token,
          isGuest: true,
          authMode: res.auth_mode,
          coreVersion: res.core_version,
          apiVersion: res.api_version,
          webuiTitle: res.webui_title,
          webuiDescription: res.webui_description,
        })
        navigate('/', { replace: true })
      } else {
        setError('访客模式不可用。')
      }
    } catch {
      setError('连接服务器失败，请稍后重试。')
    } finally {
      setGuestLoading(false)
    }
  }

  if (checking) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: isDark ? '#0a0a0a' : '#f0f2f5',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⚡</div>
          <Text type="secondary">正在连接到 {webuiTitle}...</Text>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: isDark
        ? 'linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%)'
        : 'linear-gradient(135deg, #e0f2fe 0%, #f0f0ff 100%)',
      padding: 24,
    }}>
      <div style={{ position: 'fixed', top: 20, right: 24 }}>
        <Tooltip title={isDark ? '切换到亮色模式' : '切换到深色模式'}>
          <Switch
            checked={isDark}
            onChange={toggleDark}
            checkedChildren={<MoonOutlined />}
            unCheckedChildren={<SunOutlined />}
          />
        </Tooltip>
      </div>

      <Card
        style={{
          width: '100%',
          maxWidth: 420,
          boxShadow: isDark
            ? '0 8px 32px rgba(0,0,0,0.5)'
            : '0 8px 32px rgba(0,0,0,0.1)',
          borderRadius: 16,
        }}
        styles={{ body: { padding: '40px 40px 32px' } }}
      >
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            fontSize: 48,
            lineHeight: 1,
            marginBottom: 12,
            background: 'linear-gradient(135deg, #1677ff, #9254de)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}>
            ⚡
          </div>
          <Title level={2} style={{ margin: 0, fontSize: 24 }}>{webuiTitle}</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            基于图谱的检索增强生成框架
          </Text>
        </div>

        {error && (
          <Alert
            type="error"
            message={error}
            style={{ marginBottom: 20, borderRadius: 8 }}
            showIcon
            closable
            onClose={() => setError(null)}
          />
        )}

        {authConfigured ? (
          <>
            <Form
              layout="vertical"
              onFinish={handleLogin}
              requiredMark={false}
              size="large"
            >
              <Form.Item
                name="username"
                rules={[{ required: true, message: '请输入用户名' }]}
              >
                <Input
                  prefix={<UserOutlined style={{ color: '#bfbfbf' }} />}
                  placeholder="用户名"
                  autoComplete="username"
                />
              </Form.Item>

              <Form.Item
                name="password"
                rules={[{ required: true, message: '请输入密码' }]}
              >
                <Input.Password
                  prefix={<LockOutlined style={{ color: '#bfbfbf' }} />}
                  placeholder="密码"
                  autoComplete="current-password"
                />
              </Form.Item>

              <Form.Item style={{ marginBottom: 8 }}>
                <Button
                  type="primary"
                  htmlType="submit"
                  block
                  loading={loading}
                  style={{ height: 44, borderRadius: 8, fontWeight: 600 }}
                >
                  登录
                </Button>
              </Form.Item>
            </Form>

            <Divider style={{ margin: '16px 0', fontSize: 12 }}>或</Divider>

            <Button
              block
              icon={<ThunderboltOutlined />}
              loading={guestLoading}
              onClick={handleGuestLogin}
              style={{ height: 44, borderRadius: 8 }}
            >
              访客模式进入
            </Button>
          </>
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <Alert
              type="info"
              message="未启用身份验证"
              description={`您可以直接访问 ${webuiTitle}，无需输入凭据。`}
              showIcon
            />
            <Button
              type="primary"
              block
              icon={<ThunderboltOutlined />}
              loading={guestLoading}
              onClick={handleGuestLogin}
              style={{ height: 44, borderRadius: 8, fontWeight: 600 }}
            >
              进入 {webuiTitle}
            </Button>
          </Space>
        )}
      </Card>
    </div>
  )
}
