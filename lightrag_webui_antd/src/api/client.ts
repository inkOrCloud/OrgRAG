import axios, { AxiosError } from 'axios'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'
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
} from '@/types'

// ── Axios instance ──────────────────────────────────────────────
const axiosInstance = axios.create({
  headers: { 'Content-Type': 'application/json' },
})

// Resolve base URL at request time so settings changes apply immediately
axiosInstance.interceptors.request.use((config) => {
  const base = useSettingsStore.getState().apiBaseUrl
  if (base && config.url && !config.url.startsWith('http')) {
    config.baseURL = base
  }

  const token = useAuthStore.getState().token
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`
  }
  return config
})

axiosInstance.interceptors.response.use(
  (res) => res,
  (err: AxiosError) => {
    if (err.response?.status === 401) {
      useAuthStore.getState().logout()
      window.location.href = '/login'
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
  const { data } = await axiosInstance.get<PaginatedDocsResponse>('/documents/paginated', {
    params: {
      page: params.page ?? 1,
      page_size: params.pageSize ?? 20,
      status_filter: params.statusFilter ?? null,
      sort_field: params.sortField ?? 'created_at',
      sort_direction: params.sortDirection ?? 'desc',
    },
  })
  return data
}

export async function uploadDocuments(files: File[]): Promise<DocActionResponse> {
  const form = new FormData()
  files.forEach((f) => form.append('files', f))
  const { data } = await axiosInstance.post<DocActionResponse>('/documents/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
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
    { params: { doc_id: docId } }
  )
  return data
}

export async function clearCache(): Promise<{ status: string; message: string }> {
  const { data } = await axiosInstance.delete('/documents/clear_cache')
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
    },
    body: JSON.stringify(req),
    signal,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Query failed: ${res.status} ${text}`)
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
