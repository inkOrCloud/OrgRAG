import { useEffect, useState } from 'react'
import {
  Table, Button, Space, Tag, Modal, Form, Input, Switch, Popconfirm,
  App, Typography, Card, Badge, Tooltip, Drawer, List, Divider,
  Statistic, Row, Col, Select, InputNumber, Upload,
} from 'antd'
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined,
  DatabaseOutlined, CheckCircleOutlined,
  SettingOutlined, DownloadOutlined, UploadOutlined, BarChartOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import type { UploadFile } from 'antd/es/upload/interface'
import {
  listKBs, createKB, updateKB, deleteKB,
  getKBStats, getKBSettings, updateKBSettings, exportKB, importKB,
  listOrgs, getMyOrg,
} from '@/api/client'
import { useKBStore } from '@/stores/kb'
import { useAuthStore } from '@/stores/auth'
import { useChatStore } from '@/stores/chat'
import type { KnowledgeBase, KBStats, KBSettings, Organization } from '@/types'

const { Title, Text } = Typography

export default function KnowledgeBasesPage() {
  const { message } = App.useApp()
  const { isAdmin } = useAuthStore()
  const { setKBs, currentKBId, setCurrentKBId } = useKBStore()
  const { clearActiveSession } = useChatStore()

  const [kbs, setLocalKBs] = useState<KnowledgeBase[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingKB, setEditingKB] = useState<KnowledgeBase | null>(null)
  const [form] = Form.useForm()

  // Org data for create form
  const [flatOrgs, setFlatOrgs] = useState<Organization[]>([])
  const [myOrgId, setMyOrgId] = useState<string | null>(null)

  // Stats drawer state
  const [statsKB, setStatsKB] = useState<KnowledgeBase | null>(null)
  const [stats, setStats] = useState<KBStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)

  // Settings drawer state
  const [settingsKB, setSettingsKB] = useState<KnowledgeBase | null>(null)
  const [kbSettings, setKBSettings] = useState<KBSettings>({})
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsForm] = Form.useForm()

  // Import state
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<UploadFile | null>(null)
  const [importing, setImporting] = useState(false)

  const fetchKBs = async () => {
    setLoading(true)
    try {
      const res = await listKBs()
      setLocalKBs(res.kbs)
      setKBs(res.kbs)
    } catch {
      message.error('获取知识库列表失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchKBs()
    // Load org list for create form
    const flattenOrgs = (orgs: Organization[]): Organization[] => {
      const result: Organization[] = []
      const walk = (list: Organization[]) => { for (const o of list) { result.push(o); if (o.children?.length) walk(o.children) } }
      walk(orgs)
      return result
    }
    listOrgs().then((res) => setFlatOrgs(flattenOrgs(res.orgs))).catch(() => {})
    getMyOrg().then((res) => setMyOrgId(res.membership?.org_id ?? null)).catch(() => {})
  }, [])

  const openCreate = () => {
    setEditingKB(null)
    form.resetFields()
    setModalOpen(true)
  }

  const openEdit = (kb: KnowledgeBase) => {
    setEditingKB(kb)
    form.setFieldsValue({ name: kb.name, description: kb.description, is_active: kb.is_active })
    setModalOpen(true)
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      if (editingKB) {
        await updateKB(editingKB.id, { name: values.name, description: values.description, is_active: values.is_active })
        message.success('知识库已更新')
      } else {
        await createKB({ name: values.name, description: values.description, org_id: values.org_id ?? null })
        message.success('知识库创建成功')
      }
      setModalOpen(false)
      fetchKBs()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail || (editingKB ? '更新失败' : '创建失败'))
    }
  }

  // Stats
  const openStats = async (kb: KnowledgeBase) => {
    setStatsKB(kb)
    setStats(null)
    setStatsLoading(true)
    try {
      const s = await getKBStats(kb.id)
      setStats(s)
    } catch { message.error('获取统计信息失败') }
    finally { setStatsLoading(false) }
  }

  // Settings
  const openSettings = async (kb: KnowledgeBase) => {
    setSettingsKB(kb)
    setSettingsLoading(true)
    try {
      const res = await getKBSettings(kb.id)
      setKBSettings(res.settings)
      settingsForm.setFieldsValue(res.settings)
    } catch { message.error('获取 KB 设置失败') }
    finally { setSettingsLoading(false) }
  }

  const saveSettings = async () => {
    if (!settingsKB) return
    setSettingsSaving(true)
    try {
      const values = settingsForm.getFieldsValue()
      // Remove undefined/empty values
      const clean = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined && v !== null && v !== ''))
      await updateKBSettings(settingsKB.id, clean)
      message.success('设置已保存')
      setSettingsKB(null)
    } catch { message.error('保存设置失败') }
    finally { setSettingsSaving(false) }
  }

  // Export
  const handleExport = async (kb: KnowledgeBase) => {
    try {
      const blob = await exportKB(kb.id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `kb_${kb.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.zip`
      a.click()
      URL.revokeObjectURL(url)
    } catch { message.error('导出失败') }
  }

  // Import
  const handleImport = async () => {
    if (!importFile?.originFileObj) return
    setImporting(true)
    try {
      const res = await importKB(importFile.originFileObj as File)
      message.success(res.message || '知识库导入成功')
      setImportOpen(false)
      setImportFile(null)
      fetchKBs()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail || '导入失败')
    } finally { setImporting(false) }
  }

  const handleDelete = async (kb: KnowledgeBase) => {
    try {
      await deleteKB(kb.id)
      message.success(`知识库 "${kb.name}" 已删除`)
      fetchKBs()
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      message.error(detail || '删除失败')
    }
  }

  const columns: ColumnsType<KnowledgeBase> = [
    {
      title: '知识库名称',
      dataIndex: 'name',
      render: (v: string, r: KnowledgeBase) => (
        <Space>
          <DatabaseOutlined />
          <Text strong>{v}</Text>
          {r.is_default && <Tag color="gold">默认</Tag>}
          {r.id === currentKBId && <Tag color="green" icon={<CheckCircleOutlined />}>当前</Tag>}
        </Space>
      ),
    },
    { title: '描述', dataIndex: 'description', render: (v: string) => v || <Text type="secondary">-</Text> },
    {
      title: '归属组织',
      dataIndex: 'org_id',
      render: (orgId: string | null) => {
        if (!orgId) return <Text type="secondary">—</Text>
        const org = flatOrgs.find((o) => o.id === orgId)
        return org ? <Tag icon={<DatabaseOutlined />}>{org.name}</Tag> : <Text type="secondary" code>{orgId.slice(0, 8)}…</Text>
      },
    },
    { title: '命名空间', dataIndex: 'workspace', render: (v: string) => <Text code>{v || '(default)'}</Text> },
    { title: '创建者', dataIndex: 'owner_username' },
    {
      title: '状态',
      dataIndex: 'is_active',
      render: (v: boolean, r: KnowledgeBase) => (
        <Space>
          <Badge status={v ? 'success' : 'error'} text={v ? '启用' : '禁用'} />
          {r.loaded && <Tag color="cyan">已加载</Tag>}
        </Space>
      ),
    },
    { title: '创建时间', dataIndex: 'created_at', render: (v: string) => new Date(v).toLocaleString('zh-CN') },
    {
      title: '操作',
      render: (_: unknown, r: KnowledgeBase) => (
        <Space>
          <Tooltip title="切换到此知识库">
            <Button size="small" type={r.id === currentKBId ? 'primary' : 'default'}
              onClick={() => { setCurrentKBId(r.id); clearActiveSession(); message.success(`已切换到「${r.name}」`) }}>
              切换
            </Button>
          </Tooltip>
          <Button size="small" icon={<BarChartOutlined />} onClick={() => openStats(r)}>统计</Button>
          {isAdmin() && (
            <>
              <Button size="small" icon={<SettingOutlined />} onClick={() => openSettings(r)}>设置</Button>
              <Button size="small" icon={<DownloadOutlined />} onClick={() => handleExport(r)}>导出</Button>
              <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
              <Popconfirm
                title={`确认删除「${r.name}」？此操作不可撤销。`}
                onConfirm={() => handleDelete(r)}
                disabled={r.is_default}
              >
                <Button size="small" danger icon={<DeleteOutlined />} disabled={r.is_default}>删除</Button>
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ]

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>知识库管理</Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchKBs} loading={loading}>刷新</Button>
          {isAdmin() && (
            <>
              <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>导入</Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建知识库</Button>
            </>
          )}
        </Space>
      </div>

      <Card styles={{ body: { padding: 0, overflow: 'hidden' } }}>
        <Table rowKey="id" columns={columns} dataSource={kbs} loading={loading}
          scroll={{ x: 900 }}
          pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 个知识库` }} />
      </Card>

      <Modal
        title={editingKB ? `编辑知识库：${editingKB.name}` : '新建知识库'}
        open={modalOpen} onOk={handleSubmit} onCancel={() => setModalOpen(false)}
        okText={editingKB ? '保存' : '创建'} cancelText="取消" width={480} destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="知识库名称" rules={[{ required: true, message: '请输入知识库名称' }]}>
            <Input placeholder="如：医疗知识库、法律文档库" prefix={<DatabaseOutlined />} disabled={!!editingKB} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea placeholder="知识库用途说明（选填）" rows={3} />
          </Form.Item>
          {!editingKB && (
            <Form.Item
              name="org_id"
              label="归属组织"
              initialValue={myOrgId ?? undefined}
              rules={[{ required: flatOrgs.length > 0, message: '请选择归属组织' }]}
            >
              <Select
                placeholder={flatOrgs.length === 0 ? '暂无组织（知识库将不归属任何组织）' : '选择归属组织'}
                allowClear
                options={flatOrgs.map((o) => ({ value: o.id, label: o.name }))}
                disabled={flatOrgs.length === 0}
              />
            </Form.Item>
          )}
          {editingKB && (
            <Form.Item name="is_active" label="状态" valuePropName="checked">
              <Switch checkedChildren="启用" unCheckedChildren="禁用" />
            </Form.Item>
          )}
        </Form>
      </Modal>

      {/* Stats drawer */}
      <Drawer
        title={<Space><BarChartOutlined />{statsKB ? `统计信息 — ${statsKB.name}` : '统计信息'}</Space>}
        open={!!statsKB}
        onClose={() => { setStatsKB(null); setStats(null) }}
        width={380}
        loading={statsLoading}
      >
        {stats && (
          <>
            <Typography.Title level={5}>文档状态</Typography.Title>
            <Row gutter={[16, 16]}>
              {Object.entries(stats.doc_counts).map(([status, count]) => (
                <Col span={12} key={status}>
                  <Statistic title={status} value={count ?? 0} />
                </Col>
              ))}
            </Row>
            <Divider />
            <Typography.Title level={5}>知识图谱</Typography.Title>
            <Row gutter={[16, 16]}>
              <Col span={8}><Statistic title="节点数" value={stats.node_count} /></Col>
              <Col span={8}><Statistic title="边数" value={stats.edge_count} /></Col>
              <Col span={8}><Statistic title="文本块数" value={stats.chunk_count} /></Col>
            </Row>
          </>
        )}
        {!stats && !statsLoading && <Typography.Text type="secondary">暂无统计数据</Typography.Text>}
      </Drawer>

      {/* Settings drawer */}
      <Drawer
        title={<Space><SettingOutlined />{settingsKB ? `查询设置 — ${settingsKB.name}` : '查询设置'}</Space>}
        open={!!settingsKB}
        onClose={() => setSettingsKB(null)}
        width={420}
        loading={settingsLoading}
        footer={
          <Button type="primary" loading={settingsSaving} onClick={saveSettings} block>保存设置</Button>
        }
      >
        <Form form={settingsForm} layout="vertical" initialValues={kbSettings}>
          <Divider orientation="left" orientationMargin={0}>查询参数</Divider>
          <Form.Item name="mode" label="查询模式">
            <Select options={['local','global','hybrid','naive','mix'].map(m => ({ label: m, value: m }))} allowClear placeholder="使用系统默认" />
          </Form.Item>
          <Form.Item name="top_k" label="Top-K（实体/关系）">
            <InputNumber min={1} max={500} style={{ width: '100%' }} placeholder="系统默认" />
          </Form.Item>
          <Form.Item name="chunk_top_k" label="Chunk Top-K">
            <InputNumber min={1} max={100} style={{ width: '100%' }} placeholder="系统默认" />
          </Form.Item>
          <Form.Item name="max_total_tokens" label="最大总 Token 数">
            <InputNumber min={1000} max={200000} step={1000} style={{ width: '100%' }} placeholder="系统默认" />
          </Form.Item>
          <Form.Item name="response_type" label="响应类型">
            <Input placeholder="如：Multiple Paragraphs" />
          </Form.Item>
          <Form.Item name="enable_rerank" label="启用 Rerank" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Divider orientation="left" orientationMargin={0}>文档解析 · Docling VLM</Divider>
          <Form.Item name="docling_vlm_enabled" label="启用 VLM 解析" valuePropName="checked"
            tooltip="开启后使用视觉语言模型辅助解析图片和扫描件，留空则继承服务器全局配置">
            <Switch />
          </Form.Item>
          <Form.Item name="docling_vlm_mode" label="解析模式"
            tooltip="auto：自动检测扫描件；picture_description：为嵌入图片生成描述；vlm_convert：整页 VLM 转换（扫描件首选）；disabled：不使用 VLM">
            <Select allowClear placeholder="继承全局配置" options={[
              { label: 'auto — 自动检测', value: 'auto' },
              { label: 'picture_description — 图片描述', value: 'picture_description' },
              { label: 'vlm_convert — 整页转换（扫描件）', value: 'vlm_convert' },
              { label: 'disabled — 不使用 VLM', value: 'disabled' },
            ]} />
          </Form.Item>
          <Form.Item name="docling_vlm_engine" label="推理引擎"
            tooltip="ollama：本地 Ollama；openai：OpenAI API；lmstudio：LM Studio；api：自定义端点；local：本机 Transformers">
            <Select allowClear placeholder="继承全局配置" options={[
              { label: 'ollama', value: 'ollama' },
              { label: 'openai', value: 'openai' },
              { label: 'lmstudio', value: 'lmstudio' },
              { label: 'api — 自定义端点', value: 'api' },
              { label: 'local — 本机推理', value: 'local' },
            ]} />
          </Form.Item>
          <Form.Item name="docling_vlm_url" label="API 端点 URL"
            tooltip="自定义 VLM 端点地址，engine=api 时必填。例：http://localhost:11434/v1/chat/completions">
            <Input placeholder="继承全局配置，如 http://localhost:11434/v1/chat/completions" />
          </Form.Item>
          <Form.Item name="docling_vlm_api_key" label="API Key"
            tooltip="Bearer 鉴权密钥，Ollama/LM Studio 通常留空">
            <Input.Password placeholder="继承全局配置" autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="docling_vlm_model" label="模型名称"
            tooltip="覆盖 preset 默认模型，如 ibm/granite-docling:258m">
            <Input placeholder="继承全局配置（使用 preset 默认）" />
          </Form.Item>
          <Form.Item name="docling_vlm_timeout" label="超时（秒）">
            <InputNumber min={10} max={600} style={{ width: '100%' }} placeholder="继承全局配置（默认 120）" />
          </Form.Item>
        </Form>
      </Drawer>

      {/* Import modal */}
      <Modal
        title={<Space><UploadOutlined />导入知识库</Space>}
        open={importOpen}
        onCancel={() => { setImportOpen(false); setImportFile(null) }}
        onOk={handleImport}
        okText="导入" cancelText="取消"
        confirmLoading={importing}
        destroyOnHidden
      >
        <Upload.Dragger
          accept=".zip"
          maxCount={1}
          beforeUpload={() => false}
          fileList={importFile ? [importFile] : []}
          onChange={(info) => setImportFile(info.fileList[0] ?? null)}
          onRemove={() => setImportFile(null)}
        >
          <p className="ant-upload-drag-icon"><UploadOutlined /></p>
          <p className="ant-upload-text">点击或拖拽 ZIP 文件到此区域</p>
          <p className="ant-upload-hint">仅支持由本系统导出的 .zip 格式文件</p>
        </Upload.Dragger>
      </Modal>

    </div>
  )
}
