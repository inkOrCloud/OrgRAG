// ============================================================
// Type Definitions
// ============================================================

export type DocStatus = 'pending' | 'processing' | 'preprocessed' | 'processed' | 'failed'

export type QueryMode = 'naive' | 'local' | 'global' | 'hybrid' | 'mix' | 'bypass'

export interface DocStatusResponse {
  id: string
  content_summary: string
  content_length: number
  status: DocStatus
  created_at: string
  updated_at: string
  track_id?: string
  chunks_count?: number
  error_msg?: string
  metadata?: Record<string, unknown>
  file_path: string
}

export interface PaginationInfo {
  page: number
  page_size: number
  total_count: number
  total_pages: number
  has_next: boolean
  has_prev: boolean
}

export interface PaginatedDocsResponse {
  documents: DocStatusResponse[]
  pagination: PaginationInfo
  status_counts: Record<string, number>
}

export interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
  references?: ReferenceItem[]
  timestamp: number
}

export interface ReferenceItem {
  reference_id: string
  file_path: string
  content?: string[]
}

export interface QueryRequest {
  query: string
  mode: QueryMode
  stream?: boolean
  top_k?: number
  chunk_top_k?: number
  max_entity_tokens?: number
  max_relation_tokens?: number
  max_total_tokens?: number
  response_type?: string
  conversation_history?: Message[]
  history_turns?: number
  user_prompt?: string
  enable_rerank?: boolean
  only_need_context?: boolean
}

export interface QueryResponse {
  response: string
  references?: ReferenceItem[]
}

export interface HealthStatus {
  status: 'healthy'
  working_directory: string
  input_directory: string
  configuration: {
    llm_binding: string
    llm_binding_host: string
    llm_model: string
    embedding_binding: string
    embedding_binding_host: string
    embedding_model: string
    kv_storage: string
    doc_status_storage: string
    graph_storage: string
    vector_storage: string
    workspace?: string
    enable_rerank?: boolean
    rerank_binding?: string | null
    rerank_model?: string | null
    summary_language: string
    max_parallel_insert: number
  }
  core_version?: string
  api_version?: string
  auth_mode?: 'enabled' | 'disabled'
  pipeline_busy: boolean
  webui_title?: string
  webui_description?: string
}

export interface AuthStatusResponse {
  auth_configured: boolean
  access_token?: string
  token_type?: string
  auth_mode?: 'enabled' | 'disabled'
  message?: string
  core_version?: string
  api_version?: string
  webui_title?: string
  webui_description?: string
}

export interface LoginResponse {
  access_token: string
  token_type: string
  auth_mode?: 'enabled' | 'disabled'
  role?: UserRole
  message?: string
  core_version?: string
  api_version?: string
  webui_title?: string
  webui_description?: string
}

export interface DocActionResponse {
  status: 'success' | 'partial_success' | 'failure' | 'duplicated'
  message: string
  track_id?: string
}

export interface GraphNode {
  id: string
  labels: string[]
  properties: Record<string, unknown>
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  type: string
  properties: Record<string, unknown>
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface PipelineStatusResponse {
  autoscanned: boolean
  busy: boolean
  job_name: string
  job_start?: string
  docs: number
  batchs: number
  cur_batch: number
  request_pending: boolean
  cancellation_requested?: boolean
  latest_message: string
  history_messages?: string[]
}

// ── User Management ──────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'user' | 'guest'

export interface User {
  id: string
  username: string
  email: string
  role: UserRole
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface UserCreateRequest {
  username: string
  password: string
  email?: string
  role: 'admin' | 'user'
}

export interface UserUpdateRequest {
  email?: string
  role?: 'admin' | 'user'
  is_active?: boolean
}

export interface ChangePasswordRequest {
  current_password: string
  new_password: string
}

export interface UsersListResponse {
  users: User[]
  total: number
}

export interface UserResponse {
  user: User
  message?: string
}

// ── Knowledge Base ───────────────────────────────────────────────────────────

export interface KnowledgeBase {
  id: string
  name: string
  workspace: string
  description: string
  owner_username: string
  is_active: boolean
  is_default: boolean
  loaded: boolean
  created_at: string
  updated_at: string
  org_id: string | null       // Phase B: owning organization
  can_write: boolean          // Phase C: current user has write access
}

export interface KBCreateRequest {
  name: string
  description?: string
  org_id?: string | null      // Phase B: owning organization
}

export interface KBUpdateRequest {
  name?: string
  description?: string
  is_active?: boolean
}

export interface KBListResponse {
  kbs: KnowledgeBase[]
  total: number
}

export interface KBResponse {
  kb: KnowledgeBase
  message?: string
}

// Phase 3 types
export interface KBDocCounts {
  processed?: number
  pending?: number
  failed?: number
  processing?: number
  [key: string]: number | undefined
}

export interface KBStats {
  kb_id: string
  doc_counts: KBDocCounts
  node_count: number
  edge_count: number
  chunk_count: number
}

export interface KBSettings {
  mode?: string
  top_k?: number
  chunk_top_k?: number
  max_entity_tokens?: number
  max_relation_tokens?: number
  max_total_tokens?: number
  enable_rerank?: boolean
  response_type?: string
}

export interface KBSettingsResponse {
  kb_id: string
  settings: KBSettings
  message?: string
}


// ── KB Operation Permission types (Phase C) ──────────────────────────────────

export type KBPermissionType = 'read' | 'write'

/** Map of username → list of granted permissions, e.g. {"alice": ["read","write"]} */
export type OrgKBPermissionsMap = Record<string, KBPermissionType[]>

export interface OrgKBPermissionsResponse {
  permissions: OrgKBPermissionsMap
}

export interface KBPermissionRequest {
  username: string
  permission: KBPermissionType
}

// ── Organization types (Phase A) ─────────────────────────────────────────────

export type OrgRole = 'admin' | 'member'

export interface Organization {
  id: string
  name: string
  parent_id: string | null
  description: string
  member_count: number
  created_at: string
  updated_at: string
  children: Organization[]
}

export interface OrgMember {
  id: string
  org_id: string
  username: string
  role: OrgRole
  joined_at: string
}

export interface OrgCreateRequest {
  name: string
  parent_id?: string | null
  description?: string
}

export interface OrgUpdateRequest {
  name?: string
  description?: string
}

export interface OrgMemberAddRequest {
  username: string
  role: OrgRole
}

export interface OrgMemberRoleRequest {
  role: OrgRole
}

export interface OrgTreeResponse {
  orgs: Organization[]
  total: number
}

export interface OrgDetailResponse {
  org: Organization
  members: OrgMember[]
}

export interface OrgMembersResponse {
  members: OrgMember[]
  total: number
}

export interface MyOrgResponse {
  membership: OrgMember | null
  org: Organization | null
}

// ── Chat Sessions ─────────────────────────────────────────────────────────────

export interface ChatSession {
  id: string
  kbId: string | null
  messages: ChatMessage[]
  preview: string
  mode: QueryMode
  timestamp: number
}

export interface SaveSessionRequest {
  kb_id: string | null
  messages: ChatMessage[]
  preview: string
  mode: QueryMode
  timestamp: number
}

export interface ChatSessionsResponse {
  sessions: ChatSession[]
  total: number
}
