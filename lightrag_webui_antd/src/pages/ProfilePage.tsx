import { useEffect, useState } from 'react'
import {
  Card, Descriptions, Tag, Form, Input, Button, App, Typography, Space,
  Divider, Spin, Alert,
} from 'antd'
import {
  UserOutlined, LockOutlined, SafetyCertificateOutlined,
} from '@ant-design/icons'
import { getMe, changeMyPassword } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import type { User, UserRole } from '@/types'

const { Title } = Typography

const ROLE_CONFIG: Record<UserRole, { color: string; label: string }> = {
  admin: { color: 'red', label: '管理员' },
  user: { color: 'blue', label: '普通用户' },
  guest: { color: 'default', label: '访客' },
}

export default function ProfilePage() {
  const { message } = App.useApp()
  const { username, role } = useAuthStore()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [pwLoading, setPwLoading] = useState(false)
  const [form] = Form.useForm()

  useEffect(() => {
    getMe()
      .then((res) => setUser(res.user))
      .catch(() => message.error('获取用户信息失败'))
      .finally(() => setLoading(false))
  }, [])

  const handleChangePassword = async (values: {
    current_password: string
    new_password: string
    confirm_password: string
  }) => {
    if (values.new_password !== values.confirm_password) {
      message.error('两次输入的新密码不一致')
      return
    }
    setPwLoading(true)
    try {
      await changeMyPassword({
        current_password: values.current_password,
        new_password: values.new_password,
      })
      message.success('密码修改成功，请重新登录')
      form.resetFields()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail || '密码修改失败')
    } finally {
      setPwLoading(false)
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <Spin size="large" tip="加载中..." />
      </div>
    )
  }

  const displayUser = user ?? { username, role, email: '', is_active: true, created_at: '', updated_at: '' }
  const roleTag = ROLE_CONFIG[displayUser.role as UserRole] ?? { color: 'default', label: displayUser.role }

  return (
    <div style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
      <Title level={4}>个人中心</Title>

      {/* 账户信息 */}
      <Card
        title={<Space><UserOutlined /> 账户信息</Space>}
        style={{ marginBottom: 24 }}
      >
        <Descriptions column={1} size="middle">
          <Descriptions.Item label="用户名">
            <Space>
              <strong>{displayUser.username}</strong>
              <Tag color={roleTag.color}>{roleTag.label}</Tag>
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="邮箱">
            {displayUser.email || <Typography.Text type="secondary">未设置</Typography.Text>}
          </Descriptions.Item>
          {displayUser.created_at && (
            <Descriptions.Item label="注册时间">
              {new Date(displayUser.created_at).toLocaleString('zh-CN')}
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      {/* 修改密码 */}
      <Card title={<Space><LockOutlined /> 修改密码</Space>}>
        {role === 'guest' ? (
          <Alert
            type="info"
            message="访客模式下无法修改密码"
            icon={<SafetyCertificateOutlined />}
            showIcon
          />
        ) : (
          <Form
            form={form}
            layout="vertical"
            onFinish={handleChangePassword}
            style={{ maxWidth: 400 }}
          >
            <Form.Item
              name="current_password"
              label="当前密码"
              rules={[{ required: true, message: '请输入当前密码' }]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="请输入当前密码" />
            </Form.Item>

            <Divider style={{ margin: '12px 0' }} />

            <Form.Item
              name="new_password"
              label="新密码"
              rules={[
                { required: true, message: '请输入新密码' },
                { min: 6, message: '新密码至少6个字符' },
              ]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="请输入新密码（至少6位）" />
            </Form.Item>
            <Form.Item
              name="confirm_password"
              label="确认新密码"
              dependencies={['new_password']}
              rules={[
                { required: true, message: '请再次输入新密码' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('new_password') === value) return Promise.resolve()
                    return Promise.reject(new Error('两次输入的密码不一致'))
                  },
                }),
              ]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="请再次输入新密码" />
            </Form.Item>

            <Form.Item style={{ marginBottom: 0 }}>
              <Button type="primary" htmlType="submit" loading={pwLoading}>
                修改密码
              </Button>
            </Form.Item>
          </Form>
        )}
      </Card>
    </div>
  )
}

