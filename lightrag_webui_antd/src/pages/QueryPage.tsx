import { useState, useRef, useCallback, useEffect } from 'react'
import {
  Input,
  Button,
  Card,
  Typography,
  Space,
  Divider,
  Select,
  Slider,
  Switch,
  Drawer,
  Tag,
  Tooltip,
  message as _msg,
  App,
  List,
  Badge,
  InputNumber,
  Collapse,
  Radio,
} from 'antd'
import {
  SendOutlined,
  SettingOutlined,
  ClearOutlined,
  UserOutlined,
  RobotOutlined,
  CopyOutlined,
  HistoryOutlined,
  StopOutlined,
  LoadingOutlined,
  DeleteOutlined,
  BulbOutlined,
} from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { queryStream, queryRag } from '@/api/client'
import { useSettingsStore } from '@/stores/settings'
import { useChatStore } from '@/stores/chat'
import { useKBStore } from '@/stores/kb'
import { useAuthStore } from '@/stores/auth'
import type { ChatMessage, ReferenceItem, QueryMode, Message, ChatSession } from '@/types'

const { Text, Title } = Typography
const { TextArea } = Input

function generateId() {
  return Math.random().toString(36).slice(2, 10)
}

function parseThinking(content: string): { thinking: string; rest: string; thinkingOpen: boolean } {
  const closeIdx = content.indexOf('</think>')
  if (closeIdx !== -1) {
    const openIdx = content.indexOf('<think>')
    const thinking = openIdx !== -1 ? content.slice(openIdx + 7, closeIdx).trim() : ''
    const before = openIdx !== -1 ? content.slice(0, openIdx) : ''
    const rest = (before + content.slice(closeIdx + 8)).trim()
    return { thinking, rest, thinkingOpen: false }
  }
  const openIdx = content.indexOf('<think>')
  if (openIdx !== -1) {
    const thinking = content.slice(openIdx + 7).trim()
    const before = content.slice(0, openIdx)
    return { thinking, rest: before.trim(), thinkingOpen: true }
  }
  return { thinking: '', rest: content, thinkingOpen: false }
}

const MODE_OPTIONS: { value: QueryMode; label: string; description: string }[] = [
  { value: 'hybrid', label: '混合模式', description: '结合局部与全局检索' },
  { value: 'local', label: '局部模式', description: '以实体为中心的上下文检索' },
  { value: 'global', label: '全局模式', description: '基于社区摘要的宏观检索' },
  { value: 'mix', label: 'Mix 模式', description: '知识图谱 + 向量检索（推荐配合重排）' },
  { value: 'naive', label: '朴素模式', description: '直接向量搜索，不使用图谱' },
  { value: 'bypass', label: '直通模式', description: '跳过 RAG，直接调用 LLM' },
]

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const { message } = App.useApp()
  const isUser = msg.role === 'user'

  const handleCopy = () => {
    navigator.clipboard.writeText(msg.content)
    message.success('已复制到剪贴板')
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: isUser ? 'row-reverse' : 'row',
      alignItems: 'flex-start',
      gap: 10,
      marginBottom: 16,
    }}>
      <div style={{
        width: 36,
        height: 36,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: isUser ? '#1677ff' : '#52c41a',
        flexShrink: 0,
        fontSize: 16,
        color: '#fff',
      }}>
        {isUser ? <UserOutlined /> : <RobotOutlined />}
      </div>

      <div style={{ maxWidth: '80%', minWidth: 100 }}>
        <div style={{
          padding: '10px 14px',
          borderRadius: isUser ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
          background: isUser ? '#1677ff' : undefined,
          border: isUser ? 'none' : '1px solid #f0f0f0',
          position: 'relative',
        }}>
          {isUser ? (
            <Text style={{ color: '#fff', whiteSpace: 'pre-wrap' }}>{msg.content}</Text>
          ) : (
            <div className="markdown-body" style={{ fontSize: 14, lineHeight: 1.7 }}>
              {msg.isStreaming && !msg.content ? (
                <span style={{ opacity: 0.5 }}>
                  <LoadingOutlined spin style={{ marginRight: 6 }} />
                  思考中...
                </span>
              ) : (() => {
                const { thinking, rest, thinkingOpen } = parseThinking(msg.content)
                return (
                  <>
                    {thinking && (
                      <Collapse
                        size="small"
                        style={{ marginBottom: 10, background: 'rgba(0,0,0,0.03)', border: '1px solid #e8e8e8' }}
                        items={[{
                          key: 'think',
                          label: (
                            <Space size={4}>
                              <BulbOutlined style={{ color: '#fa8c16' }} />
                              <Text type="secondary" style={{ fontSize: 12 }}>
                                思考过程{thinkingOpen ? '（思考中...）' : ''}
                              </Text>
                            </Space>
                          ),
                          children: (
                            <div style={{ fontSize: 12, color: '#888', whiteSpace: 'pre-wrap', maxHeight: 300, overflowY: 'auto' }}>
                              {thinking}
                              {thinkingOpen && <span className="streaming-cursor">▋</span>}
                            </div>
                          ),
                        }]}
                      />
                    )}
                    {rest && (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{rest}</ReactMarkdown>
                    )}
                    {msg.isStreaming && !thinkingOpen && (
                      <span className="streaming-cursor">▋</span>
                    )}
                  </>
                )
              })()}
            </div>
          )}
        </div>

        {!isUser && msg.references && msg.references.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <Collapse
              size="small"
              items={[{
                key: '1',
                label: <Text type="secondary" style={{ fontSize: 12 }}>
                  {msg.references.length} 个引用来源
                </Text>,
                children: (
                  <Space direction="vertical" style={{ width: '100%' }} size={4}>
                    {msg.references.map((ref, i) => (
                      <div key={i} style={{ fontSize: 12 }}>
                        <Tag color="blue">{i + 1}</Tag>
                        <Text type="secondary" copyable={{ text: ref.file_path }} style={{ fontSize: 11 }}>
                          {ref.file_path}
                        </Text>
                      </div>
                    ))}
                  </Space>
                ),
              }]}
            />
          </div>
        )}

        {!isUser && !msg.isStreaming && msg.content && (
          <div style={{ marginTop: 4 }}>
            <Tooltip title="复制回答">
              <Button type="text" size="small" icon={<CopyOutlined />} onClick={handleCopy} />
            </Tooltip>
          </div>
        )}

        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4, textAlign: isUser ? 'right' : 'left' }}>
          {new Date(msg.timestamp).toLocaleTimeString('zh-CN')}
        </Text>
      </div>
    </div>
  )
}

function HistoryItem({
  item,
  active,
  onClick,
  onDelete,
}: {
  item: { id: string; preview: string; timestamp: number; mode: QueryMode }
  active: boolean
  onClick: () => void
  onDelete: () => void
}) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '8px 12px',
        borderRadius: 8,
        cursor: 'pointer',
        background: active ? '#1677ff22' : 'transparent',
        borderLeft: active ? '3px solid #1677ff' : '3px solid transparent',
        marginBottom: 4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text ellipsis style={{ fontSize: 13, maxWidth: 160 }}>{item.preview}</Text>
          <Badge
            count={item.mode}
            style={{ backgroundColor: '#1677ff', fontSize: 10 }}
          />
        </div>
        <Text type="secondary" style={{ fontSize: 11 }}>
          {new Date(item.timestamp).toLocaleString('zh-CN')}
        </Text>
      </div>
      <Button
        type="text"
        size="small"
        danger
        icon={<DeleteOutlined />}
        onClick={(e) => { e.stopPropagation(); onDelete() }}
        style={{ flexShrink: 0 }}
      />
    </div>
  )
}

export default function QueryPage() {
  const { message } = App.useApp()
  const { querySettings, updateQuerySettings } = useSettingsStore()
  const { sessions, activeSessionId, isLoading: isSessionsLoading, saveSession, deleteSession, setActiveSessionId, clearActiveSession, loadSessions } = useChatStore()
  const { currentKBId } = useKBStore()
  const { webuiTitle } = useAuthStore()

  // Only show sessions that belong to the current KB
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const kbSessions = (sessions ?? []).filter((s) => s.kbId === currentKBId)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Load sessions from backend on mount and when KB changes
  useEffect(() => {
    loadSessions(currentKBId).then(() => {
      // After sessions are loaded, restore the active session for this KB
      const store = useChatStore.getState()
      if (store.activeSessionId) {
        const session = store.sessions.find(
          (s) => s.id === store.activeSessionId && s.kbId === currentKBId
        )
        if (session) {
          setMessages(session.messages)
          return
        }
      }
      setMessages([])
    })
  }, [currentKBId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // When the active KB changes, clear the current conversation
  // to prevent cross-KB context leakage
  const prevKBIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (prevKBIdRef.current !== null && prevKBIdRef.current !== currentKBId) {
      setMessages([])
      clearActiveSession()
    }
    prevKBIdRef.current = currentKBId
  }, [currentKBId])

  const buildHistory = useCallback((): Message[] => {
    return messages
      .filter((m) => !m.isStreaming)
      .map((m) => ({ role: m.role, content: m.content }))
  }, [messages])

  const handleSend = useCallback(async () => {
    const query = input.trim()
    if (!query || isStreaming) return

    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: query,
      timestamp: Date.now(),
    }

    const assistantId = generateId()
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      isStreaming: true,
      timestamp: Date.now(),
    }

    setMessages((prev) => [...prev, userMsg, assistantMsg])
    setInput('')
    setIsStreaming(true)

    const history = buildHistory()
    abortRef.current = new AbortController()

    try {
      const req = {
        query,
        mode: querySettings.mode,
        top_k: querySettings.topK,
        chunk_top_k: querySettings.chunkTopK,
        max_entity_tokens: querySettings.maxEntityTokens,
        max_relation_tokens: querySettings.maxRelationTokens,
        max_total_tokens: querySettings.maxTotalTokens,
        stream: querySettings.stream,
        enable_rerank: querySettings.enableRerank,
        response_type: querySettings.responseType || undefined,
        conversation_history: history.slice(-querySettings.historyTurns * 2),
        history_turns: querySettings.historyTurns,
      }

      // Track final assistant content outside of state updaters to avoid side-effect antipattern
      let finalContent = ''
      let finalReferences: ReferenceItem[] | undefined

      if (querySettings.stream) {
        let accumulated = ''
        let references: ReferenceItem[] | undefined

        for await (const chunk of queryStream(req, abortRef.current.signal)) {
          if (chunk.references) {
            references = chunk.references as ReferenceItem[]
          }
          if (chunk.response) {
            accumulated += chunk.response
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: accumulated } : m
              )
            )
          }
          if (chunk.error) {
            throw new Error(chunk.error)
          }
        }

        finalContent = accumulated
        finalReferences = references
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, isStreaming: false, content: accumulated, references }
              : m
          )
        )
      } else {
        const res = await queryRag(req)
        finalContent = res.response
        finalReferences = res.references
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, isStreaming: false, content: res.response, references: res.references }
              : m
          )
        )
      }

      const sessionId = activeSessionId ?? generateId()
      if (!activeSessionId) setActiveSessionId(sessionId)

      // Build final messages list and save to backend
      const finalAssistantMsg: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: finalContent,
        isStreaming: false,
        references: finalReferences,
        timestamp: assistantMsg.timestamp,
      }
      const finalMessages = [...messages, userMsg, finalAssistantMsg]
      saveSession({
        id: sessionId,
        kbId: useKBStore.getState().currentKBId,
        messages: finalMessages,
        preview: query.slice(0, 50),
        timestamp: Date.now(),
        mode: querySettings.mode,
      })
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === 'AbortError') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, isStreaming: false, content: m.content || '（已取消）' }
              : m
          )
        )
      } else {
        const errMsg = err instanceof Error ? err.message : '查询失败'
        message.error(errMsg)
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, isStreaming: false, content: `错误：${errMsg}` }
              : m
          )
        )
      }
    } finally {
      setIsStreaming(false)
      abortRef.current = null
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [input, isStreaming, querySettings, buildHistory, activeSessionId, messages, saveSession])

  const handleStop = () => {
    abortRef.current?.abort()
  }

  const handleClear = () => {
    setMessages([])
    setActiveSessionId(null)
  }

  const handleLoadSession = (session: ChatSession) => {
    setMessages(session.messages)
    setActiveSessionId(session.id)
    setHistoryOpen(false)
  }

  const handleDeleteSession = (id: string) => {
    deleteSession(id)
    if (id === activeSessionId) {
      setMessages([])
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* 顶部栏 */}
        <div style={{
          padding: '12px 20px',
          borderBottom: '1px solid #f0f0f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <Space>
            <Title level={5} style={{ margin: 0 }}>知识库问答</Title>
            <Tag color="blue">{MODE_OPTIONS.find(m => m.value === querySettings.mode)?.label ?? querySettings.mode}</Tag>
          </Space>
          <Space>
            <Tooltip title="历史会话">
              <Badge count={kbSessions.length} size="small">
                <Button
                  type="text"
                  icon={<HistoryOutlined />}
                  onClick={() => setHistoryOpen(true)}
                />
              </Badge>
            </Tooltip>
            {messages.length > 0 && (
              <Tooltip title="清空对话">
                <Button type="text" icon={<ClearOutlined />} onClick={handleClear} />
              </Tooltip>
            )}
            <Button
              type="text"
              icon={<SettingOutlined />}
              onClick={() => setSettingsOpen(true)}
            >
              参数设置
            </Button>
          </Space>
        </div>

        {/* 消息区 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 20px 0' }}>
          {messages.length === 0 ? (
            <div style={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 16,
              opacity: 0.7,
            }}>
              <RobotOutlined style={{ fontSize: 64, color: '#bfbfbf' }} />
              <Title level={4} style={{ color: '#8c8c8c', margin: 0 }}>向 {webuiTitle || 'LightRAG'} 提问</Title>
              <Text type="secondary">
                检索模式：<Tag color="blue">{MODE_OPTIONS.find(m => m.value === querySettings.mode)?.label}</Tag>
                Top-K：<Tag>{querySettings.topK}</Tag>
              </Text>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 500 }}>
                {[
                  '知识库中有哪些主要实体？',
                  '总结一下关键的实体关系',
                  '这个知识库涵盖了哪些主题？',
                ].map((s) => (
                  <Tag
                    key={s}
                    style={{ cursor: 'pointer', padding: '4px 10px', borderRadius: 20 }}
                    onClick={() => setInput(s)}
                  >
                    {s}
                  </Tag>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg) => (
                <MessageBubble key={msg.id} msg={msg} />
              ))}
              <div ref={messagesEndRef} style={{ height: 20 }} />
            </>
          )}
        </div>

        {/* 输入区 */}
        <div style={{ padding: '12px 20px 20px', borderTop: '1px solid #f0f0f0' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <TextArea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入问题，按 Enter 发送，Shift+Enter 换行..."
              autoSize={{ minRows: 1, maxRows: 5 }}
              disabled={isStreaming}
              style={{ borderRadius: 10, flex: 1 }}
            />
            {isStreaming ? (
              <Button
                danger
                icon={<StopOutlined />}
                onClick={handleStop}
                style={{ borderRadius: 10, height: 40, width: 40 }}
              />
            ) : (
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={handleSend}
                disabled={!input.trim()}
                style={{ borderRadius: 10, height: 40, width: 40 }}
              />
            )}
          </div>
          <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
            {querySettings.stream ? '⚡ 流式输出' : '📦 批量输出'} ·
            模式：{MODE_OPTIONS.find(m => m.value === querySettings.mode)?.label} ·
            Top-K：{querySettings.topK}
            {isStreaming && <><LoadingOutlined spin style={{ marginLeft: 6 }} /> 生成中...</>}
          </Text>
        </div>
      </div>

      {/* 参数设置抽屉 */}
      <Drawer
        title={<Space><SettingOutlined /> 查询参数设置</Space>}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        width={360}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={20}>
          <div>
            <Text strong style={{ display: 'block', marginBottom: 10 }}>检索模式</Text>
            <Radio.Group
              value={querySettings.mode}
              onChange={(e) => updateQuerySettings({ mode: e.target.value })}
              style={{ width: '100%' }}
            >
              <Space direction="vertical" style={{ width: '100%' }} size={4}>
                {MODE_OPTIONS.map((opt) => (
                  <Radio key={opt.value} value={opt.value}>
                    <Space>
                      <Text strong style={{ fontSize: 13 }}>{opt.label}</Text>
                      <Text type="secondary" style={{ fontSize: 11 }}>{opt.description}</Text>
                    </Space>
                  </Radio>
                ))}
              </Space>
            </Radio.Group>
          </div>

          <Divider style={{ margin: '0' }} />

          <div>
            <Text strong style={{ display: 'block', marginBottom: 10 }}>检索参数</Text>
            <Space direction="vertical" style={{ width: '100%' }} size={12}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>实体 Top-K</Text>
                  <InputNumber
                    size="small"
                    min={1}
                    max={200}
                    value={querySettings.topK}
                    onChange={(v) => updateQuerySettings({ topK: v ?? 60 })}
                    style={{ width: 70 }}
                  />
                </div>
                <Slider min={1} max={200} value={querySettings.topK}
                  onChange={(v) => updateQuerySettings({ topK: v })} />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>文本块 Top-K</Text>
                  <InputNumber
                    size="small"
                    min={1}
                    max={100}
                    value={querySettings.chunkTopK}
                    onChange={(v) => updateQuerySettings({ chunkTopK: v ?? 10 })}
                    style={{ width: 70 }}
                  />
                </div>
                <Slider min={1} max={100} value={querySettings.chunkTopK}
                  onChange={(v) => updateQuerySettings({ chunkTopK: v })} />
              </div>

              <div>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                  最大 Token 数
                </Text>
                <Select
                  value={querySettings.maxTotalTokens}
                  onChange={(v) => updateQuerySettings({ maxTotalTokens: v })}
                  style={{ width: '100%' }}
                  options={[
                    { value: 8000, label: '8K tokens' },
                    { value: 12000, label: '12K tokens' },
                    { value: 20000, label: '20K tokens' },
                    { value: 32000, label: '32K tokens' },
                    { value: 64000, label: '64K tokens' },
                  ]}
                />
              </div>

              <div>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                  携带历史轮数
                </Text>
                <Slider
                  min={0}
                  max={10}
                  value={querySettings.historyTurns}
                  onChange={(v) => updateQuerySettings({ historyTurns: v })}
                  marks={{ 0: '0', 3: '3', 6: '6', 10: '10' }}
                />
              </div>
            </Space>
          </div>

          <Divider style={{ margin: '0' }} />

          <div>
            <Text strong style={{ display: 'block', marginBottom: 10 }}>功能开关</Text>
            <Space direction="vertical" style={{ width: '100%' }} size={8}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Space>
                  <Text style={{ fontSize: 13 }}>流式输出</Text>
                  <Tag color="blue" style={{ fontSize: 10 }}>推荐</Tag>
                </Space>
                <Switch
                  checked={querySettings.stream}
                  onChange={(v) => updateQuerySettings({ stream: v })}
                  size="small"
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 13 }}>启用重排序</Text>
                <Switch
                  checked={querySettings.enableRerank}
                  onChange={(v) => updateQuerySettings({ enableRerank: v })}
                  size="small"
                />
              </div>
            </Space>
          </div>

          <div>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
              回答格式
            </Text>
            <Select
              value={querySettings.responseType}
              onChange={(v) => updateQuerySettings({ responseType: v })}
              style={{ width: '100%' }}
              options={[
                { value: 'Multiple Paragraphs', label: '多段落' },
                { value: 'Single Paragraph', label: '单段落' },
                { value: 'Bullet Points', label: '要点列表' },
                { value: 'Brief Summary', label: '简短摘要' },
                { value: 'Detailed Report', label: '详细报告' },
              ]}
            />
          </div>
        </Space>
      </Drawer>

      {/* 历史会话抽屉 */}
      <Drawer
        title={<Space><HistoryOutlined /> 历史会话（{kbSessions.length}）</Space>}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        width={320}
        extra={
          kbSessions.length > 0 && (
            <Button
              danger
              type="text"
              size="small"
              onClick={() => {
                useChatStore.getState().clearAll(currentKBId)
                setMessages([])
                setHistoryOpen(false)
              }}
            >
              清空全部
            </Button>
          )
        }
      >
        {isSessionsLoading ? (
          <div style={{ textAlign: 'center', paddingTop: 40 }}>
            <LoadingOutlined style={{ fontSize: 32, color: '#bfbfbf' }} />
            <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>加载中…</Text>
          </div>
        ) : kbSessions.length === 0 ? (
          <div style={{ textAlign: 'center', paddingTop: 40 }}>
            <HistoryOutlined style={{ fontSize: 40, color: '#bfbfbf' }} />
            <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>暂无历史会话</Text>
          </div>
        ) : (
          <List
            dataSource={kbSessions}
            renderItem={(session) => (
              <HistoryItem
                item={session}
                active={session.id === activeSessionId}
                onClick={() => handleLoadSession(session)}
                onDelete={() => handleDeleteSession(session.id)}
              />
            )}
          />
        )}
      </Drawer>

      <style>{`
        .streaming-cursor {
          display: inline-block;
          animation: blink 1s step-end infinite;
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        .markdown-body pre {
          background: rgba(0,0,0,0.06);
          border-radius: 6px;
          padding: 12px;
          overflow-x: auto;
        }
        .markdown-body code {
          background: rgba(0,0,0,0.06);
          padding: 2px 4px;
          border-radius: 3px;
          font-family: monospace;
          font-size: 0.9em;
        }
        .markdown-body pre code { background: none; padding: 0; }
        .markdown-body table { border-collapse: collapse; width: 100%; }
        .markdown-body th, .markdown-body td { border: 1px solid #e0e0e0; padding: 6px 10px; }
        .markdown-body th { background: rgba(0,0,0,0.04); }
        .markdown-body blockquote {
          border-left: 3px solid #1677ff;
          padding-left: 12px;
          margin: 8px 0;
          color: #666;
        }
      `}</style>
    </div>
  )
}
