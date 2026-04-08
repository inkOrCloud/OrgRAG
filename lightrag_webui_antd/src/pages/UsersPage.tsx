import { useEffect, useState } from 'react'
import {
  Table, Button, Space, Tag, Modal, Form, Input, Select, Switch,
  Popconfirm, App, Typography, Card, Badge, Alert,
} from 'antd'
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, UserOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { listUsers, createUser, updateUser, deleteUser } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import type { User, UserRole } from '@/types'

const { Title, Text } = Typography

const ROLE_CONFIG: Record<UserRole, { color: string; label: string }> = {
  admin: { color: 'red', label: '系统管理员' },
  user: { color: 'blue', label: '普通用户' },
}

export default function UsersPage() {
  const { message } = App.useApp()
  const { username: currentUsername } = useAuthStore()

  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [form] = Form.useForm()

  const fetchUsers = async () => {
    setLoading(true)
    try {
      const res = await listUsers()
      setUsers(res.users)
    } catch {
      message.error('获取用户列表失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchUsers() }, [])

  const openCreate = () => {
    setEditingUser(null)
    form.resetFields()
    form.setFieldsValue({ role: 'user', is_active: true })
    setModalOpen(true)
  }

  const openEdit = (user: User) => {
    setEditingUser(user)
    form.setFieldsValue({ email: user.email, role: user.role, is_active: user.is_active })
    setModalOpen(true)
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      if (editingUser) {
        await updateUser(editingUser.id, {
          email: values.email,
          role: values.role,
          is_active: values.is_active,
          ...(values.password ? { password: values.password } : {}),
        })
        message.success('用户信息已更新')
      } else {
        await createUser({
          username: values.username,
          password: values.password,
          email: values.email ?? '',
          role: values.role,
        })
        message.success('用户创建成功')
      }
      setModalOpen(false)
      fetchUsers()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(msg || (editingUser ? '更新失败' : '创建失败'))
    }
  }

  const handleDelete = async (user: User) => {
    try {
      await deleteUser(user.id)
      message.success(`用户 "${user.username}" 已删除`)
      fetchUsers()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(msg || '删除失败')
    }
  }

  const columns: ColumnsType<User> = [
    {
      title: '用户名',
      dataIndex: 'username',
      render: (v: string, record) => (
        <Space>
          <UserOutlined />
          <Text strong={v === currentUsername}>{v}</Text>
          {v === currentUsername && <Tag color="green">我</Tag>}
        </Space>
      ),
    },
    { title: '邮箱', dataIndex: 'email', render: (v: string) => v || <Text type="secondary">-</Text> },
    {
      title: '角色',
      dataIndex: 'role',
      render: (v: UserRole) => <Tag color={ROLE_CONFIG[v]?.color}>{ROLE_CONFIG[v]?.label ?? v}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      render: (v: boolean) => <Badge status={v ? 'success' : 'error'} text={v ? '启用' : '禁用'} />,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      render: (_: unknown, record: User) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>编辑</Button>
          <Popconfirm
            title={`确认删除用户 "${record.username}"？`}
            onConfirm={() => handleDelete(record)}
            disabled={record.username === currentUsername}
          >
            <Button
              size="small" danger icon={<DeleteOutlined />}
              disabled={record.username === currentUsername}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>用户管理</Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchUsers} loading={loading}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建用户</Button>
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="用户角色说明"
        description={
          <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
            <li><Tag color="red" style={{ marginRight: 4 }}>系统管理员</Tag>拥有系统全局权限：可管理所有用户账号、组织结构和知识库，不受组织归属限制。</li>
            <li><Tag color="blue" style={{ marginRight: 4 }}>普通用户</Tag>只能访问被授权的知识库；知识库读写权限由系统管理员在组织管理中单独配置。</li>
          </ul>
        }
      />

      <Card styles={{ body: { padding: 0, overflow: 'hidden' } }}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={users}
          loading={loading}
          scroll={{ x: 700 }}
          pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 个用户` }}
        />
      </Card>

      <Modal
        title={editingUser ? `编辑用户：${editingUser.username}` : '新建用户'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        okText={editingUser ? '保存' : '创建'}
        cancelText="取消"
        width={480}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          {!editingUser && (
            <>
              <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
                <Input placeholder="请输入用户名" prefix={<UserOutlined />} />
              </Form.Item>
              <Form.Item name="password" label="密码" rules={[
                { required: true, message: '请输入密码' },
                { min: 6, message: '密码至少6位' },
              ]}>
                <Input.Password placeholder="请输入密码（至少6位）" />
              </Form.Item>
            </>
          )}
          {editingUser && (
            <Form.Item name="password" label="新密码（留空则不修改）" rules={[
              { min: 6, message: '密码至少6位' },
            ]}>
              <Input.Password placeholder="留空则不修改密码" />
            </Form.Item>
          )}
          <Form.Item name="email" label="邮箱">
            <Input placeholder="请输入邮箱（选填）" type="email" />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true }]}>
            <Select>
              <Select.Option value="admin">系统管理员</Select.Option>
              <Select.Option value="user">普通用户</Select.Option>
            </Select>
          </Form.Item>
          {editingUser && (
            <Form.Item name="is_active" label="账户状态" valuePropName="checked">
              <Switch checkedChildren="启用" unCheckedChildren="禁用" />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  )
}
