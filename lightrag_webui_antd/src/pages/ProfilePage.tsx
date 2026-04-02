import { useEffect, useRef, useState } from 'react'
import {
  Card, Descriptions, Tag, Form, Input, Button, App, Typography, Space,
  Divider, Spin, Avatar, Tooltip, Popconfirm,
} from 'antd'
import {
  UserOutlined, LockOutlined, CameraOutlined, DeleteOutlined,
} from '@ant-design/icons'
import { getMe, changeMyPassword, uploadMyAvatar, deleteMyAvatar } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'
import type { User, UserRole } from '@/types'

const { Title, Text } = Typography

const ROLE_CONFIG: Record<UserRole, { color: string; label: string }> = {
  admin: { color: 'red', label: '系统管理员' },
  user: { color: 'blue', label: '普通用户' },
}

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const MAX_SIZE_MB = 2

export default function ProfilePage() {
  const { message } = App.useApp()
  const { username, role, avatarUrl, setAvatarUrl } = useAuthStore()
  const { apiBaseUrl } = useSettingsStore()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [pwLoading, setPwLoading] = useState(false)
  const [avatarLoading, setAvatarLoading] = useState(false)
  const [form] = Form.useForm()
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    getMe()
      .then((res) => {
        setUser(res.user)
        setAvatarUrl(res.user.avatar_url ?? '')
      })
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

  const handleAvatarFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset so same file can be re-selected
    e.target.value = ''

    if (!ALLOWED_TYPES.includes(file.type)) {
      message.error('仅支持 JPEG、PNG、GIF、WebP 格式')
      return
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      message.error(`图片大小不能超过 ${MAX_SIZE_MB} MB`)
      return
    }
    setAvatarLoading(true)
    try {
      const res = await uploadMyAvatar(file)
      setAvatarUrl(res.avatar_url)
      message.success('头像更新成功')
    } catch {
      message.error('头像上传失败，请重试')
    } finally {
      setAvatarLoading(false)
    }
  }

  const handleDeleteAvatar = async () => {
    setAvatarLoading(true)
    try {
      await deleteMyAvatar()
      setAvatarUrl('')
      message.success('头像已移除')
    } catch {
      message.error('移除头像失败，请重试')
    } finally {
      setAvatarLoading(false)
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
  const base = apiBaseUrl.replace(/\/$/, '')
  const fullAvatarUrl = avatarUrl ? `${base}${avatarUrl}` : undefined

  return (
    <div style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
      <Title level={4}>个人中心</Title>

      {/* 头像 */}
      <Card
        title={<Space><CameraOutlined /> 我的头像</Space>}
        style={{ marginBottom: 24 }}
      >
        <Space align="center" size={24}>
          <Spin spinning={avatarLoading}>
            <Avatar
              size={80}
              src={fullAvatarUrl}
              icon={!fullAvatarUrl ? <UserOutlined /> : undefined}
              style={{ background: fullAvatarUrl ? undefined : '#1677ff', flexShrink: 0 }}
            >
              {!fullAvatarUrl && username ? username[0].toUpperCase() : undefined}
            </Avatar>
          </Spin>
          <Space direction="vertical" size={8}>
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_TYPES.join(',')}
              style={{ display: 'none' }}
              onChange={handleAvatarFileChange}
            />
            <Tooltip title="支持 JPEG / PNG / GIF / WebP，最大 2 MB">
              <Button
                icon={<CameraOutlined />}
                onClick={() => fileInputRef.current?.click()}
                loading={avatarLoading}
              >
                {fullAvatarUrl ? '更换头像' : '上传头像'}
              </Button>
            </Tooltip>
            {fullAvatarUrl && (
              <Popconfirm
                title="确认移除头像？"
                onConfirm={handleDeleteAvatar}
                okText="移除"
                cancelText="取消"
              >
                <Button danger icon={<DeleteOutlined />} size="small">
                  移除头像
                </Button>
              </Popconfirm>
            )}
            <Text type="secondary" style={{ fontSize: 12 }}>
              建议上传正方形图片，最大 2 MB
            </Text>
          </Space>
        </Space>
      </Card>

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
            {displayUser.email || <Text type="secondary">未设置</Text>}
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
      </Card>
    </div>
  )
}

