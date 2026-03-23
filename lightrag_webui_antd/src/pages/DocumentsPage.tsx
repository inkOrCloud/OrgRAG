import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Table,
  Button,
  Tag,
  Space,
  Typography,
  Card,
  Modal,
  Upload,
  Input,
  message,
  Tooltip,
  Badge,
  Statistic,
  Row,
  Col,
  Progress,
  Popconfirm,
  Select,
  Drawer,
  List,
  Alert,
} from 'antd'
import type { UploadFile } from 'antd/es/upload/interface'
import type { TablePaginationConfig } from 'antd/es/table'
import {
  UploadOutlined,
  DeleteOutlined,
  ReloadOutlined,
  ClearOutlined,
  FileTextOutlined,
  InboxOutlined,
  PlusOutlined,
  ScanOutlined,
  ExclamationCircleOutlined,
  CloseCircleOutlined,
  InfoCircleOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  LoadingOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import {
  getDocuments,
  uploadDocuments,
  insertText,
  deleteDocument,
  clearCache,
  scanDocuments,
  reprocessFailed,
  cancelPipeline,
  getPipelineStatus,
} from '@/api/client'
import type { DocStatusResponse, DocStatus } from '@/types'

const { Title, Text } = Typography
const { Dragger } = Upload
const { TextArea } = Input

const STATUS_COLOR: Record<DocStatus, string> = {
  pending: 'blue',
  processing: 'orange',
  preprocessed: 'cyan',
  processed: 'green',
  failed: 'red',
}

const STATUS_LABEL: Record<DocStatus, string> = {
  pending: '等待中',
  processing: '处理中',
  preprocessed: '预处理完成',
  processed: '已完成',
  failed: '失败',
}

const STATUS_ICON: Record<DocStatus, React.ReactNode> = {
  pending: <ClockCircleOutlined />,
  processing: <LoadingOutlined spin />,
  preprocessed: <ClockCircleOutlined />,
  processed: <CheckCircleOutlined />,
  failed: <CloseCircleOutlined />,
}

function formatDate(str: string) {
  return new Date(str).toLocaleString('zh-CN')
}

function truncate(str: string, max = 50) {
  if (str.length <= max) return str
  return '...' + str.slice(str.length - max)
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState<DocStatusResponse[]>([])
  const [loading, setLoading] = useState(false)
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({})
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 })
  const [statusFilter, setStatusFilter] = useState<DocStatus | null>(null)

  const [uploadOpen, setUploadOpen] = useState(false)
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [uploading, setUploading] = useState(false)

  const [textOpen, setTextOpen] = useState(false)
  const [textContent, setTextContent] = useState('')
  const [textInserting, setTextInserting] = useState(false)

  const [pipelineOpen, setPipelineOpen] = useState(false)
  const [pipelineStatus, setPipelineStatus] = useState<{
    busy: boolean
    latest_message: string
    history_messages?: string[]
    docs: number
    batchs: number
    cur_batch: number
  } | null>(null)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchDocs = useCallback(
    async (page = pagination.current, pageSize = pagination.pageSize) => {
      setLoading(true)
      try {
        const res = await getDocuments({
          page,
          pageSize,
          statusFilter,
          sortField: 'updated_at',
          sortDirection: 'desc',
        })
        setDocs(res.documents)
        setStatusCounts(res.status_counts)
        setPagination((p) => ({ ...p, current: page, pageSize, total: res.pagination.total_count }))
      } catch {
        message.error('加载文档列表失败')
      } finally {
        setLoading(false)
      }
    },
    [pagination.current, pagination.pageSize, statusFilter]
  )

  useEffect(() => {
    fetchDocs(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter])

  const fetchPipelineStatus = useCallback(async () => {
    try {
      const s = await getPipelineStatus()
      setPipelineStatus(s)
      if (!s.busy) {
        clearInterval(pollRef.current!)
        pollRef.current = null
        fetchDocs()
      }
    } catch {
      // ignore
    }
  }, [fetchDocs])

  const startPoll = useCallback(() => {
    if (pollRef.current) return
    pollRef.current = setInterval(fetchPipelineStatus, 2000)
  }, [fetchPipelineStatus])

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const handleTableChange = (p: TablePaginationConfig) => {
    fetchDocs(p.current ?? 1, p.pageSize ?? 20)
  }

  const columns: ColumnsType<DocStatusResponse> = [
    {
      title: '文件路径',
      dataIndex: 'file_path',
      key: 'file_path',
      ellipsis: true,
      render: (path: string) => (
        <Tooltip title={path}>
          <Space>
            <FileTextOutlined />
            <Text style={{ maxWidth: 280 }} ellipsis={{ tooltip: path }}>
              {truncate(path, 60)}
            </Text>
          </Space>
        </Tooltip>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 140,
      render: (status: DocStatus) => (
        <Tag icon={STATUS_ICON[status]} color={STATUS_COLOR[status]}>
          {STATUS_LABEL[status]}
        </Tag>
      ),
    },
    {
      title: '分块数',
      dataIndex: 'chunks_count',
      key: 'chunks_count',
      width: 90,
      align: 'center',
      render: (n?: number) => (n != null ? <Badge count={n} style={{ backgroundColor: '#1677ff' }} showZero /> : '-'),
    },
    {
      title: '大小',
      dataIndex: 'content_length',
      key: 'content_length',
      width: 100,
      align: 'right',
      render: (n: number) => n ? `${(n / 1024).toFixed(1)} KB` : '-',
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 170,
      render: (d: string) => <Text type="secondary" style={{ fontSize: 12 }}>{formatDate(d)}</Text>,
    },
    {
      title: '错误',
      dataIndex: 'error_msg',
      key: 'error_msg',
      width: 60,
      align: 'center',
      render: (msg?: string) =>
        msg ? (
          <Tooltip title={msg}>
            <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />
          </Tooltip>
        ) : null,
    },
    {
      title: '操作',
      key: 'actions',
      width: 80,
      align: 'center',
      render: (_, record) => (
        <Popconfirm
          title="确认删除此文档？"
          description="删除后将移除该文档及其关联的图谱数据，操作不可撤销。"
          onConfirm={() => handleDelete(record.id)}
          okText="确认删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
        >
          <Button danger type="text" icon={<DeleteOutlined />} size="small" />
        </Popconfirm>
      ),
    },
  ]

  const handleDelete = async (id: string) => {
    try {
      await deleteDocument(id)
      message.success('文档已删除')
      fetchDocs()
    } catch {
      message.error('删除文档失败')
    }
  }

  const handleUpload = async () => {
    if (!fileList.length) return
    setUploading(true)
    try {
      const files = fileList.map((f) => f.originFileObj as File).filter(Boolean)
      const res = await uploadDocuments(files)
      if (res.status === 'success' || res.status === 'partial_success') {
        message.success(res.message || '文件上传成功，正在处理中')
        setUploadOpen(false)
        setFileList([])
        startPoll()
        setTimeout(fetchDocs, 1000)
      } else {
        message.warning(res.message)
      }
    } catch {
      message.error('文件上传失败')
    } finally {
      setUploading(false)
    }
  }

  const handleInsertText = async () => {
    if (!textContent.trim()) return
    setTextInserting(true)
    try {
      const res = await insertText(textContent.trim())
      if (res.status === 'success' || res.status === 'partial_success') {
        message.success('文本插入成功')
        setTextOpen(false)
        setTextContent('')
        startPoll()
        setTimeout(fetchDocs, 1000)
      } else {
        message.warning(res.message)
      }
    } catch {
      message.error('文本插入失败')
    } finally {
      setTextInserting(false)
    }
  }

  const handleClearCache = async () => {
    try {
      await clearCache()
      message.success('LLM 缓存已清除')
    } catch {
      message.error('清除缓存失败')
    }
  }

  const handleScan = async () => {
    try {
      const res = await scanDocuments()
      message.success(res.message || '开始扫描输入目录')
      startPoll()
      setTimeout(fetchDocs, 2000)
    } catch {
      message.error('启动扫描失败')
    }
  }

  const handleReprocess = async () => {
    try {
      const res = await reprocessFailed()
      message.success(res.message || '开始重新处理失败文档')
      startPoll()
      setTimeout(fetchDocs, 2000)
    } catch {
      message.error('重新处理失败')
    }
  }

  const handleCancel = async () => {
    try {
      const res = await cancelPipeline()
      message.success(res.message || '处理管道已取消')
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      setTimeout(fetchDocs, 1000)
    } catch {
      message.error('取消管道失败')
    }
  }

  const handleShowPipeline = async () => {
    try {
      const s = await getPipelineStatus()
      setPipelineStatus(s)
      setPipelineOpen(true)
    } catch {
      message.error('获取管道状态失败')
    }
  }

  const total = Object.values(statusCounts).reduce((a, b) => a + b, 0)
  const processed = statusCounts['processed'] ?? 0
  const processing = (statusCounts['processing'] ?? 0) + (statusCounts['preprocessed'] ?? 0)
  const pending = statusCounts['pending'] ?? 0
  const failed = statusCounts['failed'] ?? 0

  return (
    <div style={{ padding: '24px 24px 0', height: '100%', overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <Title level={4} style={{ margin: 0 }}>文档管理</Title>
        <Space wrap>
          <Button icon={<InfoCircleOutlined />} onClick={handleShowPipeline}>
            管道状态
          </Button>
          <Button icon={<ScanOutlined />} onClick={handleScan}>
            扫描目录
          </Button>
          {failed > 0 && (
            <Button icon={<ReloadOutlined />} onClick={handleReprocess}>
              重新处理失败项
            </Button>
          )}
          <Popconfirm title="确认清除 LLM 缓存？" onConfirm={handleClearCache} okText="确认" cancelText="取消">
            <Button icon={<ClearOutlined />}>清除缓存</Button>
          </Popconfirm>
          <Button icon={<PlusOutlined />} onClick={() => setTextOpen(true)}>
            插入文本
          </Button>
          <Button type="primary" icon={<UploadOutlined />} onClick={() => setUploadOpen(true)}>
            上传文件
          </Button>
        </Space>
      </div>

      {/* 统计卡片 */}
      <Row gutter={16} style={{ marginBottom: 20 }}>
        {[
          { label: '全部', value: total, color: '#1677ff', icon: <FileTextOutlined /> },
          { label: '已完成', value: processed, color: '#52c41a', icon: <CheckCircleOutlined /> },
          { label: '处理中', value: processing, color: '#fa8c16', icon: <LoadingOutlined spin={processing > 0} /> },
          { label: '等待中', value: pending, color: '#1677ff', icon: <ClockCircleOutlined /> },
          { label: '失败', value: failed, color: '#ff4d4f', icon: <CloseCircleOutlined /> },
        ].map((stat) => (
          <Col key={stat.label} xs={12} sm={8} md={4} style={{ marginBottom: 12 }}>
            <Card size="small" style={{ borderRadius: 10 }}>
              <Statistic
                title={
                  <Space size={4}>
                    <span style={{ color: stat.color }}>{stat.icon}</span>
                    <span style={{ fontSize: 12 }}>{stat.label}</span>
                  </Space>
                }
                value={stat.value}
                valueStyle={{ color: stat.color, fontSize: 24, fontWeight: 700 }}
              />
            </Card>
          </Col>
        ))}
        {total > 0 && (
          <Col xs={24} sm={16} md={8} style={{ marginBottom: 12 }}>
            <Card size="small" style={{ borderRadius: 10 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>处理进度</Text>
              <Progress
                percent={total > 0 ? Math.round((processed / total) * 100) : 0}
                status={failed > 0 ? 'exception' : processing > 0 ? 'active' : 'success'}
                style={{ marginTop: 8 }}
              />
            </Card>
          </Col>
        )}
      </Row>

      {/* 筛选栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Space>
          <Text type="secondary">按状态筛选：</Text>
          <Select
            value={statusFilter}
            onChange={(v) => setStatusFilter(v)}
            allowClear
            placeholder="全部状态"
            style={{ width: 160 }}
            options={[
              { value: 'pending', label: '等待中' },
              { value: 'processing', label: '处理中' },
              { value: 'preprocessed', label: '预处理完成' },
              { value: 'processed', label: '已完成' },
              { value: 'failed', label: '失败' },
            ]}
          />
        </Space>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => fetchDocs(1)}
          loading={loading}
          type="text"
        >
          刷新
        </Button>
      </div>

      {/* 文档表格 */}
      <Card styles={{ body: { padding: 0 } }} style={{ borderRadius: 12 }}>
        <Table
          columns={columns}
          dataSource={docs}
          rowKey="id"
          loading={loading}
          pagination={{
            current: pagination.current,
            pageSize: pagination.pageSize,
            total: pagination.total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 个文档`,
            pageSizeOptions: ['10', '20', '50', '100'],
          }}
          onChange={handleTableChange}
          scroll={{ x: 800 }}
          size="middle"
        />
      </Card>

      {/* 上传文件弹窗 */}
      <Modal
        title="上传文档"
        open={uploadOpen}
        onCancel={() => { setUploadOpen(false); setFileList([]) }}
        footer={[
          <Button key="cancel" onClick={() => { setUploadOpen(false); setFileList([]) }}>取消</Button>,
          <Button
            key="upload"
            type="primary"
            loading={uploading}
            disabled={!fileList.length}
            onClick={handleUpload}
          >
            开始上传 {fileList.length > 0 ? `(${fileList.length} 个文件)` : ''}
          </Button>,
        ]}
        width={560}
      >
        <div style={{ marginTop: 16 }}>
          <Dragger
            multiple
            beforeUpload={() => false}
            fileList={fileList}
            onChange={({ fileList: fl }) => setFileList(fl)}
            style={{ borderRadius: 8 }}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">点击或拖拽文件到此区域上传</p>
            <p className="ant-upload-hint">
              支持 .txt、.pdf、.md、.docx 等文本格式，可批量上传
            </p>
          </Dragger>
        </div>
      </Modal>

      {/* 插入文本弹窗 */}
      <Modal
        title="插入文本文档"
        open={textOpen}
        onCancel={() => { setTextOpen(false); setTextContent('') }}
        footer={[
          <Button key="cancel" onClick={() => { setTextOpen(false); setTextContent('') }}>取消</Button>,
          <Button
            key="insert"
            type="primary"
            loading={textInserting}
            disabled={!textContent.trim()}
            onClick={handleInsertText}
          >
            插入
          </Button>,
        ]}
        width={600}
      >
        <div style={{ marginTop: 16 }}>
          <TextArea
            value={textContent}
            onChange={(e) => setTextContent(e.target.value)}
            placeholder="在此粘贴或输入文本内容..."
            rows={12}
            style={{ borderRadius: 8 }}
          />
          <Text type="secondary" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>
            共 {textContent.length.toLocaleString('zh-CN')} 个字符
          </Text>
        </div>
      </Modal>

      {/* 管道状态抽屉 */}
      <Drawer
        title="处理管道状态"
        open={pipelineOpen}
        onClose={() => setPipelineOpen(false)}
        width={480}
        extra={
          pipelineStatus?.busy && (
            <Popconfirm
              title="确认取消当前管道任务？"
              onConfirm={handleCancel}
              okText="确认取消"
              cancelText="保留"
              okButtonProps={{ danger: true }}
            >
              <Button danger size="small">取消任务</Button>
            </Popconfirm>
          )
        }
      >
        {pipelineStatus ? (
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            <Card size="small">
              <Row gutter={16}>
                <Col span={8}>
                  <Statistic
                    title="状态"
                    value={pipelineStatus.busy ? '运行中' : '空闲'}
                    valueStyle={{ color: pipelineStatus.busy ? '#fa8c16' : '#52c41a' }}
                  />
                </Col>
                <Col span={8}>
                  <Statistic title="文档数" value={pipelineStatus.docs} />
                </Col>
                <Col span={8}>
                  <Statistic title="批次进度" value={`${pipelineStatus.cur_batch}/${pipelineStatus.batchs}`} />
                </Col>
              </Row>
            </Card>

            {pipelineStatus.busy && pipelineStatus.batchs > 0 && (
              <Progress
                percent={Math.round((pipelineStatus.cur_batch / pipelineStatus.batchs) * 100)}
                status="active"
              />
            )}

            <div>
              <Text strong>最新消息</Text>
              <Alert
                message={pipelineStatus.latest_message || '暂无消息'}
                type="info"
                style={{ marginTop: 8 }}
              />
            </div>

            {(pipelineStatus.history_messages?.length ?? 0) > 0 && (
              <div>
                <Text strong>历史消息</Text>
                <List
                  size="small"
                  style={{ marginTop: 8, maxHeight: 300, overflowY: 'auto' }}
                  dataSource={[...(pipelineStatus.history_messages ?? [])].reverse()}
                  renderItem={(msg, i) => (
                    <List.Item key={i} style={{ padding: '4px 0' }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>{msg}</Text>
                    </List.Item>
                  )}
                />
              </div>
            )}
          </Space>
        ) : (
          <Text type="secondary">加载中...</Text>
        )}
      </Drawer>
    </div>
  )
}
