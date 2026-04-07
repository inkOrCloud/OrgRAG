# LightRAG API Server

The LightRAG API server is a FastAPI application that exposes all LightRAG capabilities via REST API and includes a built-in WebUI. It extends the core LightRAG engine with multi-knowledge-base management, a user/organization system, JWT authentication, and persistent chat sessions.

- **Swagger UI**: http://localhost:9621/docs
- **ReDoc**: http://localhost:9621/redoc
- **WebUI**: http://localhost:9621/webui

---

## Table of Contents

- [Installation](#installation)
- [Configuration](#configuration)
  - [MinerU Document Parsing](#mineru-document-parsing)
- [Starting the Server](#starting-the-server)
- [Authentication](#authentication)
- [Multi-Knowledge-Base](#multi-knowledge-base)
- [API Reference](#api-reference)
  - [System](#system-endpoints)
  - [Query](#query-endpoints)
  - [Documents](#document-endpoints)
  - [Knowledge Graph](#knowledge-graph-endpoints)
  - [Knowledge Bases](#knowledge-base-management-endpoints)
  - [Chat Sessions](#chat-session-endpoints)
  - [Users](#user-management-endpoints)
  - [Organizations](#organization-management-endpoints)
  - [Ollama Emulation](#ollama-emulation-endpoints)
- [Environment Variables](#environment-variables)
- [Deployment](#deployment)

---

## Installation

```bash
# From PyPI
pip install "lightrag-hku[api]"

# From source
git clone https://github.com/HKUDS/LightRAG.git
cd LightRAG
uv sync --extra api
source .venv/bin/activate

# Build WebUI (optional)
cd lightrag_webui && bun install --frozen-lockfile && bun run build && cd ..
```

---

## Configuration

Copy `env.example` to `.env` in the working directory and edit it:

```bash
cp env.example .env
```

### Minimal OpenAI configuration

```env
LLM_BINDING=openai
LLM_MODEL=gpt-4o-mini
LLM_BINDING_HOST=https://api.openai.com/v1
LLM_BINDING_API_KEY=sk-...

EMBEDDING_BINDING=openai
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIM=1536
EMBEDDING_BINDING_HOST=https://api.openai.com/v1
EMBEDDING_BINDING_API_KEY=sk-...
```

### Minimal Ollama configuration

```env
LLM_BINDING=ollama
LLM_MODEL=qwen2.5:32b
LLM_BINDING_HOST=http://localhost:11434
OLLAMA_LLM_NUM_CTX=32768

EMBEDDING_BINDING=ollama
EMBEDDING_MODEL=bge-m3:latest
EMBEDDING_DIM=1024
EMBEDDING_BINDING_HOST=http://localhost:11434
```

### MinerU Document Parsing

[MinerU](https://github.com/opendatalab/MinerU) is a high-accuracy document parsing service that converts PDF and image files into Markdown using layout analysis, OCR, and optional VLM backends. When enabled, MinerU takes priority over Docling/DEFAULT for PDF, DOCX, PPTX, XLSX, and all image formats.

> **Note**: Image files (`.png` `.jpg` `.jpeg` `.bmp` `.tiff` `.gif` `.webp`) are **only** supported through MinerU; other engines cannot parse raw image files.

**Quick start:**

1. Deploy the MinerU WebAPI service — see [MinerU documentation](https://github.com/opendatalab/MinerU)
2. Add the following to your `.env`:

```env
MINERU_ENABLED=true
MINERU_BASE_URL=http://<your-mineru-host>:28080
```

3. Restart `lightrag-server`

**Call modes** (`MINERU_MODE`):

| Mode | Description |
|------|-------------|
| `sync` | `POST /file_parse` — single request, blocks until done. Simple and reliable for files < ~50 MB. |
| `async` | `POST /tasks` + polling `GET /tasks/{id}` — better for large files or slow networks. |

**Parsing backends** (`MINERU_BACKEND`):

| Value | Description |
|-------|-------------|
| `pipeline` | General-purpose, multi-language, hallucination-free |
| `vlm-auto-engine` | High accuracy via local GPU (Chinese + English only) |
| `vlm-http-client` | High accuracy via remote VLM server (Chinese + English only) |
| `hybrid-auto-engine` | Next-gen high accuracy via local GPU, multi-language **(default)** |
| `hybrid-http-client` | High accuracy via remote VLM + local layout, multi-language |

---

## Starting the Server

```bash
# Single-process (Uvicorn) — development / moderate load
lightrag-server

# Multi-process (Gunicorn + Uvicorn) — production
lightrag-gunicorn --workers 4

# Multiple isolated instances
lightrag-server --port 9621 --workspace project_a
lightrag-server --port 9622 --workspace project_b
```

Command-line options:

| Option | Default | Description |
|--------|---------|-------------|
| `--host` | `0.0.0.0` | Listen address |
| `--port` | `9621` | Listen port |
| `--working-dir` | `./rag_storage` | RAG data directory |
| `--input-dir` | `./inputs` | Scanned file directory |
| `--workspace` | *(empty)* | Namespace for data isolation |
| `--log-level` | `INFO` | DEBUG / INFO / WARNING / ERROR |
| `--key` | *(none)* | Static API key |
| `--ssl` | false | Enable HTTPS |
| `--llm-binding` | `ollama` | LLM provider |
| `--embedding-binding` | `ollama` | Embedding provider |

---

## Authentication

The server supports two complementary authentication methods that can be used simultaneously.

### 1. API Key

Set `LIGHTRAG_API_KEY` in `.env`. Pass via `X-API-Key` header:

```bash
curl http://localhost:9621/documents/scan \
  -H "X-API-Key: your-secret-key"
```

Paths that bypass API key check (configurable via `WHITELIST_PATHS`):

```env
WHITELIST_PATHS=/health,/api/*
```

### 2. JWT Bearer Token

User accounts are managed in the local SQLite database (`lightrag_users.db`).
Configure the JWT signing secret:

```env
TOKEN_SECRET=your-jwt-signing-secret
TOKEN_EXPIRE_HOURS=24
```

**Reset a user password** from the command line:

```bash
lightrag-server reset-password <username> --password <new-password>
# Or prompt securely (password not echoed):
lightrag-server reset-password <username>
# Non-default working directory:
lightrag-server reset-password <username> --working-dir /data/rag_storage
```

**Login** (`POST /login`) to get a JWT:

```bash
curl -X POST http://localhost:9621/login \
  -d "username=admin&password=secret"
```

Response:

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer",
  "auth_mode": "enabled",
  "role": "admin"
}
```

Use the token in subsequent requests:

```bash
curl http://localhost:9621/query \
  -H "Authorization: Bearer eyJhbGci..." \
  -H "Content-Type: application/json" \
  -d '{"query": "What is LightRAG?", "mode": "hybrid"}'
```

### User Roles

| Role | Description |
|------|-------------|
| `admin` | Full access: user/org/KB management, all operations |
| `user` | Access to assigned KBs, own chat sessions |
| `guest` | Automatic role when auth is disabled (no-auth mode) |

---

## Multi-Knowledge-Base

Each knowledge base (KB) is an independent LightRAG instance with isolated graph, vectors, and documents.

### KB Routing

Send requests to a specific KB by including the `X-KB-ID` header:

```bash
curl http://localhost:9621/query \
  -H "X-KB-ID: 550e8400-e29b-41d4-a716-446655440000" \
  -H "Authorization: Bearer ..." \
  -d '{"query": "...", "mode": "hybrid"}'
```

When `X-KB-ID` is absent or invalid, the request is routed to the **default KB**.

### KB Permissions

KB access is managed through the organization hierarchy:

- **admin** role → access to all KBs
- **org-admin** → write access to KBs in their org subtree
- **kb_write grant** → write access to specific KBs
- **kb_read grant** → read-only access to specific KBs

---

## API Reference

All endpoints requiring authentication accept either `X-API-Key` header or `Authorization: Bearer <token>` header.

---

### System Endpoints

#### `GET /`
Redirect to WebUI (or `/docs` if WebUI is not built).

---

#### `GET /health`
Returns comprehensive system status.

**Auth**: Required

**Response**:
```json
{
  "status": "healthy",
  "core_version": "1.4.11",
  "api_version": "...",
  "webui_available": true,
  "llm_binding": "openai",
  "embedding_binding": "openai",
  "kv_storage": "JsonKVStorage",
  "vector_storage": "NanoVectorDBStorage",
  "graph_storage": "NetworkXStorage"
}
```

---

#### `GET /auth-status`
Returns whether authentication is enabled and the server version info.

**Auth**: Not required

**Response**:
```json
{
  "auth_enabled": true,
  "core_version": "1.4.11",
  "api_version": "...",
  "webui_title": "LightRAG"
}
```

---

#### `POST /login`
Authenticate and receive a JWT token.

**Auth**: Not required

**Request**: `application/x-www-form-urlencoded`
- `username` (string, required)
- `password` (string, required)

**Response**:
```json
{
  "access_token": "eyJ...",
  "token_type": "bearer",
  "auth_mode": "enabled",
  "role": "admin",
  "core_version": "1.4.11",
  "api_version": "..."
}
```

---

#### `GET /setup/status`
Check whether the initial one-time setup has been completed.

**Auth**: Not required (always public)

**Response**:
```json
{"setup_required": true}
```

---

#### `POST /setup`
Complete the initial system setup (admin user + root organization + default KB).
Only operational when `setup_required` is `true`; returns `409` afterwards.

**Auth**: Not required

**Request**:
```json
{
  "admin_username": "admin",
  "admin_password": "secure-password",
  "org_name": "My Organization",
  "kb_name": "Default Knowledge Base"
}
```

**Response**: `201 Created`

---

### Query Endpoints

All query endpoints accept the same `QueryRequest` body.

#### `QueryRequest` Schema

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `query` | string | required | Query text (min 3 chars) |
| `mode` | enum | `"mix"` | `local` / `global` / `hybrid` / `naive` / `mix` / `bypass` |
| `top_k` | int | server default (60) | KG entities/relations to retrieve |
| `chunk_top_k` | int | server default (20) | Text chunks to retrieve |
| `max_entity_tokens` | int | — | Token budget for entity context |
| `max_relation_tokens` | int | — | Token budget for relation context |
| `max_total_tokens` | int | — | Total context token budget |
| `enable_rerank` | bool | `true` | Enable chunk reranking |
| `include_references` | bool | `true` | Include source citations in response |
| `include_chunk_content` | bool | `false` | Include chunk text in references |
| `stream` | bool | `true` | Enable streaming (only for `/query/stream`) |
| `only_need_context` | bool | — | Return only retrieved context, skip LLM |
| `only_need_prompt` | bool | — | Return only the generated prompt |
| `response_type` | string | — | Response format hint (e.g. `"Bullet Points"`) |
| `user_prompt` | string | — | Additional instruction appended to LLM prompt |
| `conversation_history` | array | — | Prior messages `[{"role":"user","content":"..."}]` |
| `hl_keywords` | string[] | `[]` | High-level keywords to prioritize |
| `ll_keywords` | string[] | `[]` | Low-level keywords to refine focus |

---

#### `POST /query`
Non-streaming RAG query.

**Auth**: Required  
**KB routing**: `X-KB-ID` header (optional)

**Request**: `QueryRequest` (the `stream` field is ignored)

**Response** (`QueryResponse`):
```json
{
  "response": "LightRAG is a graph-based RAG framework...",
  "references": [
    {
      "reference_id": "1",
      "file_path": "docs/intro.md",
      "content": ["chunk text..."]
    }
  ]
}
```

`references` is `null` when `include_references=false`.  
`content` array is present only when `include_chunk_content=true`.

---

#### `POST /query/stream`
Streaming RAG query (NDJSON / Server-Sent Events).

**Auth**: Required  
**KB routing**: `X-KB-ID` header (optional)

**Request**: `QueryRequest`

**When `stream=true`** — returns newline-delimited JSON chunks:
```jsonl
{"references": [{"reference_id": "1", "file_path": "doc.md"}]}
{"response": "LightRAG "}
{"response": "is a "}
{"response": "graph-based RAG framework..."}
```

**When `stream=false`** — returns a single NDJSON line with complete response.

---

#### `POST /query/data`
Returns the raw retrieved context (entities, relations, chunks) without LLM generation. Always includes references.

**Auth**: Required  
**KB routing**: `X-KB-ID` header (optional)

**Response** (`QueryDataResponse`):
```json
{
  "status": "success",
  "message": "Query completed",
  "data": {
    "entities": [...],
    "relationships": [...],
    "chunks": [...]
  },
  "metadata": {
    "mode": "hybrid",
    "hl_keywords": ["LightRAG"],
    "ll_keywords": ["graph", "RAG"]
  }
}
```

---

### Document Endpoints

All document endpoints use the `X-KB-ID` header for KB routing.

#### `POST /documents/scan`
Scan the input directory for new files and start indexing.

**Auth**: Required

**Response**:
```json
{"status": "ok", "message": "Scanning started"}
```

---

#### `POST /documents/upload`
Upload one or more files for indexing.

**Auth**: Required  
**Content-Type**: `multipart/form-data`

**Form fields**:
- `files` — one or more files (up to `MAX_UPLOAD_SIZE`, default 100MB each)

**Response** (`InsertResponse`):
```json
{
  "status": "ok",
  "message": "Files queued for processing",
  "track_id": "insert-20250326-abc123"
}
```

Supported formats: TXT, MD, MDX, PDF, DOCX, PPTX, XLSX, RTF, ODT, EPUB, HTML, JSON, XML, CSV, and source code files (Python, JavaScript, etc.)

---

#### `POST /documents/text`
Insert a single text document.

**Auth**: Required

**Request**:
```json
{
  "text": "Your document content...",
  "description": "Optional label for this document"
}
```

**Response**:
```json
{"status": "ok", "track_id": "insert-20250326-xyz789"}
```

---

#### `POST /documents/texts`
Insert multiple text documents in one request.

**Auth**: Required

**Request**:
```json
{
  "texts": ["Document 1...", "Document 2..."],
  "descriptions": ["Label 1", "Label 2"]
}
```

**Response**:
```json
{"status": "ok", "track_id": "insert-20250326-abc456"}
```

---

#### `GET /documents`
List all documents with status summary.

**Auth**: Required

**Response**:
```json
{
  "documents": [
    {
      "id": "doc-abc123",
      "file_path": "report.pdf",
      "content_summary": "First 100 chars...",
      "status": "processed",
      "chunks_count": 42,
      "created_at": "2025-03-26T10:00:00Z"
    }
  ],
  "total": 1
}
```

---

#### `POST /documents/paginated`
Paginated document list with filtering.

**Auth**: Required

**Request**:
```json
{
  "page": 1,
  "page_size": 20,
  "status_filter": "processed"
}
```

Status values: `pending`, `processing`, `processed`, `failed`, `all`

---

#### `GET /documents/status_counts`
Count documents by status.

**Auth**: Required

**Response**:
```json
{"all": 100, "processed": 85, "processing": 5, "pending": 3, "failed": 7}
```

---

#### `GET /documents/pipeline_status`
Get the current processing pipeline status and queue depth.

**Auth**: Required

**Response**:
```json
{
  "status": "running",
  "queue_depth": 3,
  "current_file": "large_report.pdf",
  "progress_percent": 65
}
```

---

#### `GET /documents/track_status/{track_id}`
Poll the processing status of a specific insert operation.

**Auth**: Required

**Response**:
```json
{
  "track_id": "insert-20250326-abc123",
  "documents": [
    {
      "id": "doc-xyz",
      "status": "processed",
      "file_path": "report.pdf",
      "error_msg": null
    }
  ]
}
```

---

#### `DELETE /documents`
Clear all documents from the current KB.

**Auth**: Required

**Query params**:
- `delete_files` (bool, default `false`) — also delete source files from disk

---

#### `DELETE /documents/delete_document`
Delete one or more specific documents and their associated data.

**Auth**: Required

**Request body**:
```json
{"doc_ids": ["doc-abc123", "doc-def456"], "delete_file": false, "delete_llm_cache": false}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `doc_ids` | string[] | required | List of document IDs to delete |
| `delete_file` | bool | `false` | Also delete source files from disk |
| `delete_llm_cache` | bool | `false` | Also delete cached LLM extraction results |

---

#### `DELETE /documents/delete_entity`
Delete a named entity from the knowledge graph.

**Auth**: Required

**Request body**:
```json
{"entity_name": "LightRAG"}
```

---

#### `DELETE /documents/delete_relation`
Delete a specific relation from the knowledge graph.

**Auth**: Required

**Request body**:
```json
{"source_entity": "EntityA", "target_entity": "EntityB"}
```

---

#### `POST /documents/clear_cache`
Clear the LLM response cache.

**Auth**: Required

**Request body**:
```json
{"mode": "all"}
```

Mode values: `all`, `extract`, `query`

---

#### `POST /documents/reprocess_failed`
Re-queue all documents with `failed` status for reprocessing.

**Auth**: Required

---

#### `POST /documents/cancel_pipeline`
Cancel the currently running indexing pipeline.

**Auth**: Required

---

#### `GET /documents/{doc_id}/content`
Return the full text content of a document stored in the KV store.

**Auth**: Required

**Path params**: `doc_id` — document ID

**Response**:
```json
{
  "id": "doc-abc123",
  "file_path": "report.pdf",
  "content": "Full markdown content...",
  "content_length": 4096
}
```

---

### Knowledge Graph Endpoints

#### `GET /graphs`
Retrieve a subgraph for visualization.

**Auth**: Required  
**KB routing**: `X-KB-ID` header

**Query params**:
- `label` (string, required) — entity label/name to center the subgraph on
- `max_depth` (int, default 3) — traversal depth
- `max_nodes` (int, default 1000) — maximum nodes to return

**Response**:
```json
{
  "nodes": [{"id": "LightRAG", "type": "CONCEPT", "description": "..."}],
  "edges": [{"src": "LightRAG", "tgt": "RAG", "description": "..."}]
}
```

---

#### `GET /graph/label/list`
List all entity labels (names) in the graph.

**Auth**: Required

---

#### `GET /graph/label/popular`
Return the most frequently connected entity labels.

**Auth**: Required
**Query params**: `limit` (int, default 300, max 1000)

---

#### `GET /graph/label/search`
Search entity labels by keyword.

**Auth**: Required
**Query params**: `q` (string, required), `limit` (int, default 50, max 100)

---

#### `GET /graph/entity/exists`
Check if an entity exists by name.

**Auth**: Required  
**Query params**: `entity_name` (string)

---

#### `POST /graph/entity/create`
Create a new entity node.

**Auth**: Required

**Request body** (`EntityCreateRequest`):
```json
{
  "entity_name": "Tesla",
  "entity_data": {
    "description": "Electric vehicle manufacturer",
    "entity_type": "ORGANIZATION",
    "source_id": "manual-insert"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `entity_name` | string | Unique name for the new entity |
| `entity_data` | object | Entity properties (`description`, `entity_type`, `source_id`, etc.) |

---

#### `POST /graph/entity/edit`
Update an existing entity's attributes.

**Auth**: Required

**Request body** (`EntityUpdateRequest`):
```json
{
  "entity_name": "ExistingEntity",
  "updated_data": {
    "description": "Updated description",
    "entity_type": "ORGANIZATION"
  },
  "allow_rename": false,
  "allow_merge": false
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `entity_name` | string | required | Name of the entity to update |
| `updated_data` | object | required | Properties to update |
| `allow_rename` | bool | `false` | Allow renaming the entity |
| `allow_merge` | bool | `false` | Allow merging with an existing entity if rename conflicts |

---

#### `POST /graph/entities/merge`
Merge multiple entity nodes into one, preserving all relationships.

**Auth**: Required

**Request body** (`EntityMergeRequest`):
```json
{
  "entities_to_change": ["Elon Msk", "Ellon Musk"],
  "entity_to_change_into": "Elon Musk"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `entities_to_change` | string[] | Entities to be merged and removed (duplicates/typos) |
| `entity_to_change_into` | string | Target entity that receives all relationships |

---

#### `POST /graph/relation/create`
Create a new relation (edge) between two entities.

**Auth**: Required

**Request body** (`RelationCreateRequest`):
```json
{
  "source_entity": "Elon Musk",
  "target_entity": "Tesla",
  "relation_data": {
    "description": "Elon Musk is the CEO of Tesla",
    "keywords": "CEO, founder",
    "weight": 1.0
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `source_entity` | string | Name of the source entity (must exist) |
| `target_entity` | string | Name of the target entity (must exist) |
| `relation_data` | object | Relation properties (`description`, `keywords`, `weight`, etc.) |

---

#### `POST /graph/relation/edit`
Update an existing relation's attributes.

**Auth**: Required

**Request body** (`RelationUpdateRequest`):
```json
{
  "source_id": "EntityA",
  "target_id": "EntityB",
  "updated_data": {
    "description": "Updated description",
    "weight": 2.0
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `source_id` | string | Name of the source entity |
| `target_id` | string | Name of the target entity |
| `updated_data` | object | Properties to update |

---

### Knowledge Base Management Endpoints

#### `GET /kbs`
List knowledge bases visible to the current user.

**Auth**: Required

**Response**:
```json
{
  "kbs": [
    {
      "id": "550e8400-...",
      "name": "Product Docs",
      "description": "...",
      "is_default": false,
      "loaded": true,
      "can_write": true,
      "created_at": "2025-03-01T00:00:00Z"
    }
  ],
  "total": 3
}
```

---

#### `POST /kbs`
Create a new knowledge base.

**Auth**: Required (admin or org-admin)

**Request**:
```json
{
  "name": "Product Documentation",
  "description": "KB for product docs",
  "org_id": "org-uuid-optional"
}
```

**Response**: `201 Created` with KB object.

---

#### `GET /kbs/{kb_id}`
Get knowledge base details.

**Auth**: Required

---

#### `PUT /kbs/{kb_id}`
Update knowledge base name or description.

**Auth**: Required (admin or KB write permission)

**Request**:
```json
{"name": "New Name", "description": "...", "is_active": true}
```

---

#### `DELETE /kbs/{kb_id}`
Delete a knowledge base and all its data.

**Auth**: Required (admin only)

---

#### `GET /kbs/{kb_id}/stats`
Get KB document and storage statistics.

**Auth**: Required

**Response**:
```json
{
  "document_count": 42,
  "entity_count": 1840,
  "relation_count": 3200,
  "chunk_count": 580
}
```

---

#### `GET /kbs/{kb_id}/settings`
Get per-KB query settings.

**Auth**: Required

---

#### `PUT /kbs/{kb_id}/settings`
Update per-KB query settings (admin).

**Auth**: Required (admin)

**Request** — any subset of `QueryRequest` parameters used as KB-level defaults.

---

#### `GET /kbs/{kb_id}/export`
Export KB data as a ZIP archive.

**Auth**: Required (admin)

**Response**: `application/zip` file download.

---

#### `POST /kbs/import`
Import a KB from a previously exported ZIP archive.

**Auth**: Required (admin)

**Content-Type**: `multipart/form-data`  
**Form fields**: `file` (ZIP archive)

**Response**: `201 Created` with new KB object.

---

### Chat Session Endpoints

Chat sessions persist conversation history per user per KB.

#### `GET /chat/sessions`
List the current user's chat sessions.

**Auth**: Required

**Query params**:
- `kb_id` (string, optional) — filter by knowledge base

**Response**:
```json
{
  "sessions": [
    {
      "session_id": "sess-abc",
      "kb_id": "kb-uuid",
      "title": "My Conversation",
      "messages": [...],
      "updated_at": "2025-03-26T..."
    }
  ]
}
```

---

#### `PUT /chat/sessions/{session_id}`
Create or update a chat session (upsert).

**Auth**: Required

**Request**:
```json
{
  "kb_id": "kb-uuid",
  "title": "Product FAQ",
  "messages": [
    {"role": "user", "content": "What is LightRAG?"},
    {"role": "assistant", "content": "LightRAG is..."}
  ]
}
```

---

#### `DELETE /chat/sessions/{session_id}`
Delete a specific chat session.

**Auth**: Required

---

#### `DELETE /chat/sessions`
Clear all chat sessions for the current user (optionally filtered by KB).

**Auth**: Required

**Request body** (optional):
```json
{"kb_id": "kb-uuid"}
```

---

### User Management Endpoints

All user management endpoints require `admin` role.

#### `GET /users`
List all users.

**Response**:
```json
{"users": [{"username": "alice", "role": "user", "email": "...", "is_active": true}], "total": 5}
```

---

#### `POST /users`
Create a new user.

**Request**:
```json
{"username": "bob", "password": "secure123", "email": "bob@example.com", "role": "user"}
```

**Response**: `201 Created`

---

#### `GET /users/me`
Get the current authenticated user's profile.

**Auth**: Any authenticated user

---

#### `PUT /users/me/password`
Change the current user's own password.

**Auth**: Any authenticated user

**Request**:
```json
{"current_password": "old", "new_password": "new-secure-password"}
```

---

#### `POST /users/me/avatar`
Upload or replace the current user's avatar image.

**Auth**: Any authenticated user
**Content-Type**: `multipart/form-data`

**Form fields**: `file` — image file (JPEG, PNG, GIF, WebP, SVG)

**Response**:
```json
{"avatar_url": "/avatars/alice.jpg", "message": "Avatar uploaded successfully"}
```

---

#### `DELETE /users/me/avatar`
Remove the current user's avatar.

**Auth**: Any authenticated user

**Response**:
```json
{"message": "Avatar removed successfully"}
```

---

#### `GET /users/{user_id}`
Get a user by ID (admin only).

---

#### `PUT /users/{user_id}`
Update a user's profile or role (admin only).

**Request**:
```json
{"email": "new@example.com", "role": "admin", "is_active": true}
```

---

#### `DELETE /users/{user_id}`
Delete a user (admin only).

---

### Organization Management Endpoints

Organizations form a tree hierarchy. KB access is granted through org membership.

#### `GET /orgs`
Get the full organization tree.

**Auth**: Required

---

#### `GET /orgs/my`
Get the current user's organization membership.

**Auth**: Required

---

#### `POST /orgs`
Create an organization (optionally nested under a parent).

**Auth**: Required (admin)

**Request**:
```json
{"name": "Engineering", "parent_id": "parent-org-uuid", "description": "..."}
```

**Response**: `201 Created`

---

#### `GET /orgs/{org_id}`
Get organization details.

---

#### `PUT /orgs/{org_id}`
Update organization name or description.

**Request**:
```json
{"name": "New Name", "description": "Updated"}
```

---

#### `DELETE /orgs/{org_id}`
Delete an organization.

**Auth**: Required (admin)

---

#### `GET /orgs/{org_id}/members`
List organization members.

---

#### `POST /orgs/{org_id}/members`
Add a user to the organization.

**Auth**: Required (admin or org-admin)

**Request**:
```json
{"username": "alice", "role": "member"}
```

Role values: `admin` (org-admin), `member`

**Response**: `201 Created`

---

#### `PUT /orgs/{org_id}/members/{username}`
Update a member's role.

**Request**:
```json
{"role": "admin"}
```

---

#### `DELETE /orgs/{org_id}/members/{username}`
Remove a member from the organization.

---

#### `GET /orgs/{org_id}/kb-permissions`
List explicit KB operation permissions for org members.

---

#### `POST /orgs/{org_id}/kb-permissions`
Grant a KB permission to an org member.

**Auth**: Required (admin or org-admin)

**Request** (`KBPermissionRequest`):
```json
{"username": "alice", "permission": "write"}
```

| Field | Type | Description |
|-------|------|-------------|
| `username` | string | Username of the org member |
| `permission` | string | `"read"` or `"write"` |

**Response**: `201 Created`

---

#### `DELETE /orgs/{org_id}/kb-permissions/{username}/{permission}`
Revoke a KB permission.

**Path params**: `username`, `permission` (`"read"` or `"write"`)

---

### Ollama Emulation Endpoints

These endpoints emulate the Ollama API, enabling AI frontends (e.g. Open WebUI) to connect to LightRAG as if it were a local Ollama model.

#### `GET /api/version`
Returns the Ollama API version string.

---

#### `GET /api/tags`
Returns available models list. Reports `lightrag:latest` as the available model.

---

#### `GET /api/ps`
Returns currently loaded models (Ollama `ps` equivalent).

---

#### `POST /api/generate`
Ollama generate completion — forwards to the underlying LLM (bypasses RAG).

**Request** (Ollama format):
```json
{"model": "lightrag:latest", "prompt": "Hello world", "stream": false}
```

---

#### `POST /api/chat`
Ollama chat completion — routes through LightRAG query engine.

**Request** (Ollama format):
```json
{
  "model": "lightrag:latest",
  "messages": [{"role": "user", "content": "/mix What is LightRAG?"}],
  "stream": true
}
```

**Query mode prefixes** in message content:

| Prefix | Mode |
|--------|------|
| `/local` | local |
| `/global` | global |
| `/hybrid` | hybrid |
| `/naive` | naive |
| `/mix` | mix |
| `/bypass` | Direct LLM, skip RAG |
| `/context` | Return context only |
| `/[custom prompt]` | Append user prompt |
| *(no prefix)* | hybrid (default) |

---

## Environment Variables

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST` | `0.0.0.0` | Server bind address |
| `PORT` | `9621` | Server port |
| `WORKERS` | `2` | Gunicorn worker processes |
| `WORKING_DIR` | `./rag_storage` | RAG data persistence directory |
| `INPUT_DIR` | `./inputs` | Directory scanned for new files |
| `WORKSPACE` | *(empty)* | Data isolation namespace |
| `MAX_UPLOAD_SIZE` | `104857600` | Max file upload size (bytes, default 100MB) |
| `LOG_LEVEL` | `INFO` | Logging level |

### LLM

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_BINDING` | `ollama` | `openai` / `ollama` / `azure_openai` / `gemini` / `aws_bedrock` / `lollms` |
| `LLM_MODEL` | — | Model name or deployment name |
| `LLM_BINDING_HOST` | — | API base URL |
| `LLM_BINDING_API_KEY` | — | API key |
| `MAX_ASYNC` | `4` | Max concurrent LLM requests |
| `TIMEOUT` | `150` | Request timeout in seconds |
| `OLLAMA_LLM_NUM_CTX` | `8192` | Ollama context window (set ≥32768 for LightRAG) |
| `OPENAI_LLM_MAX_TOKENS` | — | Max output tokens (prevents runaway generation) |

### Embedding

| Variable | Default | Description |
|----------|---------|-------------|
| `EMBEDDING_BINDING` | `ollama` | `openai` / `ollama` / `azure_openai` / `jina` / `gemini` / `aws_bedrock` |
| `EMBEDDING_MODEL` | — | Embedding model name |
| `EMBEDDING_DIM` | — | Embedding vector dimensions |
| `EMBEDDING_BINDING_HOST` | — | Embedding API endpoint |
| `EMBEDDING_BINDING_API_KEY` | — | Embedding API key |

### Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `LIGHTRAG_API_KEY` | *(none)* | Static API key |
| `WHITELIST_PATHS` | `/health,/api/*` | Comma-separated exempt paths |
| `TOKEN_SECRET` | *(random warning)* | JWT signing secret |
| `TOKEN_EXPIRE_HOURS` | `24` | JWT token lifetime |

### Storage

| Variable | Default | Description |
|----------|---------|-------------|
| `LIGHTRAG_KV_STORAGE` | `JsonKVStorage` | KV backend class name |
| `LIGHTRAG_VECTOR_STORAGE` | `NanoVectorDBStorage` | Vector backend class name |
| `LIGHTRAG_GRAPH_STORAGE` | `NetworkXStorage` | Graph backend class name |
| `LIGHTRAG_DOC_STATUS_STORAGE` | `JsonDocStatusStorage` | DocStatus backend class name |

### Query Defaults

| Variable | Default | Description |
|----------|---------|-------------|
| `TOP_K` | `60` | Default KG retrieval count |
| `CHUNK_TOP_K` | `20` | Default chunk retrieval count |
| `MAX_TOTAL_TOKENS` | `30000` | Default context token budget |
| `HISTORY_TURNS` | `3` | Default conversation turns in context |
| `RERANK_BINDING` | *(none)* | `cohere` / `jina` / `aliyun` |
| `RERANK_MODEL` | — | Rerank model name |
| `RERANK_BINDING_HOST` | — | Rerank API endpoint |
| `RERANK_BINDING_API_KEY` | — | Rerank API key |
| `RERANK_BY_DEFAULT` | `true` | Enable reranking by default |

### Document Processing

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_PARALLEL_INSERT` | `2` | Files processed in parallel (2–10 recommended) |
| `ENABLE_LLM_CACHE_FOR_EXTRACT` | `true` | Cache entity extraction LLM calls |
| `SUMMARY_LANGUAGE` | `English` | Language for entity summaries |

### MinerU

| Variable | Default | Description |
|----------|---------|-------------|
| `MINERU_ENABLED` | `false` | Enable MinerU document parsing engine |
| `MINERU_BASE_URL` | `http://localhost:28080` | MinerU service base URL (no trailing slash) |
| `MINERU_MODE` | `sync` | Call mode: `sync` (single request) or `async` (polling, better for large files) |
| `MINERU_BACKEND` | `hybrid-auto-engine` | Parsing backend — see [MinerU Document Parsing](#mineru-document-parsing) |
| `MINERU_PARSE_METHOD` | `auto` | PDF parse method hint: `auto` / `txt` (digital PDF) / `ocr` (scanned PDF) |
| `MINERU_LANG_LIST` | `ch` | Comma-separated OCR language codes, e.g. `ch,en` |
| `MINERU_FORMULA_ENABLE` | `true` | Enable formula recognition |
| `MINERU_TABLE_ENABLE` | `true` | Enable table recognition |
| `MINERU_TIMEOUT` | `300` | Sync mode HTTP timeout in seconds (increase for large files) |
| `MINERU_ASYNC_POLL_INTERVAL` | `2.0` | Async mode: seconds between status poll requests |
| `MINERU_ASYNC_MAX_WAIT` | `600` | Async mode: maximum total wait time in seconds |
| `MINERU_FALLBACK_ON_ERROR` | `true` | Fall back to local engine (pypdf/Docling) on MinerU error |

---

## Deployment

### Docker Compose

```bash
docker compose up
```

See [docs/DockerDeployment.md](../../docs/DockerDeployment.md) for the full guide.

### Linux Systemd Service

Copy and customize `lightrag.service.example`:

```bash
sudo cp lightrag.service.example /etc/systemd/system/lightrag.service
# Edit ExecStart path
sudo systemctl daemon-reload
sudo systemctl enable --now lightrag.service
```

### Nginx Reverse Proxy

```nginx
server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 8M;

    location /documents/upload {
        client_max_body_size 100M;
        proxy_pass http://localhost:9621;
        proxy_read_timeout 300s;
    }

    location ~ ^/(query/stream|api/chat|api/generate) {
        gzip off;
        proxy_pass http://localhost:9621;
        proxy_read_timeout 300s;
    }

    location / {
        proxy_pass http://localhost:9621;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

> Set `gzip off` on streaming endpoints to ensure real-time chunk delivery.

### Offline / Air-Gap Deployment

See [docs/OfflineDeployment.md](../../docs/OfflineDeployment.md).

---

## Document Processing Pipeline

LightRAG processes documents asynchronously in two stages:

1. **Extraction** — entities and relations are extracted from text chunks in parallel, controlled by `MAX_PARALLEL_INSERT` (files) and `MAX_ASYNC` (LLM requests)
2. **Merging** — extracted entities and relations are merged into the knowledge graph; merging has higher LLM priority than extraction

**Concurrency guidelines**:
- `MAX_PARALLEL_INSERT`: 2–10 (recommended `MAX_ASYNC / 3`)
- `MAX_ASYNC`: 4–16 (depends on LLM API rate limits)

Files are atomic units: a file is marked `processed` only after all its chunks complete both stages.

**Track progress** using the `track_id` returned by upload/insert endpoints:

```bash
GET /documents/track_status/{track_id}
```

**Retry failed documents**:

```bash
POST /documents/reprocess_failed
```
