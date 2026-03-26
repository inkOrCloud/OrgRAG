import { useEffect, useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import {
  Layout,
  Menu,
  Button,
  Avatar,
  Dropdown,
  Space,
  Typography,
  Tooltip,
  Badge,
  Modal,
  Input,
  Form,
  message as _msg,
  App,
  Switch,
  Tag,
  Divider,
} from 'antd'
import {
  FileTextOutlined,
  ApartmentOutlined,
  SearchOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UserOutlined,
  LogoutOutlined,
  SettingOutlined,
  MoonOutlined,
  SunOutlined,
  HeartOutlined,
  ApiOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  LoadingOutlined,
  TeamOutlined,
  IdcardOutlined,
  DatabaseOutlined,
} from '@ant-design/icons'
import KBSelector from './KBSelector'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'
import { getHealth } from '@/api/client'
import type { HealthStatus } from '@/types'

const { Sider, Header, Content } = Layout
const { Text } = Typography

const BASE_NAV_ITEMS = [
  { key: '/documents', icon: <FileTextOutlined />, label: '文档管理' },
  { key: '/query',     icon: <SearchOutlined />,   label: '知识库问答' },
  { key: '/graph',     icon: <ApiOutlined />,       label: '知识图谱' },
]

const ADMIN_NAV_ITEMS = [
  { key: '/users',         icon: <TeamOutlined />,     label: '用户管理' },
  { key: '/knowledge-bases', icon: <DatabaseOutlined />, label: '知识库管理' },
  { key: '/organizations', icon: <ApartmentOutlined />, label: '组织管理' },
]

export default function AppLayout() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const { logout, username, isGuest, webuiTitle, coreVersion, apiVersion, role, isAdmin } = useAuthStore()
  const { isDark, toggleDark, sidebarCollapsed, setSidebarCollapsed, apiBaseUrl, setApiBaseUrl } = useSettingsStore()

  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [healthLoading, setHealthLoading] = useState(true)
  const [healthError, setHealthError] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [apiUrlTemp, setApiUrlTemp] = useState(apiBaseUrl)

  useEffect(() => {
    let mounted = true
    const check = async () => {
      try {
        const h = await getHealth()
        if (mounted) { setHealth(h); setHealthError(false) }
      } catch {
        if (mounted) setHealthError(true)
      } finally {
        if (mounted) setHealthLoading(false)
      }
    }
    check()
    const id = setInterval(check, 30000)
    return () => { mounted = false; clearInterval(id) }
  }, [])

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  const handleSaveSettings = () => {
    setApiBaseUrl(apiUrlTemp)
    message.success('设置已保存')
    setSettingsOpen(false)
  }

  const navItems = [
    ...BASE_NAV_ITEMS,
    ...(isAdmin() ? ADMIN_NAV_ITEMS : []),
  ]

  const userMenuItems = [
    {
      key: 'user-info',
      label: (
        <div style={{ padding: '4px 0' }}>
          <Text strong>{isGuest ? '访客用户' : username}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 11 }}>
            {role === 'admin' ? '🔑 管理员' : role === 'guest' ? '👤 访客' : '👤 普通用户'}
            {coreVersion ? `  v${coreVersion}` : ''}
          </Text>
        </div>
      ),
      disabled: true,
    },
    { type: 'divider' as const },
    {
      key: 'profile',
      icon: <IdcardOutlined />,
      label: '个人中心',
      onClick: () => navigate('/profile'),
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: '系统设置',
      onClick: () => setSettingsOpen(true),
    },
    { type: 'divider' as const },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      danger: true,
      onClick: handleLogout,
    },
  ]

  const HealthIndicator = () => {
    if (healthLoading) return <LoadingOutlined style={{ color: '#fa8c16' }} />
    if (healthError) return (
      <Tooltip title={`无法连接到 ${webuiTitle || 'LightRAG'} 服务器`}>
        <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />
      </Tooltip>
    )
    return (
      <Tooltip title={`${webuiTitle || 'LightRAG'} 运行正常${health?.pipeline_busy ? '（管道处理中）' : ''}`}>
        <Badge
          dot
          status={health?.pipeline_busy ? 'processing' : 'success'}
        >
          <CheckCircleOutlined style={{ color: '#52c41a' }} />
        </Badge>
      </Tooltip>
    )
  }

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      {/* 侧边栏 */}
      <Sider
        collapsible
        collapsed={sidebarCollapsed}
        onCollapse={setSidebarCollapsed}
        trigger={null}
        width={220}
        style={{
          borderRight: isDark ? '1px solid #303030' : '1px solid #f0f0f0',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Logo */}
        <div style={{
          height: 56,
          display: 'flex',
          alignItems: 'center',
          padding: sidebarCollapsed ? '0 0 0 24px' : '0 20px',
          gap: 10,
          borderBottom: isDark ? '1px solid #303030' : '1px solid #f0f0f0',
          overflow: 'hidden',
        }}>
          <span style={{ fontSize: 24, flexShrink: 0 }}>⚡</span>
          {!sidebarCollapsed && (
            <Text strong style={{ fontSize: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {webuiTitle || 'LightRAG'}
            </Text>
          )}
        </div>

        {/* 知识库选择器 */}
        <KBSelector collapsed={sidebarCollapsed} />

        {/* 导航菜单 */}
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          style={{ flex: 1, border: 'none', paddingTop: 4 }}
          items={navItems.map((item) => ({
            key: item.key,
            icon: item.icon,
            label: item.label,
            onClick: () => navigate(item.key),
          }))}
        />

        {/* 底部状态 */}
        {!sidebarCollapsed && (
          <div style={{
            padding: '12px 20px',
            borderTop: isDark ? '1px solid #303030' : '1px solid #f0f0f0',
          }}>
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Space>
                <HealthIndicator />
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {healthError ? '连接断开' : health?.pipeline_busy ? '处理中...' : '运行正常'}
                </Text>
              </Space>
              {health?.configuration?.llm_model && (
                <Text type="secondary" style={{ fontSize: 10, display: 'block' }}>
                  模型：{health.configuration.llm_model}
                </Text>
              )}
            </Space>
          </div>
        )}
      </Sider>

      {/* 右侧：顶栏 + 内容 */}
      <Layout>
        <Header style={{
          height: 56,
          padding: '0 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: isDark ? '1px solid #303030' : '1px solid #f0f0f0',
          lineHeight: 'normal',
        }}>
          <Button
            type="text"
            icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          />

          <Space>
            {health?.pipeline_busy && (
              <Tag icon={<LoadingOutlined spin />} color="processing">
                处理中
              </Tag>
            )}

            {apiVersion && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                API v{apiVersion}
              </Text>
            )}

            {/* 深色模式切换 */}
            <Tooltip title={isDark ? '切换亮色模式' : '切换深色模式'}>
              <Switch
                checked={isDark}
                onChange={toggleDark}
                checkedChildren={<MoonOutlined />}
                unCheckedChildren={<SunOutlined />}
                size="small"
              />
            </Tooltip>

            {/* 用户菜单 */}
            <Dropdown
              menu={{ items: userMenuItems }}
              trigger={['click']}
              placement="bottomRight"
            >
              <Avatar
                style={{
                  background: isGuest ? '#8c8c8c' : '#1677ff',
                  cursor: 'pointer',
                }}
                size={32}
                icon={<UserOutlined />}
              >
                {!isGuest && username ? username[0].toUpperCase() : undefined}
              </Avatar>
            </Dropdown>
          </Space>
        </Header>

        <Content style={{ overflow: 'auto', flex: 1 }}>
          <Outlet />
        </Content>
      </Layout>

      {/* 系统设置弹窗 */}
      <Modal
        title={<Space><SettingOutlined /> 系统设置</Space>}
        open={settingsOpen}
        onCancel={() => setSettingsOpen(false)}
        onOk={handleSaveSettings}
        okText="保存"
        cancelText="取消"
        width={480}
      >
        <Divider orientation="left" style={{ fontSize: 13 }}>外观</Divider>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Space>
            {isDark ? <MoonOutlined /> : <SunOutlined />}
            <Text>深色模式</Text>
          </Space>
          <Switch checked={isDark} onChange={toggleDark} />
        </div>

        <Divider orientation="left" style={{ fontSize: 13 }}>API 连接</Divider>
        <Form layout="vertical">
          <Form.Item
            label="后端 API 地址"
            help="留空表示使用同源地址。开发环境可设为 http://localhost:9621"
          >
            <Input
              value={apiUrlTemp}
              onChange={(e) => setApiUrlTemp(e.target.value)}
              placeholder="http://localhost:9621"
              prefix={<ApiOutlined />}
              allowClear
            />
          </Form.Item>
        </Form>

        {health && (
          <>
            <Divider orientation="left" style={{ fontSize: 13 }}>系统信息</Divider>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
              {[
                { label: '语言模型', value: `${health.configuration.llm_binding} / ${health.configuration.llm_model}` },
                { label: '嵌入模型', value: `${health.configuration.embedding_binding} / ${health.configuration.embedding_model}` },
                { label: '向量存储', value: health.configuration.vector_storage },
                { label: '图谱存储', value: health.configuration.graph_storage },
                { label: '核心版本', value: coreVersion || '-' },
                { label: 'API 版本', value: apiVersion || '-' },
              ].map(({ label, value }) => (
                <div key={label}>
                  <Text type="secondary" style={{ fontSize: 11 }}>{label}</Text>
                  <Text style={{ display: 'block', fontSize: 12 }}>{value}</Text>
                </div>
              ))}
            </div>
          </>
        )}

        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <Space>
            <HeartOutlined style={{ color: '#ff4d4f' }} />
            <Text type="secondary" style={{ fontSize: 11 }}>
              {webuiTitle || 'LightRAG'} — 基于图谱的检索增强生成框架
            </Text>
          </Space>
        </div>
      </Modal>
    </Layout>
  )
}
