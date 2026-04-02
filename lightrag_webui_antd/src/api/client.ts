import axios, { AxiosError } from 'axios'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'
import { useKBStore } from '@/stores/kb'
import type {
  AuthStatusResponse,
  LoginResponse,
  HealthStatus,
  PaginatedDocsResponse,
  DocActionResponse,
  QueryRequest,
  QueryResponse,
  GraphData,
  PipelineStatusResponse,
  User,
  UserCreateRequest,
  UserUpdateRequest,
  ChangePasswordRequest,
  UsersListResponse,
  UserResponse,
  KnowledgeBase,
  KBCreateRequest,
  KBUpdateRequest,
  KBListResponse,
  KBResponse,
  KBStats,
  KBSettings,
  KBSettingsResponse,
  Organization,
  OrgCreateRequest,
  OrgUpdateRequest,
  OrgMemberAddRequest,
  OrgMemberRoleRequest,
  OrgTreeResponse,
  OrgDetailResponse,
  OrgMembersResponse,
  MyOrgResponse,
  OrgKBPermissionsResponse,
  KBPermissionRequest,
  ChatSession,
  SaveSessionRequest,
  ChatSessionsResponse,
  SetupStatusResponse,
  SetupRequest,
  SetupResponse,
} from '@/types'

// ── Axios instance ──────────────────────────────────────────────
const axiosInstance = axios.create({
  headers: { 'Content-Type': 'application/json' },
})

// Resolve base URL, inject Bearer token, and inject X-KB-ID per request
axiosInstance.interceptors.request.use((config) => {
  const base = useSettingsStore.getState().apiBaseUrl
  if (base && config.url && !config.url.startsWith('http')) {
    config.baseURL = base
  }

  const token = useAuthStore.getState().token
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`
  }

  // Inject active knowledge-base id for data-plane endpoints
  const url = config.url ?? ''
  const skipKB = url.startsWith('/kbs') || url.startsWith('/login') ||
    url.startsWith('/auth-status') || url.startsWith('/health') ||
    url.startsWith('/users') || url.startsWith('/chat') ||
    url.startsWith('/orgs') || url.startsWith('/setup')
  if (!skipKB) {
    const kbId: string | null = useKBStore.getState().currentKBId
    if (kbId) config.headers['X-KB-ID'] = kbId
  }

  return config
})

axiosInstance.interceptors.response.use(
  (res) => res,
  (err: AxiosError) => {
    // Do NOT redirect on 401 from the login endpoint itself –
    // wrong credentials should be handled by the login form's catch block.
    const url = err.config?.url ?? ''
    const isLoginEndpoint = url.startsWith('/login') || url.startsWith('/auth-status') || url.startsWith('/setup')
    if (err.response?.status === 401 && !isLoginEndpoint) {
      useAuthStore.getState().logout()
      window.location.href = '/webui/login'
    }
    // Promote backend `detail` message onto the Error so catch blocks
    // that use `err.message` automatically get the human-readable reason.
    const detail = (err.response?.data as { detail?: string } | undefined)?.detail
    if (detail && typeof detail === 'string') {
      err.message = detail
    }
    return Promise.reject(err)
  }
)

// ── Helper ──────────────────────────────────────────────────────
function getApiBase(): string {
  return useSettingsStore.getState().apiBaseUrl || ''
}

function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** Return X-KB-ID header for the currently selected knowledge base. */
function kbHeaders(): Record<string, string> {
  const kbId = useKBStore.getState().currentKBId
  return kbId ? { 'X-KB-ID': kbId } : {}
}

/**
 * Extract a user-friendly error message from an unknown catch value.
 * Priority: AxiosError response.data.detail → err.message → fallback.
 */
export function extractErrorDetail(err: unknown, fallback: string): string {
  if (!err) return fallback
  const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
  if (detail && typeof detail === 'string') return detail
  if (err instanceof Error && err.message) return err.message
  return fallback
}

// ── Auth ────────────────────────────────────────────────────────
export async function getAuthStatus(): Promise<AuthStatusResponse> {
  const { data } = await axiosInstance.get<AuthStatusResponse>('/auth-status')
  return data
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  const form = new FormData()
  form.append('username', username)
  form.append('password', password)
  const { data } = await axiosInstance.post<LoginResponse>('/login', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

// ── Setup / Initialization Wizard ───────────────────────────────
export async function getSetupStatus(): Promise<SetupStatusResponse> {
  const { data } = await axiosInstance.get<SetupStatusResponse>('/setup/status')
  return data
}

export async function completeSetup(body: SetupRequest): Promise<SetupResponse> {
  const { data } = await axiosInstance.post<SetupResponse>('/setup', body)
  return data
}

// ── Health ──────────────────────────────────────────────────────
export async function getHealth(): Promise<HealthStatus> {
  const { data } = await axiosInstance.get<HealthStatus>('/health')
  return data
}

// ── Documents ───────────────────────────────────────────────────
export interface DocumentsParams {
  page?: number
  pageSize?: number
  statusFilter?: string | null
  sortField?: string
  sortDirection?: 'asc' | 'desc'
}

export async function getDocuments(params: DocumentsParams = {}): Promise<PaginatedDocsResponse> {
  // /documents/paginated is a POST endpoint that accepts a JSON body
  const body: Record<string, unknown> = {
    page: params.page ?? 1,
    page_size: params.pageSize ?? 20,
    sort_field: params.sortField ?? 'updated_at',
    sort_direction: params.sortDirection ?? 'desc',
  }
  // only include status_filter when explicitly set
  if (params.statusFilter) {
    body.status_filter = params.statusFilter
  }
  const { data } = await axiosInstance.post<PaginatedDocsResponse>('/documents/paginated', body)
  return data
}

export async function uploadDocuments(files: File[]): Promise<DocActionResponse> {
  // Backend accepts one file per request (field name: 'file' singular).
  // Upload sequentially and aggregate results.
  if (files.length === 0) {
    return { status: 'success', message: '没有可上传的文件' }
  }

  let successCount = 0
  let failCount = 0
  let lastData: DocActionResponse | null = null

  for (const file of files) {
    try {
      const form = new FormData()
      form.append('file', file)  // field name must match backend: 'file' (singular)
      const { data } = await axiosInstance.post<DocActionResponse>('/documents/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      lastData = data
      if (data.status === 'success' || data.status === 'duplicated') {
        successCount++
      } else {
        failCount++
      }
    } catch {
      failCount++
    }
  }

  // Single file: return its response directly for accurate status/message
  if (files.length === 1 && lastData) return lastData

  // Multiple files: return aggregated result
  if (failCount === 0) {
    return { status: 'success', message: `已成功上传 ${successCount} 个文件，正在后台处理中` }
  } else if (successCount > 0) {
    return {
      status: 'partial_success',
      message: `${successCount} 个文件上传成功，${failCount} 个文件上传失败`,
    }
  }
  throw new Error(`${failCount} 个文件上传失败`)
}

export async function insertText(
  text: string,
  id?: string
): Promise<DocActionResponse> {
  const { data } = await axiosInstance.post<DocActionResponse>('/documents/text', {
    text,
    id,
  })
  return data
}

export async function insertTexts(
  texts: string[],
  ids?: string[]
): Promise<DocActionResponse> {
  const { data } = await axiosInstance.post<DocActionResponse>('/documents/texts', {
    texts,
    ids,
  })
  return data
}

export async function deleteDocument(docId: string): Promise<DocActionResponse> {
  const { data } = await axiosInstance.delete<DocActionResponse>(
    `/documents/delete_document`,
    { data: { doc_ids: [docId], delete_file: false, delete_llm_cache: false } }
  )
  return data
}

export async function deleteDocuments(docIds: string[]): Promise<DocActionResponse> {
  const { data } = await axiosInstance.delete<DocActionResponse>(
    `/documents/delete_document`,
    { data: { doc_ids: docIds, delete_file: false, delete_llm_cache: false } }
  )
  return data
}

export async function clearCache(): Promise<{ status: string; message: string }> {
  const { data } = await axiosInstance.post('/documents/clear_cache')
  return data
}

export async function scanDocuments(): Promise<{ status: string; message: string; track_id: string }> {
  const { data } = await axiosInstance.post('/documents/scan')
  return data
}

export async function reprocessFailed(): Promise<{ status: string; message: string }> {
  const { data } = await axiosInstance.post('/documents/reprocess_failed')
  return data
}

export async function cancelPipeline(): Promise<{ status: string; message: string }> {
  const { data } = await axiosInstance.post('/documents/cancel_pipeline')
  return data
}

export async function getPipelineStatus(): Promise<PipelineStatusResponse> {
  const { data } = await axiosInstance.get<PipelineStatusResponse>('/documents/pipeline_status')
  return data
}

// ── Query (non-streaming) ────────────────────────────────────────
export async function queryRag(req: QueryRequest): Promise<QueryResponse> {
  const { data } = await axiosInstance.post<QueryResponse>('/query', req)
  return data
}

// ── Query (streaming) ────────────────────────────────────────────
export async function* queryStream(
  req: QueryRequest,
  signal?: AbortSignal
): AsyncGenerator<{ response?: string; references?: unknown[]; error?: string }> {
  const base = getApiBase()
  const url = `${base}/query/stream`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...kbHeaders(),
    },
    body: JSON.stringify(req),
    signal,
  })

  if (!res.ok) {
    const text = await res.text()
    // Try to extract a human-readable detail from JSON error body
    let detail: string | undefined
    try { detail = (JSON.parse(text) as { detail?: string }).detail } catch { /* ignore */ }
    throw new Error(detail ?? `查询失败（${res.status}）`)
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          yield JSON.parse(trimmed)
        } catch {
          // skip malformed line
        }
      }
    }

    // Flush remaining buffer
    if (buffer.trim()) {
      try {
        yield JSON.parse(buffer.trim())
      } catch {
        // ignore
      }
    }
  } finally {
    reader.releaseLock()
  }
}

// ── Graph ────────────────────────────────────────────────────────
export async function getGraphLabels(): Promise<string[]> {
  const { data } = await axiosInstance.get<string[]>('/graph/label/list')
  return data
}

export async function getPopularLabels(limit = 20): Promise<string[]> {
  const { data } = await axiosInstance.get<string[]>('/graph/label/popular', {
    params: { limit },
  })
  return data
}

export async function searchGraphLabels(q: string, limit = 50): Promise<string[]> {
  const { data } = await axiosInstance.get<string[]>('/graph/label/search', {
    params: { q, limit },
  })
  return data
}

export async function getGraphData(
  label: string,
  maxDepth = 3,
  maxNodes = 300
): Promise<GraphData> {
  const { data } = await axiosInstance.get<GraphData>('/graphs', {
    params: { label, max_depth: maxDepth, max_nodes: maxNodes },
  })
  return data
}

export async function checkEntityExists(name: string): Promise<boolean> {
  const { data } = await axiosInstance.get<{ exists: boolean }>('/graph/entity/exists', {
    params: { name },
  })
  return data.exists
}

export async function deleteEntity(entityName: string): Promise<DocActionResponse> {
  const { data } = await axiosInstance.delete<DocActionResponse>(
    '/documents/delete_entity',
    { params: { entity_name: entityName } }
  )
  return data
}

export async function deleteRelation(
  sourceId: string,
  targetId: string
): Promise<DocActionResponse> {
  const { data } = await axiosInstance.delete<DocActionResponse>(
    '/documents/delete_relation',
    { params: { source_id: sourceId, target_id: targetId } }
  )
  return data
}

// ── User Management ──────────────────────────────────────────────────────────

export async function listUsers(): Promise<UsersListResponse> {
  const { data } = await axiosInstance.get<UsersListResponse>('/users')
  return data
}

export async function createUser(req: UserCreateRequest): Promise<UserResponse> {
  const { data } = await axiosInstance.post<UserResponse>('/users', req)
  return data
}

export async function getMe(): Promise<UserResponse> {
  const { data } = await axiosInstance.get<UserResponse>('/users/me')
  return data
}

export async function changeMyPassword(req: ChangePasswordRequest): Promise<{ message: string }> {
  const { data } = await axiosInstance.put<{ message: string }>('/users/me/password', req)
  return data
}

export async function uploadMyAvatar(file: File): Promise<{ avatar_url: string; message: string }> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await axiosInstance.post<{ avatar_url: string; message: string }>(
    '/users/me/avatar',
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  )
  return data
}

export async function deleteMyAvatar(): Promise<{ message: string }> {
  const { data } = await axiosInstance.delete<{ message: string }>('/users/me/avatar')
  return data
}

export async function getUserById(userId: string): Promise<UserResponse> {
  const { data } = await axiosInstance.get<UserResponse>(`/users/${userId}`)
  return data
}

export async function updateUser(userId: string, req: UserUpdateRequest): Promise<UserResponse> {
  const { data } = await axiosInstance.put<UserResponse>(`/users/${userId}`, req)
  return data
}

export async function deleteUser(userId: string): Promise<{ message: string }> {
  const { data } = await axiosInstance.delete<{ message: string }>(`/users/${userId}`)
  return data
}

// ── Knowledge Base ───────────────────────────────────────────────────────────

export async function listKBs(): Promise<KBListResponse> {
  const { data } = await axiosInstance.get<KBListResponse>('/kbs')
  return data
}

export async function createKB(req: KBCreateRequest): Promise<KBResponse> {
  const { data } = await axiosInstance.post<KBResponse>('/kbs', req)
  return data
}

export async function getKBById(kbId: string): Promise<KBResponse> {
  const { data } = await axiosInstance.get<KBResponse>(`/kbs/${kbId}`)
  return data
}

export async function updateKB(kbId: string, req: KBUpdateRequest): Promise<KBResponse> {
  const { data } = await axiosInstance.put<KBResponse>(`/kbs/${kbId}`, req)
  return data
}

export async function deleteKB(kbId: string): Promise<{ message: string }> {
  const { data } = await axiosInstance.delete<{ message: string }>(`/kbs/${kbId}`)
  return data
}

// Phase 3: stats, settings, export, import
export async function getKBStats(kbId: string): Promise<KBStats> {
  const { data } = await axiosInstance.get<KBStats>(`/kbs/${kbId}/stats`)
  return data
}

export async function getKBSettings(kbId: string): Promise<KBSettingsResponse> {
  const { data } = await axiosInstance.get<KBSettingsResponse>(`/kbs/${kbId}/settings`)
  return data
}

export async function updateKBSettings(kbId: string, settings: KBSettings): Promise<KBSettingsResponse> {
  const { data } = await axiosInstance.put<KBSettingsResponse>(`/kbs/${kbId}/settings`, settings)
  return data
}

export async function exportKB(kbId: string): Promise<Blob> {
  const { data } = await axiosInstance.get(`/kbs/${kbId}/export`, { responseType: 'blob' })
  return data as Blob
}

export async function importKB(file: File): Promise<KBResponse> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await axiosInstance.post<KBResponse>('/kbs/import', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}


// ── Organization API (Phase A) ─────────────────────────────────────────────

export async function listOrgs(): Promise<OrgTreeResponse> {
  const { data } = await axiosInstance.get<OrgTreeResponse>('/orgs')
  return data
}

export async function getMyOrg(): Promise<MyOrgResponse> {
  const { data } = await axiosInstance.get<MyOrgResponse>('/orgs/my')
  return data
}

export async function getOrg(orgId: string): Promise<OrgDetailResponse> {
  const { data } = await axiosInstance.get<OrgDetailResponse>(`/orgs/${orgId}`)
  return data
}

export async function createOrg(body: OrgCreateRequest): Promise<{ org: Organization; message: string }> {
  const { data } = await axiosInstance.post<{ org: Organization; message: string }>('/orgs', body)
  return data
}

export async function updateOrg(orgId: string, body: OrgUpdateRequest): Promise<{ org: Organization; message: string }> {
  const { data } = await axiosInstance.put<{ org: Organization; message: string }>(`/orgs/${orgId}`, body)
  return data
}

export async function deleteOrg(orgId: string): Promise<{ message: string }> {
  const { data } = await axiosInstance.delete<{ message: string }>(`/orgs/${orgId}`)
  return data
}

export async function listOrgMembers(orgId: string): Promise<OrgMembersResponse> {
  const { data } = await axiosInstance.get<OrgMembersResponse>(`/orgs/${orgId}/members`)
  return data
}

export async function addOrgMember(orgId: string, body: OrgMemberAddRequest): Promise<{ member: import('@/types').OrgMember; message: string }> {
  const { data } = await axiosInstance.post(`/orgs/${orgId}/members`, body)
  return data
}

export async function updateOrgMemberRole(orgId: string, username: string, body: OrgMemberRoleRequest): Promise<{ message: string }> {
  const { data } = await axiosInstance.put<{ message: string }>(`/orgs/${orgId}/members/${username}`, body)
  return data
}

export async function removeOrgMember(orgId: string, username: string): Promise<{ message: string }> {
  const { data } = await axiosInstance.delete<{ message: string }>(`/orgs/${orgId}/members/${username}`)
  return data
}

// ── KB Operation Permissions API (Phase C) ─────────────────────────────────

export async function listOrgKBPermissions(orgId: string): Promise<OrgKBPermissionsResponse> {
  const { data } = await axiosInstance.get<OrgKBPermissionsResponse>(`/orgs/${orgId}/kb-permissions`)
  return data
}

export async function grantKBPermission(orgId: string, body: KBPermissionRequest): Promise<{ message: string }> {
  const { data } = await axiosInstance.post<{ message: string }>(`/orgs/${orgId}/kb-permissions`, body)
  return data
}

export async function revokeKBPermission(orgId: string, username: string, permission: string): Promise<{ message: string }> {
  const { data } = await axiosInstance.delete<{ message: string }>(`/orgs/${orgId}/kb-permissions/${username}/${permission}`)
  return data
}

// ── Chat Sessions ─────────────────────────────────────────────────────────────

export async function listChatSessions(kbId?: string | null): Promise<ChatSessionsResponse> {
  const params = kbId ? { kb_id: kbId } : {}
  const { data } = await axiosInstance.get<ChatSessionsResponse>('/chat/sessions', { params })
  return data
}

export async function saveChatSession(
  sessionId: string,
  req: SaveSessionRequest,
): Promise<{ session: ChatSession; message: string }> {
  const { data } = await axiosInstance.put(`/chat/sessions/${sessionId}`, req)
  return data
}

export async function deleteChatSession(sessionId: string): Promise<{ message: string }> {
  const { data } = await axiosInstance.delete<{ message: string }>(`/chat/sessions/${sessionId}`)
  return data
}

export async function clearChatSessions(kbId?: string | null): Promise<{ message: string }> {
  const body = kbId ? { kb_id: kbId } : {}
  const { data } = await axiosInstance.delete<{ message: string }>('/chat/sessions', { data: body })
  return data
}
