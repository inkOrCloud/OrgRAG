import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Steps,
  Form,
  Input,
  Button,
  Card,
  Typography,
  Alert,
  Space,
  Divider,
  Switch,
  Tooltip,
  Result,
} from 'antd'
import {
  UserOutlined,
  LockOutlined,
  ApartmentOutlined,
  DatabaseOutlined,
  CheckCircleOutlined,
  MoonOutlined,
  SunOutlined,
} from '@ant-design/icons'
import { completeSetup } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'
import type { SetupRequest } from '@/types'

const { Title, Text, Paragraph } = Typography

// ── Step components ────────────────────────────────────────────────────────────

function StepAdmin({ form }: { form: ReturnType<typeof Form.useForm>[0] }) {
  return (
    <Form form={form} layout="vertical" requiredMark={false} size="large">
      <Paragraph type="secondary" style={{ marginBottom: 24 }}>
        创建系统初始管理员账号。此账号将拥有完整的系统管理权限。
      </Paragraph>
      <Form.Item name="admin_username" label="用户名"
        rules={[{ required: true, message: '请输入用户名' }, { min: 3, message: '用户名至少3个字符' }]}>
        <Input prefix={<UserOutlined />} placeholder="admin" autoComplete="username" />
      </Form.Item>
      <Form.Item name="admin_email" label="电子邮箱（可选）">
        <Input prefix={<UserOutlined />} placeholder="admin@example.com" autoComplete="email" />
      </Form.Item>
      <Form.Item name="admin_password" label="密码"
        rules={[{ required: true, message: '请输入密码' }, { min: 6, message: '密码至少6个字符' }]}>
        <Input.Password prefix={<LockOutlined />} placeholder="至少6位字符" autoComplete="new-password" />
      </Form.Item>
      <Form.Item name="admin_password_confirm" label="确认密码"
        dependencies={['admin_password']}
        rules={[
          { required: true, message: '请确认密码' },
          ({ getFieldValue }) => ({
            validator(_, value) {
              if (!value || getFieldValue('admin_password') === value) return Promise.resolve()
              return Promise.reject(new Error('两次输入的密码不一致'))
            },
          }),
        ]}>
        <Input.Password prefix={<LockOutlined />} placeholder="再次输入密码" autoComplete="new-password" />
      </Form.Item>
    </Form>
  )
}

function StepOrg({ form }: { form: ReturnType<typeof Form.useForm>[0] }) {
  return (
    <Form form={form} layout="vertical" requiredMark={false} size="large">
      <Paragraph type="secondary" style={{ marginBottom: 24 }}>
        创建根组织。组织是管理用户和知识库的基本单元，后续可以在组织下创建子组织和成员。
      </Paragraph>
      <Form.Item name="org_name" label="组织名称"
        rules={[{ required: true, message: '请输入组织名称' }]}>
        <Input prefix={<ApartmentOutlined />} placeholder="例如：我的团队" />
      </Form.Item>
      <Form.Item name="org_description" label="组织描述（可选）">
        <Input.TextArea rows={3} placeholder="简短描述该组织的用途" />
      </Form.Item>
    </Form>
  )
}

function StepKB({ form }: { form: ReturnType<typeof Form.useForm>[0] }) {
  return (
    <Form form={form} layout="vertical" requiredMark={false} size="large">
      <Paragraph type="secondary" style={{ marginBottom: 24 }}>
        创建第一个知识库。知识库将自动归属于上一步创建的组织根节点。
      </Paragraph>
      <Form.Item name="kb_name" label="知识库名称"
        rules={[{ required: true, message: '请输入知识库名称' }]}>
        <Input prefix={<DatabaseOutlined />} placeholder="例如：主知识库" />
      </Form.Item>
      <Form.Item name="kb_description" label="知识库描述（可选）">
        <Input.TextArea rows={3} placeholder="简短描述该知识库的内容" />
      </Form.Item>
    </Form>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

const STEPS = [
  { title: '管理员账号', icon: <UserOutlined /> },
  { title: '组织', icon: <ApartmentOutlined /> },
  { title: '知识库', icon: <DatabaseOutlined /> },
]

export default function SetupPage() {
  const navigate = useNavigate()
  const { setAuthInfo, setSetupRequired } = useAuthStore()
  const { isDark, toggleDark } = useSettingsStore()

  const [current, setCurrent] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // Persist form values across step changes (forms unmount when step switches)
  const [adminData, setAdminData] = useState<Record<string, string>>({})
  const [orgData, setOrgData] = useState<Record<string, string>>({})

  const [adminForm] = Form.useForm()
  const [orgForm] = Form.useForm()
  const [kbForm] = Form.useForm()

  const forms = [adminForm, orgForm, kbForm]

  const handleNext = async () => {
    try {
      await forms[current].validateFields()
      // Snapshot values before the form unmounts
      if (current === 0) setAdminData(adminForm.getFieldsValue())
      if (current === 1) setOrgData(orgForm.getFieldsValue())
      setCurrent(current + 1)
      setError(null)
    } catch {
      // validation errors shown inline
    }
  }

  const handleBack = () => {
    setCurrent(current - 1)
    setError(null)
  }

  const handleFinish = async () => {
    try {
      await kbForm.validateFields()
    } catch {
      return
    }

    const kbValues = kbForm.getFieldsValue()

    const payload: SetupRequest = {
      admin_username: adminData.admin_username,
      admin_password: adminData.admin_password,
      admin_email: adminData.admin_email || '',
      org_name: orgData.org_name,
      org_description: orgData.org_description || '',
      kb_name: kbValues.kb_name,
      kb_description: kbValues.kb_description || '',
    }

    setLoading(true)
    setError(null)
    try {
      const res = await completeSetup(payload)
      setAuthInfo({
        token: res.access_token,
        role: res.role,
        username: res.username,
      })
      setSetupRequired(false)
      setDone(true)
    } catch (err: unknown) {
      // Pydantic v2 errors return detail as an array; convert to readable string
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      let msg: string
      if (Array.isArray(detail)) {
        msg = detail.map((d: { msg?: string; loc?: string[] }) =>
          `${d.loc?.join('.')} — ${d.msg}`
        ).join('; ')
      } else if (typeof detail === 'string') {
        msg = detail
      } else {
        msg = '初始化失败，请检查输入后重试'
      }
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const wrapperStyle: React.CSSProperties = {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: isDark
      ? 'linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%)'
      : 'linear-gradient(135deg, #e0f2fe 0%, #f0f0ff 100%)',
    padding: 24,
  }

  if (done) {
    return (
      <div style={wrapperStyle}>
        <Card style={{ maxWidth: 520, width: '100%', borderRadius: 16 }}
              styles={{ body: { padding: '48px 40px' } }}>
          <Result
            icon={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
            title="系统初始化完成！"
            subTitle="管理员账号、组织和知识库已创建成功。即将跳转到主界面…"
            extra={
              <Button type="primary" size="large"
                onClick={() => navigate('/', { replace: true })}>
                进入 LightRAG
              </Button>
            }
          />
        </Card>
      </div>
    )
  }

  return (
    <div style={wrapperStyle}>
      <div style={{ position: 'fixed', top: 20, right: 24 }}>
        <Tooltip title={isDark ? '切换到亮色模式' : '切换到深色模式'}>
          <Switch checked={isDark} onChange={toggleDark}
            checkedChildren={<MoonOutlined />} unCheckedChildren={<SunOutlined />} />
        </Tooltip>
      </div>

      <Card style={{ width: '100%', maxWidth: 560,
                     boxShadow: isDark ? '0 8px 32px rgba(0,0,0,0.5)' : '0 8px 32px rgba(0,0,0,0.1)',
                     borderRadius: 16 }}
            styles={{ body: { padding: '40px 40px 32px' } }}>

        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 48, lineHeight: 1, marginBottom: 12,
                        background: 'linear-gradient(135deg, #1677ff, #9254de)',
                        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            ⚡
          </div>
          <Title level={2} style={{ margin: 0, fontSize: 24 }}>LightRAG 初始化向导</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            请按步骤完成系统初始化配置
          </Text>
        </div>

        <Steps current={current} items={STEPS} style={{ marginBottom: 32 }} />

        <Divider style={{ margin: '0 0 28px' }} />

        {error && (
          <Alert type="error" message={error} showIcon closable
            style={{ marginBottom: 20, borderRadius: 8 }}
            onClose={() => setError(null)} />
        )}

        {current === 0 && <StepAdmin form={adminForm} />}
        {current === 1 && <StepOrg form={orgForm} />}
        {current === 2 && <StepKB form={kbForm} />}

        <Divider style={{ margin: '16px 0 24px' }} />

        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Button size="large" onClick={handleBack} disabled={current === 0}>
            上一步
          </Button>
          {current < STEPS.length - 1 ? (
            <Button type="primary" size="large" onClick={handleNext}>
              下一步
            </Button>
          ) : (
            <Button type="primary" size="large" loading={loading} onClick={handleFinish}>
              完成初始化
            </Button>
          )}
        </Space>
      </Card>
    </div>
  )
}
