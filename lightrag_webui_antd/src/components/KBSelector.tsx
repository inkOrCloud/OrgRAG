/**
 * KBSelector – sidebar knowledge base switcher.
 *
 * Shows the currently selected KB as a Select dropdown so the user can
 * switch to any accessible KB directly from the sidebar.
 * Fetches the KB list on first mount and after auth.
 */
import { useEffect } from 'react'
import { Select, Tag, Typography, App, Spin, Tooltip } from 'antd'
import { DatabaseOutlined } from '@ant-design/icons'
import { listKBs, getKBSettings } from '@/api/client'
import { useKBStore } from '@/stores/kb'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'
import { useSettingsStore as useThemeStore } from '@/stores/settings'

const { Text } = Typography

interface KBSelectorProps {
  collapsed?: boolean
}

export default function KBSelector({ collapsed = false }: KBSelectorProps) {
  const { message } = App.useApp()
  const { isAuthenticated } = useAuthStore()
  const { kbs, setKBs, currentKBId, setCurrentKBId, loaded } = useKBStore()
  const { updateQuerySettings } = useSettingsStore()
  const { isDark } = useThemeStore()

  const applyKBSettings = async (kbId: string) => {
    try {
      const res = await getKBSettings(kbId)
      if (res.settings && Object.keys(res.settings).length > 0) {
        updateQuerySettings(res.settings as Parameters<typeof updateQuerySettings>[0])
      }
    } catch {
      // KB settings are optional; silently ignore errors
    }
  }

  // Load KB list when authenticated; apply settings for the initial active KB
  useEffect(() => {
    if (!isAuthenticated) return
    listKBs()
      .then((res) => {
        setKBs(res.kbs)
        // Apply settings for the already-selected KB (e.g. after page reload)
        const activeId = useKBStore.getState().currentKBId
        if (activeId) applyKBSettings(activeId)
      })
      .catch(() => message.warning('无法加载知识库列表'))
  }, [isAuthenticated]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!isAuthenticated || (!loaded && kbs.length === 0)) {
    return collapsed ? null : (
      <div style={{ padding: '12px 16px' }}>
        <Spin size="small" />
      </div>
    )
  }

  if (collapsed) {
    // Collapsed sidebar: show only the icon with a tooltip
    const current = kbs.find((kb) => kb.id === currentKBId)
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        padding: '12px 0',
        borderBottom: isDark ? '1px solid #303030' : '1px solid #f0f0f0',
      }}>
        <Tooltip title={current?.name ?? '知识库'} placement="right">
          <DatabaseOutlined style={{ fontSize: 18, color: '#1677ff', cursor: 'pointer' }} />
        </Tooltip>
      </div>
    )
  }

  const handleChange = (id: string) => {
    setCurrentKBId(id)
    applyKBSettings(id)
  }

  return (
    <div style={{
      padding: '10px 12px 12px',
      borderBottom: isDark ? '1px solid #303030' : '1px solid #f0f0f0',
    }}>
      <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 6, paddingLeft: 2 }}>
        当前知识库
      </Text>
      <Select
        value={currentKBId ?? undefined}
        onChange={handleChange}
        style={{ width: '100%' }}
        suffixIcon={<DatabaseOutlined style={{ color: '#1677ff' }} />}
        optionLabelProp="label"
        popupMatchSelectWidth={false}
        options={kbs.map((kb) => ({
          value: kb.id,
          label: (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {kb.name}
              {kb.is_default && (
                <Tag color="gold" style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px', marginLeft: 2 }}>
                  默认
                </Tag>
              )}
            </span>
          ),
          title: kb.name,
        }))}
      />
    </div>
  )
}

