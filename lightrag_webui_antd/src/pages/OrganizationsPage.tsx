/**
 * OrganizationsPage – tree-based organization & member management.
 *
 * Layout:
 *   Left  – org tree (expandable, click to select)
 *   Right – selected org detail: info cards + members table + action buttons
 */
import { useState, useEffect, useCallback } from 'react'
import {
  Alert, App, Button, Card, Col, Drawer, Form, Input, Modal, Popconfirm,
  Row, Select, Space, Switch, Table, Tag, Tooltip, Tree, Typography,
} from 'antd'
import {
  ApartmentOutlined, DeleteOutlined, EditOutlined, PlusOutlined,
  TeamOutlined, UserOutlined,
} from '@ant-design/icons'
import type { DataNode } from 'antd/es/tree'
import {
  listOrgs, createOrg, updateOrg, deleteOrg,
  listOrgMembers, addOrgMember, updateOrgMemberRole, removeOrgMember,
  listOrgKBPermissions, grantKBPermission, revokeKBPermission,
} from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import type { Organization, OrgMember, OrgRole, OrgKBPermissionsMap, KBPermissionType } from '@/types'

const { Title, Text } = Typography

// ── Tree helpers ──────────────────────────────────────────────────────────────

function toTreeNodes(orgs: Organization[]): DataNode[] {
  return orgs.map((o) => ({
    key: o.id,
    title: (
      <Space style={{ padding: '6px 0', lineHeight: '20px' }}>
        <ApartmentOutlined style={{ color: '#1677ff' }} />
        {o.name}
        <Tag color="default" style={{ fontSize: 10 }}>{o.member_count} 人</Tag>
      </Space>
    ),
    children: o.children?.length ? toTreeNodes(o.children) : undefined,
  }))
}

function flattenOrgs(orgs: Organization[]): Organization[] {
  const result: Organization[] = []
  const walk = (list: Organization[]) => {
    for (const o of list) {
      result.push(o)
      if (o.children?.length) walk(o.children)
    }
  }
  walk(orgs)
  return result
}

// ── Role tag ─────────────────────────────────────────────────────────────────

const RoleTag = ({ role }: { role: OrgRole }) => (
  <Tag color={role === 'admin' ? 'gold' : 'blue'}>{role === 'admin' ? '组织管理员' : '成员'}</Tag>
)

// ── Page ─────────────────────────────────────────────────────────────────────

export default function OrganizationsPage() {
  const { message } = App.useApp()
  const { isAdmin } = useAuthStore()

  const [orgs, setOrgs] = useState<Organization[]>([])
  const [flatOrgs, setFlatOrgs] = useState<Organization[]>([])
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null)
  const [members, setMembers] = useState<OrgMember[]>([])
  const [kbPerms, setKbPerms] = useState<OrgKBPermissionsMap>({})
  const [loading, setLoading] = useState(false)
  const [memberLoading, setMemberLoading] = useState(false)

  // Modals / drawers
  const [createOrgOpen, setCreateOrgOpen] = useState(false)
  const [editOrgOpen, setEditOrgOpen] = useState(false)
  const [addMemberOpen, setAddMemberOpen] = useState(false)

  const [createForm] = Form.useForm()
  const [editForm] = Form.useForm()
  const [memberForm] = Form.useForm()

  // ── Load org tree ───────────────────────────────────────────────────────────

  const loadOrgs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listOrgs()
      setOrgs(res.orgs)
      setFlatOrgs(flattenOrgs(res.orgs))
    } catch {
      message.error('加载组织树失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadOrgs() }, [loadOrgs])

  // ── Load members when org selected ─────────────────────────────────────────

  const loadMembers = useCallback(async (orgId: string) => {
    setMemberLoading(true)
    try {
      const [memberRes, permRes] = await Promise.all([
        listOrgMembers(orgId),
        listOrgKBPermissions(orgId),
      ])
      setMembers(memberRes.members)
      setKbPerms(permRes.permissions)
    } catch {
      message.error('加载成员失败')
    } finally {
      setMemberLoading(false)
    }
  }, [])

  const handleSelectOrg = (keys: React.Key[]) => {
    if (!keys.length) return
    const org = flatOrgs.find((o) => o.id === keys[0])
    if (org) {
      setSelectedOrg(org)
      loadMembers(org.id)
    }
  }

  // ── Create org ─────────────────────────────────────────────────────────────

  const handleCreateOrg = async (values: { name: string; parent_id?: string; description?: string }) => {
    try {
      await createOrg({ name: values.name, parent_id: values.parent_id || null, description: values.description || '' })
      message.success('组织创建成功')
      createForm.resetFields()
      setCreateOrgOpen(false)
      await loadOrgs()
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '创建失败')
    }
  }

  // ── Edit org ───────────────────────────────────────────────────────────────

  const handleEditOrg = async (values: { name: string; description?: string }) => {
    if (!selectedOrg) return
    try {
      const res = await updateOrg(selectedOrg.id, { name: values.name, description: values.description })
      message.success('组织更新成功')
      setSelectedOrg(res.org)
      editForm.resetFields()
      setEditOrgOpen(false)
      await loadOrgs()
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '更新失败')
    }
  }

  // ── Delete org ─────────────────────────────────────────────────────────────

  const handleDeleteOrg = async () => {
    if (!selectedOrg) return
    try {
      await deleteOrg(selectedOrg.id)
      message.success('组织删除成功')
      setSelectedOrg(null)
      setMembers([])
      await loadOrgs()
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '删除失败')
    }
  }

  // ── Add member ─────────────────────────────────────────────────────────────

  const handleAddMember = async (values: { username: string; role: OrgRole }) => {
    if (!selectedOrg) return
    try {
      await addOrgMember(selectedOrg.id, { username: values.username, role: values.role })
      message.success('成员添加成功')
      memberForm.resetFields()
      setAddMemberOpen(false)
      await loadMembers(selectedOrg.id)
      await loadOrgs() // refresh member_count
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '添加失败')
    }
  }

  // ── Change role ────────────────────────────────────────────────────────────

  const handleChangeRole = async (username: string, role: OrgRole) => {
    if (!selectedOrg) return
    try {
      await updateOrgMemberRole(selectedOrg.id, username, { role })
      message.success('角色已更新')
      await loadMembers(selectedOrg.id)
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '更新失败')
    }
  }

  // ── Remove member ──────────────────────────────────────────────────────────

  const handleRemoveMember = async (username: string) => {
    if (!selectedOrg) return
    try {
      await removeOrgMember(selectedOrg.id, username)
      message.success(`已移除 ${username}`)
      await loadMembers(selectedOrg.id)
      await loadOrgs()
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '移除失败')
    }
  }

  // ── KB permission toggle ────────────────────────────────────────────────────

  const handleToggleKBPerm = async (username: string, permission: KBPermissionType, currentlyGranted: boolean) => {
    if (!selectedOrg) return
    try {
      if (currentlyGranted) {
        await revokeKBPermission(selectedOrg.id, username, permission)
        message.success(`已撤销 ${username} 的 kb_${permission} 权限`)
      } else {
        await grantKBPermission(selectedOrg.id, { username, permission })
        message.success(`已授予 ${username} kb_${permission} 权限`)
      }
      const permRes = await listOrgKBPermissions(selectedOrg.id)
      setKbPerms(permRes.permissions)
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '操作失败')
    }
  }

  // ── Members table columns ──────────────────────────────────────────────────

  const memberColumns = [
    { title: '用户名', dataIndex: 'username', key: 'username',
      render: (u: string) => <Space><UserOutlined />{u}</Space> },
    { title: '角色', dataIndex: 'role', key: 'role',
      render: (r: OrgRole, record: OrgMember) => (
        isAdmin() ? (
          <Select value={r} size="small" style={{ width: 110 }}
            onChange={(v) => handleChangeRole(record.username, v as OrgRole)}
            options={[{ value: 'admin', label: '组织管理员' }, { value: 'member', label: '成员' }]}
          />
        ) : <RoleTag role={r} />
      ),
    },
    {
      title: () => <Tooltip title="可在自身组织及下级组织创建/修改/删除知识库"><span>KB写权限</span></Tooltip>,
      key: 'kb_write',
      render: (_: unknown, record: OrgMember) => {
        const granted = (kbPerms[record.username] ?? []).includes('write')
        return isAdmin() ? (
          <Switch size="small" checked={granted}
            checkedChildren="已授" unCheckedChildren="无"
            onChange={() => handleToggleKBPerm(record.username, 'write', granted)} />
        ) : <Tag color={granted ? 'green' : 'default'}>{granted ? '已授' : '无'}</Tag>
      },
    },
    {
      title: () => <Tooltip title="可查看下级组织及所有上级祖先组织的知识库"><span>KB读权限</span></Tooltip>,
      key: 'kb_read',
      render: (_: unknown, record: OrgMember) => {
        const granted = (kbPerms[record.username] ?? []).includes('read')
        return isAdmin() ? (
          <Switch size="small" checked={granted}
            checkedChildren="已授" unCheckedChildren="无"
            onChange={() => handleToggleKBPerm(record.username, 'read', granted)} />
        ) : <Tag color={granted ? 'blue' : 'default'}>{granted ? '已授' : '无'}</Tag>
      },
    },
    { title: '加入时间', dataIndex: 'joined_at', key: 'joined_at',
      render: (t: string) => new Date(t).toLocaleDateString('zh-CN') },
    { title: '操作', key: 'action',
      render: (_: unknown, record: OrgMember) => (
        isAdmin() ? (
          <Popconfirm title={`移除成员 ${record.username}？`} onConfirm={() => handleRemoveMember(record.username)} okText="移除" cancelText="取消">
            <Button type="text" danger size="small" icon={<DeleteOutlined />} />
          </Popconfirm>
        ) : null
      ),
    },
  ]



  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={4} style={{ margin: 0 }}><ApartmentOutlined style={{ marginRight: 8 }} />组织管理</Title>
        {isAdmin() && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOrgOpen(true)}>
            新建组织
          </Button>
        )}
      </div>

      {/* Body */}
      <Row style={{ flex: 1, overflow: 'hidden' }}>
        {/* Left: org tree */}
        <Col span={7} style={{ borderRight: '1px solid #f0f0f0', padding: '20px 12px', overflow: 'auto', height: '100%' }}>
          {orgs.length === 0 && !loading ? (
            <div style={{ textAlign: 'center', paddingTop: 40 }}>
              <ApartmentOutlined style={{ fontSize: 40, color: '#bfbfbf' }} />
              <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>暂无组织，请创建根组织</Text>
            </div>
          ) : (
            <Tree
              treeData={toTreeNodes(orgs)}
              onSelect={handleSelectOrg}
              defaultExpandAll
              blockNode
              itemHeight={44}
              style={{ padding: '4px 8px' }}
            />
          )}
        </Col>

        {/* Right: org detail */}
        <Col span={17} style={{ padding: 24, overflow: 'auto', height: '100%' }}>
          {!selectedOrg ? (
            <div style={{ textAlign: 'center', paddingTop: 80 }}>
              <ApartmentOutlined style={{ fontSize: 48, color: '#bfbfbf' }} />
              <Text type="secondary" style={{ display: 'block', marginTop: 16 }}>点击左侧组织查看详情</Text>
            </div>
          ) : (
            <Space direction="vertical" style={{ width: '100%' }} size="large">
              {/* Org info card */}
              <Card
                title={<Space><ApartmentOutlined />{selectedOrg.name}</Space>}
                extra={isAdmin() && (
                  <Space>
                    <Tooltip title="编辑组织">
                      <Button size="small" icon={<EditOutlined />} onClick={() => {
                        editForm.setFieldsValue({ name: selectedOrg.name, description: selectedOrg.description })
                        setEditOrgOpen(true)
                      }} />
                    </Tooltip>
                    <Popconfirm
                      title="确定删除该组织？"
                      description="该操作不可撤销，组织下不能有成员或子组织"
                      onConfirm={handleDeleteOrg}
                      okText="删除" cancelText="取消" okButtonProps={{ danger: true }}
                    >
                      <Button size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </Space>
                )}
              >
                <Row gutter={16}>
                  <Col span={12}><Text type="secondary">描述：</Text><Text>{selectedOrg.description || '—'}</Text></Col>
                  <Col span={6}><Text type="secondary">成员数：</Text><Text>{selectedOrg.member_count}</Text></Col>
                  <Col span={6}><Text type="secondary">创建时间：</Text><Text>{new Date(selectedOrg.created_at).toLocaleDateString('zh-CN')}</Text></Col>
                </Row>
              </Card>

              {/* Members */}
              <Card
                title={<Space><TeamOutlined />成员列表</Space>}
                extra={isAdmin() && (
                  <Button size="small" icon={<PlusOutlined />} onClick={() => setAddMemberOpen(true)}>添加成员</Button>
                )}
              >
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 12 }}
                  message="组织角色说明"
                  description={
                    <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                      <li><Tag color="gold" style={{ marginRight: 4 }}>组织管理员</Tag>可管理本组织及下级子组织的成员，协助分配知识库权限；<strong>不具备</strong>系统级用户管理权限。</li>
                      <li><Tag color="blue" style={{ marginRight: 4 }}>成员</Tag>普通组织成员；知识库读写权限由系统管理员在右侧开关单独配置。</li>
                    </ul>
                  }
                />
                <Table
                  dataSource={members}
                  columns={memberColumns}
                  rowKey="id"
                  size="small"
                  loading={memberLoading}
                  pagination={{ pageSize: 10, showSizeChanger: false }}
                />
              </Card>
            </Space>
          )}
        </Col>
      </Row>

      {/* Create Org Modal */}
      <Modal title="新建组织" open={createOrgOpen} onCancel={() => { setCreateOrgOpen(false); createForm.resetFields() }}
        onOk={() => createForm.submit()} okText="创建">
        <Form form={createForm} layout="vertical" onFinish={handleCreateOrg} style={{ marginTop: 16 }}>
          <Form.Item name="name" label="组织名称" rules={[{ required: true, message: '请输入组织名称' }]}>
            <Input placeholder="例如：技术部" />
          </Form.Item>
          <Form.Item name="parent_id" label="父组织（留空则为根组织）">
            <Select allowClear placeholder="选择父组织"
              options={flatOrgs.map((o) => ({ value: o.id, label: o.name }))} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="组织简介（可选）" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Edit Org Modal */}
      <Modal title="编辑组织" open={editOrgOpen} onCancel={() => { setEditOrgOpen(false); editForm.resetFields() }}
        onOk={() => editForm.submit()} okText="保存">
        <Form form={editForm} layout="vertical" onFinish={handleEditOrg} style={{ marginTop: 16 }}>
          <Form.Item name="name" label="组织名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Add Member Drawer */}
      <Drawer title="添加成员" open={addMemberOpen} onClose={() => { setAddMemberOpen(false); memberForm.resetFields() }} width={360}
        extra={<Button type="primary" onClick={() => memberForm.submit()}>添加</Button>}>
        <Form form={memberForm} layout="vertical" onFinish={handleAddMember}>
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<UserOutlined />} placeholder="输入已注册的用户名" />
          </Form.Item>
          <Form.Item name="role" label="角色" initialValue="member">
            <Select options={[{ value: 'member', label: '成员' }, { value: 'admin', label: '组织管理员' }]} />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  )
}
