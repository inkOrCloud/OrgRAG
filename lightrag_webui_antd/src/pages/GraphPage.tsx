import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Card,
  Input,
  Select,
  Button,
  Typography,
  Space,
  Slider,
  Spin,
  Empty,
  Drawer,
  Descriptions,
  Tag,
  message as _msg,
  App,
  InputNumber,
  Tooltip,
  Badge,
} from 'antd'
import {
  SearchOutlined,
  ReloadOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  FullscreenOutlined,
  NodeIndexOutlined,
  ApartmentOutlined,
} from '@ant-design/icons'
import Graph from 'graphology'
import Sigma from 'sigma'
import forceAtlas2 from 'graphology-layout-forceatlas2'
import type { Settings as SigmaSettings } from 'sigma/settings'
import {
  getPopularLabels,
  getGraphData,
  searchGraphLabels,
  extractErrorDetail,
} from '@/api/client'
import type { GraphNode, GraphEdge } from '@/types'
import { useSettingsStore } from '@/stores/settings'
import { useKBStore } from '@/stores/kb'

const { Title, Text } = Typography
const { Search } = Input

const PALETTE_LIGHT = [
  '#f5222d', '#fa541c', '#fa8c16', '#faad14', '#a0d911',
  '#52c41a', '#13c2c2', '#1677ff', '#2f54eb', '#722ed1',
  '#eb2f96', '#08979c', '#237804', '#ad4e00', '#874d00',
]
const PALETTE_DARK = [
  '#ff7875', '#ff9c6e', '#ffc069', '#ffd666', '#d3f261',
  '#95de64', '#5cdbd3', '#69b1ff', '#85a5ff', '#b37feb',
  '#ff85c2', '#36cfc9', '#73d13d', '#ffa940', '#ffec3d',
]

function stringToColor(str: string, isDark: boolean): string {
  // Murmur-inspired hash for better distribution
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 0x9e3779b9)
    h ^= h >>> 16
  }
  const palette = isDark ? PALETTE_DARK : PALETTE_LIGHT
  return palette[Math.abs(h) % palette.length]
}

export default function GraphPage() {
  const { message } = App.useApp()
  const containerRef = useRef<HTMLDivElement>(null)
  const sigmaRef = useRef<Sigma | null>(null)
  const graphRef = useRef<Graph | null>(null)

  const [labels, setLabels] = useState<string[]>([])
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null)
  const [maxNodes, setMaxNodes] = useState(200)
  const [maxDepth, setMaxDepth] = useState(3)
  const [loading, setLoading] = useState(false)
  const [graphInfo, setGraphInfo] = useState<{ nodes: number; edges: number } | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<string[]>([])
  const [searching, setSearching] = useState(false)

  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [nodeEdges, setNodeEdges] = useState<GraphEdge[]>([])

  const isDark = useSettingsStore((s) => s.isDark)
  const currentKBId = useKBStore((s) => s.currentKBId)

  useEffect(() => {
    // Reset graph state when KB changes
    setSelectedLabel(null)
    setLabels([])
    setSearchQuery('')
    setSearchResults([])
    setGraphInfo(null)
    if (sigmaRef.current) {
      sigmaRef.current.kill()
      sigmaRef.current = null
    }
    getPopularLabels(50)
      .then(setLabels)
      .catch((err: unknown) => message.error(extractErrorDetail(err, '加载实体标签失败')))
  }, [currentKBId]) // eslint-disable-line react-hooks/exhaustive-deps

  const buildGraph = useCallback(
    async (label: string) => {
      if (!containerRef.current) return
      setLoading(true)

      try {
        const data = await getGraphData(label, maxDepth, maxNodes)

        if (sigmaRef.current) {
          sigmaRef.current.kill()
          sigmaRef.current = null
        }

        const graph = new Graph()
        graphRef.current = graph

        const nodeMap = new Map<string, GraphNode>()
        for (const node of data.nodes) {
          nodeMap.set(node.id, node)
          const nodeLabel = node.labels[0] || '未知'
          graph.addNode(node.id, {
            label: node.id,
            size: 14,
            color: stringToColor(nodeLabel, isDark),
            x: Math.random() * 200 - 100,
            y: Math.random() * 200 - 100,
            rawData: node,
          })
        }

        const addedEdges = new Set<string>()
        for (const edge of data.edges) {
          const edgeKey = `${edge.source}--${edge.target}`
          const reverseKey = `${edge.target}--${edge.source}`
          if (addedEdges.has(edgeKey) || addedEdges.has(reverseKey)) continue
          if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue
          if (edge.source === edge.target) continue
          addedEdges.add(edgeKey)
          graph.addEdge(edge.source, edge.target, {
            label: edge.type,
            size: 1,
            color: isDark ? '#404040' : '#d0d0d0',
            rawData: edge,
          })
        }

        forceAtlas2.assign(graph, {
          iterations: 100,
          settings: {
            gravity: 1,
            scalingRatio: 2,
            strongGravityMode: false,
            barnesHutOptimize: data.nodes.length > 150,
          },
        })

        const sigmaSettings: Partial<SigmaSettings> = {
          defaultNodeColor: isDark ? '#4a9eff' : '#1677ff',
          defaultEdgeColor: isDark ? '#333' : '#e0e0e0',
          labelSize: 14,
          labelWeight: '600',
          labelColor: { color: isDark ? '#e0e0e0' : '#1a1a1a' },
          renderEdgeLabels: false,
          minCameraRatio: 0.05,
          maxCameraRatio: 8,
        }

        const sigma = new Sigma(graph, containerRef.current, sigmaSettings)
        sigmaRef.current = sigma

        sigma.on('clickNode', ({ node }) => {
          const nodeData = graph.getNodeAttributes(node)
          setSelectedNode(nodeData.rawData as GraphNode)
          const edges: GraphEdge[] = []
          graph.forEachEdge(node, (_, attrs) => {
            if (attrs.rawData) edges.push(attrs.rawData as GraphEdge)
          })
          setNodeEdges(edges)
          setDrawerOpen(true)
        })

        sigma.on('enterNode', ({ node }) => {
          graph.setNodeAttribute(node, 'highlighted', true)
        })
        sigma.on('leaveNode', ({ node }) => {
          graph.setNodeAttribute(node, 'highlighted', false)
        })

        setGraphInfo({ nodes: data.nodes.length, edges: data.edges.length })
      } catch (err: unknown) {
        message.error(extractErrorDetail(err, `加载图谱失败：${label}`))
      } finally {
        setLoading(false)
      }
    },
    [maxDepth, maxNodes, isDark]
  )

  useEffect(() => {
    if (selectedLabel) {
      buildGraph(selectedLabel)
    }
  }, [selectedLabel, buildGraph])

  useEffect(() => () => { sigmaRef.current?.kill() }, [])

  const handleSearch = async (q: string) => {
    if (!q.trim()) { setSearchResults([]); return }
    setSearching(true)
    try {
      const results = await searchGraphLabels(q, 20)
      setSearchResults(results)
    } catch (err: unknown) {
      message.error(extractErrorDetail(err, '搜索失败'))
    } finally {
      setSearching(false)
    }
  }

  const handleEntitySelect = (entity: string) => {
    setSearchQuery(entity)
    setSearchResults([])
    setSelectedLabel(entity)
  }

  const zoomIn = () => {
    const camera = sigmaRef.current?.getCamera()
    if (camera) camera.animatedZoom({ duration: 300 })
  }
  const zoomOut = () => {
    const camera = sigmaRef.current?.getCamera()
    if (camera) camera.animatedUnzoom({ duration: 300 })
  }
  const resetView = () => {
    const camera = sigmaRef.current?.getCamera()
    if (camera) camera.animatedReset({ duration: 400 })
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', gap: 16, padding: 16 }}>
      {/* 控制面板 */}
      <div style={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
        <Card size="small" title={<><ApartmentOutlined /> 知识图谱</>} style={{ borderRadius: 12 }}>
          {graphInfo && (
            <Space style={{ marginBottom: 12 }}>
              <Badge count={graphInfo.nodes} overflowCount={9999} style={{ backgroundColor: '#1677ff' }} showZero>
                <Tag>节点</Tag>
              </Badge>
              <Badge count={graphInfo.edges} overflowCount={9999} style={{ backgroundColor: '#52c41a' }} showZero>
                <Tag>边</Tag>
              </Badge>
            </Space>
          )}

          <div style={{ marginBottom: 12 }}>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
              选择实体标签
            </Text>
            <Select
              showSearch
              allowClear
              placeholder="选择一个实体进行探索"
              style={{ width: '100%' }}
              value={selectedLabel}
              onChange={(v) => { setSelectedLabel(v ?? null); setSearchQuery('') }}
              options={labels.map((l) => ({ value: l, label: l }))}
              filterOption={(input, option) =>
                (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
              }
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
              搜索实体
            </Text>
            <Search
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onSearch={handleSearch}
              placeholder="输入实体名称搜索..."
              loading={searching}
              style={{ width: '100%' }}
            />
            {searchResults.length > 0 && (
              <Card size="small" style={{ marginTop: 4, maxHeight: 200, overflowY: 'auto', borderRadius: 8 }}>
                {searchResults.map((r) => (
                  <div
                    key={r}
                    onClick={() => handleEntitySelect(r)}
                    style={{ padding: '4px 8px', cursor: 'pointer', borderRadius: 4 }}
                  >
                    <NodeIndexOutlined style={{ marginRight: 8, color: '#1677ff' }} />
                    {r}
                  </div>
                ))}
              </Card>
            )}
          </div>

          <div style={{ marginBottom: 12 }}>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
              最大节点数：{maxNodes}
            </Text>
            <Slider
              min={50}
              max={1000}
              step={50}
              value={maxNodes}
              onChange={setMaxNodes}
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
              最大深度
            </Text>
            <InputNumber
              min={1}
              max={6}
              value={maxDepth}
              onChange={(v) => setMaxDepth(v ?? 3)}
              style={{ width: '100%' }}
            />
          </div>

          {selectedLabel && (
            <Button
              icon={<ReloadOutlined />}
              onClick={() => buildGraph(selectedLabel)}
              loading={loading}
              block
              style={{ borderRadius: 8 }}
            >
              刷新图谱
            </Button>
          )}
        </Card>

        {/* 视图控制 */}
        <Card size="small" title="视图控制" style={{ borderRadius: 12 }}>
          <Space style={{ width: '100%', justifyContent: 'space-around' }}>
            <Tooltip title="放大">
              <Button icon={<ZoomInOutlined />} onClick={zoomIn} />
            </Tooltip>
            <Tooltip title="缩小">
              <Button icon={<ZoomOutOutlined />} onClick={zoomOut} />
            </Tooltip>
            <Tooltip title="重置视图">
              <Button icon={<FullscreenOutlined />} onClick={resetView} />
            </Tooltip>
          </Space>
        </Card>
      </div>

      {/* 图谱画布 */}
      <div style={{ flex: 1, position: 'relative', borderRadius: 12, overflow: 'hidden' }}>
        <Card
          style={{ height: '100%', borderRadius: 12 }}
          styles={{ body: { padding: 0, height: '100%' } }}
        >
          {loading && (
            <div style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0,0,0,0.3)',
              zIndex: 10,
              borderRadius: 12,
            }}>
              <Space direction="vertical" align="center">
                <Spin size="large" />
                <Text style={{ color: '#fff' }}>正在构建图谱...</Text>
              </Space>
            </div>
          )}
          {!selectedLabel && !loading && (
            <div style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column',
              gap: 12,
            }}>
              <Empty
                image={<ApartmentOutlined style={{ fontSize: 64, color: '#bfbfbf' }} />}
                imageStyle={{ height: 64 }}
                description={
                  <div style={{ textAlign: 'center' }}>
                    <Title level={5} style={{ color: '#8c8c8c' }}>尚未选择图谱</Title>
                    <Text type="secondary">从左侧面板选择一个实体标签，即可可视化知识图谱</Text>
                  </div>
                }
              />
            </div>
          )}
          <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
        </Card>
      </div>

      {/* 节点详情抽屉 */}
      <Drawer
        title={
          <Space>
            <NodeIndexOutlined />
            <span>实体详情</span>
          </Space>
        }
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={400}
      >
        {selectedNode && (
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            <Card size="small" title="基本信息">
              <Descriptions column={1} size="small">
                <Descriptions.Item label="ID">
                  <Text copyable code style={{ fontSize: 12 }}>{selectedNode.id}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="标签">
                  <Space wrap>
                    {selectedNode.labels.map((l) => (
                      <Tag key={l} color={stringToColor(l, isDark)} style={{ color: '#fff' }}>
                        {l}
                      </Tag>
                    ))}
                  </Space>
                </Descriptions.Item>
              </Descriptions>
            </Card>

            {Object.keys(selectedNode.properties).length > 0 && (
              <Card size="small" title="属性">
                <Descriptions column={1} size="small">
                  {Object.entries(selectedNode.properties).map(([k, v]) => (
                    <Descriptions.Item key={k} label={k}>
                      <Text style={{ fontSize: 12, wordBreak: 'break-all' }}>
                        {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                      </Text>
                    </Descriptions.Item>
                  ))}
                </Descriptions>
              </Card>
            )}

            {nodeEdges.length > 0 && (
              <Card size="small" title={`关联关系（${nodeEdges.length} 条）`}>
                <Space direction="vertical" style={{ width: '100%' }} size={4}>
                  {nodeEdges.slice(0, 20).map((edge, i) => (
                    <div key={i} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Tag color="blue" style={{ fontSize: 10 }}>{edge.source}</Tag>
                      <span style={{ color: '#8c8c8c' }}>→ {edge.type} →</span>
                      <Tag color="green" style={{ fontSize: 10 }}>{edge.target}</Tag>
                    </div>
                  ))}
                  {nodeEdges.length > 20 && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      还有 {nodeEdges.length - 20} 条关系...
                    </Text>
                  )}
                </Space>
              </Card>
            )}
          </Space>
        )}
      </Drawer>
    </div>
  )
}
