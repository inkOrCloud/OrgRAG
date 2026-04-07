# LightRAG API 服务器文档

LightRAG API 服务器是一个 FastAPI 应用，通过 REST API 暴露 LightRAG 全部能力，并内置 WebUI。它在核心 LightRAG 引擎之上，增加了多知识库管理、用户/组织体系、JWT 认证和持久化聊天会话等特性。

- **Swagger UI**：http://localhost:9621/docs
- **ReDoc**：http://localhost:9621/redoc
- **WebUI**：http://localhost:9621/webui

---

## 目录

- [安装](#安装)
- [配置](#配置)
  - [MinerU 文档解析](#mineru-文档解析)
- [启动服务器](#启动服务器)
- [认证机制](#认证机制)
- [多知识库](#多知识库)
- [API 参考](#api-参考)
  - [系统接口](#系统接口)
  - [查询接口](#查询接口)
  - [文档接口](#文档接口)
  - [知识图谱接口](#知识图谱接口)
  - [知识库管理接口](#知识库管理接口)
  - [聊天会话接口](#聊天会话接口)
  - [用户管理接口](#用户管理接口)
  - [组织管理接口](#组织管理接口)
  - [Ollama 兼容接口](#ollama-兼容接口)
- [环境变量参考](#环境变量参考)
- [部署方式](#部署方式)
- [文档处理流程](#文档处理流程)

---

## 安装

```bash
# 从 PyPI 安装
pip install "lightrag-hku[api]"

# 从源码安装
git clone https://github.com/HKUDS/LightRAG.git
cd LightRAG
uv sync --extra api
source .venv/bin/activate

# 构建 WebUI（可选）
cd lightrag_webui && bun install --frozen-lockfile && bun run build && cd ..
```

---

## 配置

将 `env.example` 复制为 `.env` 并编辑：

```bash
cp env.example .env
```

**OpenAI 最简配置**：

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

**Ollama 最简配置**：

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

### MinerU 文档解析

[MinerU](https://github.com/opendatalab/MinerU) 是一个高精度文档解析服务，通过版面分析、OCR 及可选的 VLM 后端将 PDF 和图片文件转换为 Markdown。启用后，MinerU 对 PDF、DOCX、PPTX、XLSX 及所有图片格式的优先级高于 Docling/DEFAULT 引擎。

> **注意**：图片文件（`.png` `.jpg` `.jpeg` `.bmp` `.tiff` `.gif` `.webp`）**只能**通过 MinerU 解析，其他引擎无法处理原始图片文件。

**快速开始：**

1. 部署 MinerU WebAPI 服务 — 参见 [MinerU 文档](https://github.com/opendatalab/MinerU)
2. 在 `.env` 中添加以下配置：

```env
MINERU_ENABLED=true
MINERU_BASE_URL=http://<MinerU服务地址>:28080
```

3. 重启 `lightrag-server`

**调用模式**（`MINERU_MODE`）：

| 模式 | 说明 |
|------|------|
| `sync` | `POST /file_parse` — 单次请求阻塞等待，简单可靠，适合 ~50 MB 以内的文件 |
| `async` | `POST /tasks` + 轮询 `GET /tasks/{id}` — 适合大文件或网络较慢的场景 |

**解析后端**（`MINERU_BACKEND`）：

| 值 | 说明 |
|----|------|
| `pipeline` | 通用多语言，无幻觉风险 |
| `vlm-auto-engine` | 本地 GPU 高精度（仅支持中英文） |
| `vlm-http-client` | 远程 VLM 服务器高精度（仅支持中英文） |
| `hybrid-auto-engine` | 新一代本地 GPU 高精度，多语言支持 **（默认）** |
| `hybrid-http-client` | 远程 VLM + 本地版面分析，多语言支持 |

---

## 启动服务器

```bash
# 单进程（Uvicorn）— 开发或中等负载
lightrag-server

# 多进程（Gunicorn + Uvicorn）— 生产环境
lightrag-gunicorn --workers 4

# 多实例隔离部署
lightrag-server --port 9621 --workspace project_a
lightrag-server --port 9622 --workspace project_b
```

主要启动参数：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--host` | `0.0.0.0` | 监听地址 |
| `--port` | `9621` | 监听端口 |
| `--working-dir` | `./rag_storage` | RAG 数据目录 |
| `--input-dir` | `./inputs` | 文件扫描目录 |
| `--workspace` | *(空)* | 数据隔离命名空间 |
| `--log-level` | `INFO` | DEBUG / INFO / WARNING / ERROR |
| `--key` | *(无)* | 静态 API Key |
| `--ssl` | false | 启用 HTTPS |

---

## 认证机制

服务器支持两种可同时使用的认证方式。

### 1. API Key 认证

在 `.env` 中设置 `LIGHTRAG_API_KEY`，请求时通过 `X-API-Key` 请求头传递：

```bash
curl http://localhost:9621/documents/scan \
  -H "X-API-Key: your-secret-key"
```

免认证路径（通过 `WHITELIST_PATHS` 配置）默认为：`/health,/api/*`

### 2. JWT Bearer 令牌认证

用户账户存储在本地 SQLite 数据库（`lightrag_users.db`）中。
配置 JWT 签名密钥：

```env
TOKEN_SECRET=JWT签名密钥
TOKEN_EXPIRE_HOURS=24
```

**命令行重置用户密码**：

```bash
lightrag-server reset-password <用户名> --password <新密码>
# 或安全交互式输入（密码不回显）：
lightrag-server reset-password <用户名>
# 指定非默认工作目录：
lightrag-server reset-password <用户名> --working-dir /data/rag_storage
```

**登录获取 JWT**（`POST /login`）：

```bash
curl -X POST http://localhost:9621/login \
  -d "username=admin&password=密码"
```

响应：

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer",
  "auth_mode": "enabled",
  "role": "admin"
}
```

后续请求携带令牌：

```bash
curl http://localhost:9621/query \
  -H "Authorization: Bearer eyJhbGci..." \
  -H "Content-Type: application/json" \
  -d '{"query": "LightRAG 是什么？", "mode": "hybrid"}'
```

### 用户角色

| 角色 | 说明 |
|------|------|
| `admin` | 完全访问：用户/组织/知识库管理，所有操作 |
| `user` | 访问已分配的知识库，管理自己的聊天会话 |
| `guest` | 禁用认证时的自动角色（只读） |

---

## 多知识库

每个知识库（KB）是独立的 LightRAG 实例，拥有独立的图谱、向量存储和文档数据。

### 知识库路由

通过 `X-KB-ID` 请求头将请求路由到指定知识库：

```bash
curl http://localhost:9621/query \
  -H "X-KB-ID: 550e8400-e29b-41d4-a716-446655440000" \
  -H "Authorization: Bearer ..." \
  -d '{"query": "...", "mode": "hybrid"}'
```

不含 `X-KB-ID` 或 ID 无效时，请求路由到**默认知识库**。

### 知识库权限

通过组织层级管理知识库访问：

- **admin** 角色 → 访问所有知识库
- **组织管理员（org-admin）** → 对其所管辖组织子树内知识库有写权限
- **kb_write 授权** → 对特定知识库有写权限
- **kb_read 授权** → 对特定知识库只读权限

---

## API 参考

所有需要认证的接口均可通过 `X-API-Key` 请求头或 `Authorization: Bearer <token>` 请求头进行认证。

---

### 系统接口

#### `GET /`
重定向到 WebUI（若 WebUI 未构建则重定向到 `/docs`）。

---

#### `GET /health`
返回系统综合健康状态。

**认证**：需要

**响应**：
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
返回认证状态及服务器版本信息。

**认证**：不需要

**响应**：
```json
{"auth_enabled": true, "core_version": "1.4.11", "api_version": "...", "webui_title": "LightRAG"}
```

---

#### `POST /login`
登录并获取 JWT 令牌。

**认证**：不需要

**请求**：`application/x-www-form-urlencoded`
- `username`（string，必填）
- `password`（string，必填）

**响应**：
```json
{"access_token": "eyJ...", "token_type": "bearer", "auth_mode": "enabled", "role": "admin"}
```

---

#### `GET /setup/status`
检查系统是否已完成一次性初始化配置。

**认证**：不需要（始终公开）

**响应**：`{"setup_required": true}`

---

#### `POST /setup`
完成系统初始化（创建管理员账户 + 根组织 + 默认知识库）。
仅在 `setup_required` 为 `true` 时可用；初始化完成后调用返回 `409`。

**认证**：不需要

**请求体**：
```json
{
  "admin_username": "admin",
  "admin_password": "安全密码",
  "org_name": "我的组织",
  "kb_name": "默认知识库"
}
```

**响应**：`201 Created`

---

### 查询接口

所有查询接口使用相同的 `QueryRequest` 请求体，并通过 `X-KB-ID` 请求头路由到指定知识库。

#### `QueryRequest` 参数说明

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `query` | string | 必填 | 查询文本（至少 3 个字符） |
| `mode` | enum | `"mix"` | `local` / `global` / `hybrid` / `naive` / `mix` / `bypass` |
| `top_k` | int | 服务器默认（60） | 检索的 KG 实体/关系数量 |
| `chunk_top_k` | int | 服务器默认（20） | 检索的文本块数量 |
| `max_entity_tokens` | int | — | 实体上下文 Token 预算 |
| `max_relation_tokens` | int | — | 关系上下文 Token 预算 |
| `max_total_tokens` | int | — | 总上下文 Token 预算 |
| `enable_rerank` | bool | `true` | 启用文本块重排序 |
| `include_references` | bool | `true` | 响应中包含来源引用 |
| `include_chunk_content` | bool | `false` | 引用中包含原文内容（调试用） |
| `stream` | bool | `true` | 流式输出（仅对 `/query/stream` 生效） |
| `only_need_context` | bool | — | 仅返回检索上下文，跳过 LLM 生成 |
| `only_need_prompt` | bool | — | 仅返回生成的 Prompt |
| `response_type` | string | — | 响应格式提示（如 `"要点列表"`） |
| `user_prompt` | string | — | 附加到 LLM Prompt 的指令 |
| `conversation_history` | array | — | 历史消息 `[{"role":"user","content":"..."}]` |
| `hl_keywords` | string[] | `[]` | 高层关键词（优先检索） |
| `ll_keywords` | string[] | `[]` | 底层关键词（精细化检索） |

---

#### `POST /query`
非流式 RAG 查询。

**响应**（`QueryResponse`）：
```json
{
  "response": "LightRAG 是一个基于图谱的 RAG 框架...",
  "references": [
    {"reference_id": "1", "file_path": "docs/intro.md", "content": ["chunk 内容..."]}
  ]
}
```

`include_references=false` 时 `references` 为 `null`；`include_chunk_content=true` 时才有 `content` 数组。

---

#### `POST /query/stream`
流式 RAG 查询（NDJSON 格式逐行返回）。

**`stream=true`** 时返回 NDJSON 流：
```jsonl
{"references": [{"reference_id": "1", "file_path": "doc.md"}]}
{"response": "LightRAG "}
{"response": "是一个"}
{"response": "基于图谱的 RAG 框架..."}
```

**`stream=false`** 时返回单行完整响应。

---

#### `POST /query/data`
返回原始检索上下文（实体、关系、文本块），不进行 LLM 生成，始终包含引用。

**响应**（`QueryDataResponse`）：
```json
{
  "status": "success",
  "message": "Query completed",
  "data": {"entities": [...], "relationships": [...], "chunks": [...]},
  "metadata": {"mode": "hybrid", "hl_keywords": ["LightRAG"], "ll_keywords": ["图谱"]}
}
```

---

### 文档接口

所有文档接口均通过 `X-KB-ID` 请求头路由到指定知识库。

#### `POST /documents/scan`
扫描输入目录中的新文件并开始索引。

**响应**：`{"status": "ok", "message": "Scanning started"}`

---

#### `POST /documents/upload`
上传一个或多个文件进行索引。

**Content-Type**：`multipart/form-data`  
**表单字段**：`files`（一个或多个文件）

**支持格式**：TXT、MD、MDX、PDF、DOCX、PPTX、XLSX、RTF、ODT、EPUB、HTML、JSON、XML、CSV、代码文件等

**响应**：
```json
{"status": "ok", "message": "Files queued for processing", "track_id": "insert-20250326-abc123"}
```

---

#### `POST /documents/text`
插入单条文本文档。

**请求**：
```json
{"text": "你的文档内容...", "description": "可选标签"}
```

**响应**：`{"status": "ok", "track_id": "insert-20250326-xyz789"}`

---

#### `POST /documents/texts`
批量插入多条文本文档。

**请求**：
```json
{"texts": ["文档 1...", "文档 2..."], "descriptions": ["标签 1", "标签 2"]}
```

---

#### `GET /documents`
列出所有文档及状态摘要。

**响应**：
```json
{
  "documents": [
    {"id": "doc-abc", "file_path": "report.pdf", "status": "processed", "chunks_count": 42, "created_at": "2025-03-26T10:00:00Z"}
  ],
  "total": 1
}
```

---

#### `POST /documents/paginated`
分页查询文档列表，支持状态过滤。

**请求**：
```json
{"page": 1, "page_size": 20, "status_filter": "processed"}
```

状态值：`pending`、`processing`、`processed`、`failed`、`all`

---

#### `GET /documents/status_counts`
按状态统计文档数量。

**响应**：`{"all": 100, "processed": 85, "processing": 5, "pending": 3, "failed": 7}`

---

#### `GET /documents/pipeline_status`
获取当前处理管道状态和队列深度。

**响应**：
```json
{"status": "running", "queue_depth": 3, "current_file": "large_report.pdf", "progress_percent": 65}
```

---

#### `GET /documents/track_status/{track_id}`
轮询指定插入操作的处理状态。

**响应**：
```json
{
  "track_id": "insert-20250326-abc123",
  "documents": [{"id": "doc-xyz", "status": "processed", "file_path": "report.pdf", "error_msg": null}]
}
```

---

#### `DELETE /documents`
清除当前知识库中的所有文档。

**查询参数**：`delete_files`（bool，默认 `false`）— 是否同时删除磁盘上的源文件

---

#### `DELETE /documents/delete_document`
删除一个或多个文档及其关联数据。

**请求体**：
```json
{"doc_ids": ["doc-abc123", "doc-def456"], "delete_file": false, "delete_llm_cache": false}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `doc_ids` | string[] | 必填 | 待删除的文档 ID 列表 |
| `delete_file` | bool | `false` | 同时删除磁盘上的源文件 |
| `delete_llm_cache` | bool | `false` | 同时删除缓存的 LLM 提取结果 |

---

#### `DELETE /documents/delete_entity`
从知识图谱中删除命名实体。

**请求体**：`{"entity_name": "实体名称"}`

---

#### `DELETE /documents/delete_relation`
从知识图谱中删除特定关系。

**请求体**：`{"source_entity": "实体A", "target_entity": "实体B"}`

---

#### `POST /documents/clear_cache`
清除 LLM 响应缓存。

**请求体**：`{"mode": "all"}` — 可选值：`all`、`extract`、`query`

---

#### `POST /documents/reprocess_failed`
将所有 `failed` 状态的文档重新加入处理队列。

---

#### `POST /documents/cancel_pipeline`
取消当前正在运行的索引管道。

---

#### `GET /documents/{doc_id}/content`
返回文档在 KV 存储中的完整文本内容。

**认证**：需要

**路径参数**：`doc_id` — 文档 ID

**响应**：
```json
{
  "id": "doc-abc123",
  "file_path": "report.pdf",
  "content": "文档完整 Markdown 内容...",
  "content_length": 4096
}
```

---

### 知识图谱接口

#### `GET /graphs`
获取用于可视化的子图数据。

**查询参数**：
- `label`（string，必填）— 以该实体为中心
- `max_depth`（int，默认 3）— 遍历深度
- `max_nodes`（int，默认 1000）— 最大节点数

**响应**：
```json
{
  "nodes": [{"id": "LightRAG", "type": "CONCEPT", "description": "..."}],
  "edges": [{"src": "LightRAG", "tgt": "RAG", "description": "..."}]
}
```

---

#### `GET /graph/label/list`
列出知识图谱中的所有实体标签（名称）。

---

#### `GET /graph/label/popular`
返回连接度最高的实体标签。

**查询参数**：`limit`（int，默认 300，最大 1000）

---

#### `GET /graph/label/search`
按关键词搜索实体标签。

**查询参数**：`q`（string，必填），`limit`（int，默认 50，最大 100）

---

#### `GET /graph/entity/exists`
检查实体是否存在。**查询参数**：`entity_name`

---

#### `POST /graph/entity/create`
创建新实体节点。

**请求体**（`EntityCreateRequest`）：
```json
{
  "entity_name": "特斯拉",
  "entity_data": {
    "description": "电动汽车制造商",
    "entity_type": "ORGANIZATION",
    "source_id": "manual-insert"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `entity_name` | string | 实体唯一名称 |
| `entity_data` | object | 实体属性（`description`、`entity_type`、`source_id` 等） |

---

#### `POST /graph/entity/edit`
更新已有实体属性。

**请求体**（`EntityUpdateRequest`）：
```json
{
  "entity_name": "已有实体",
  "updated_data": {
    "description": "更新后的描述",
    "entity_type": "ORGANIZATION"
  },
  "allow_rename": false,
  "allow_merge": false
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `entity_name` | string | 必填 | 待更新的实体名称 |
| `updated_data` | object | 必填 | 要更新的属性 |
| `allow_rename` | bool | `false` | 是否允许重命名实体 |
| `allow_merge` | bool | `false` | 重命名冲突时是否允许合并 |

---

#### `POST /graph/entities/merge`
将多个实体节点合并为一个，保留所有关系。

**请求体**（`EntityMergeRequest`）：
```json
{
  "entities_to_change": ["实体A别名", "实体A错误拼写"],
  "entity_to_change_into": "实体A"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `entities_to_change` | string[] | 待合并并删除的实体列表（重复或拼写错误的实体） |
| `entity_to_change_into` | string | 接收所有关系的目标实体（保留） |

---

#### `POST /graph/relation/create`
创建两个实体之间的新关系。

**请求体**（`RelationCreateRequest`）：
```json
{
  "source_entity": "实体A",
  "target_entity": "实体B",
  "relation_data": {
    "description": "关系描述",
    "keywords": "关键词",
    "weight": 1.0
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `source_entity` | string | 源实体名称（必须已存在） |
| `target_entity` | string | 目标实体名称（必须已存在） |
| `relation_data` | object | 关系属性（`description`、`keywords`、`weight` 等） |

---

#### `POST /graph/relation/edit`
更新已有关系属性。

**请求体**（`RelationUpdateRequest`）：
```json
{
  "source_id": "实体A",
  "target_id": "实体B",
  "updated_data": {
    "description": "更新后的描述",
    "weight": 2.0
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `source_id` | string | 源实体名称 |
| `target_id` | string | 目标实体名称 |
| `updated_data` | object | 要更新的属性 |

---

### 知识库管理接口

#### `GET /kbs`
列出当前用户可见的所有知识库。

**响应**：
```json
{
  "kbs": [{"id": "uuid...", "name": "产品文档", "is_default": false, "loaded": true, "can_write": true}],
  "total": 3
}
```

---

#### `POST /kbs`
创建新知识库（需要 admin 或组织管理员权限）。

**请求体**：`{"name": "产品文档", "description": "...", "org_id": "组织UUID（可选）"}`

**响应**：`201 Created`，返回知识库对象。

---

#### `GET /kbs/{kb_id}` · `PUT /kbs/{kb_id}` · `DELETE /kbs/{kb_id}`
获取、更新、删除知识库。

`DELETE` 操作需要 admin 权限，将删除知识库及其所有数据。

---

#### `GET /kbs/{kb_id}/stats`
获取知识库文档和存储统计信息。

**响应**：
```json
{"document_count": 42, "entity_count": 1840, "relation_count": 3200, "chunk_count": 580}
```

---

#### `GET /kbs/{kb_id}/settings` · `PUT /kbs/{kb_id}/settings`
获取/更新知识库级别的查询默认参数（admin）。

---

#### `GET /kbs/{kb_id}/export`
导出知识库数据为 ZIP 压缩包（admin）。

**响应**：`application/zip` 文件下载。

---

#### `POST /kbs/import`
从 ZIP 文件导入知识库（admin）。

**Content-Type**：`multipart/form-data`，表单字段：`file`（ZIP 文件）

**响应**：`201 Created`

---

### 聊天会话接口

聊天会话按用户和知识库隔离，持久化保存对话历史。

#### `GET /chat/sessions`
获取当前用户的聊天会话列表。

**查询参数**：`kb_id`（可选，按知识库过滤）

**响应**：
```json
{
  "sessions": [{"session_id": "sess-abc", "kb_id": "kb-uuid", "title": "我的对话", "messages": [...], "updated_at": "..."}]
}
```

---

#### `PUT /chat/sessions/{session_id}`
创建或更新聊天会话（upsert 操作）。

**请求体**：
```json
{
  "kb_id": "kb-uuid",
  "title": "产品 FAQ",
  "messages": [{"role": "user", "content": "LightRAG 是什么？"}, {"role": "assistant", "content": "LightRAG 是..."}]
}
```

---

#### `DELETE /chat/sessions/{session_id}`
删除特定聊天会话。

---

#### `DELETE /chat/sessions`
清除当前用户的所有聊天会话（可通过请求体指定 `kb_id` 按知识库过滤）。

---

### 用户管理接口

所有用户管理接口均需要 `admin` 角色。

#### `GET /users`
列出所有用户。

---

#### `POST /users`
创建新用户。

**请求体**：`{"username": "bob", "password": "安全密码", "email": "bob@example.com", "role": "user"}`

角色值：`admin`、`user`

**响应**：`201 Created`

---

#### `GET /users/me`
获取当前登录用户的个人信息（任何已认证用户均可调用）。

---

#### `PUT /users/me/password`
修改当前用户的密码（任何已认证用户均可调用）。

**请求体**：`{"current_password": "旧密码", "new_password": "新密码"}`

---

#### `POST /users/me/avatar`
上传或替换当前用户的头像图片。

**认证**：任何已认证用户
**Content-Type**：`multipart/form-data`

**表单字段**：`file` — 图片文件（支持 JPEG、PNG、GIF、WebP、SVG）

**响应**：
```json
{"avatar_url": "/avatars/alice.jpg", "message": "Avatar uploaded successfully"}
```

---

#### `DELETE /users/me/avatar`
删除当前用户的头像。

**认证**：任何已认证用户

**响应**：`{"message": "Avatar removed successfully"}`

---

#### `GET /users/{user_id}` · `PUT /users/{user_id}` · `DELETE /users/{user_id}`
获取、更新、删除指定用户（admin）。

`PUT` 请求体：`{"email": "new@example.com", "role": "admin", "is_active": true}`

---

### 组织管理接口

组织以树状层级结构组织，知识库访问权限通过组织成员关系授予。

#### `GET /orgs`
获取完整的组织树。

---

#### `GET /orgs/my`
获取当前用户的组织成员关系。

---

#### `POST /orgs`
创建组织（可指定父组织形成嵌套层级，需要 admin 权限）。

**请求体**：`{"name": "工程部", "parent_id": "父组织UUID（可选）", "description": "..."}`

**响应**：`201 Created`

---

#### `GET /orgs/{org_id}` · `PUT /orgs/{org_id}` · `DELETE /orgs/{org_id}`
获取、更新、删除组织（`DELETE` 需要 admin 权限）。

---

#### `GET /orgs/{org_id}/members`
列出组织成员。

---

#### `POST /orgs/{org_id}/members`
将用户添加到组织（需要 admin 或组织管理员权限）。

**请求体**：`{"username": "alice", "role": "member"}` 角色值：`admin`（组织管理员）、`member`

**响应**：`201 Created`

---

#### `PUT /orgs/{org_id}/members/{username}` · `DELETE /orgs/{org_id}/members/{username}`
更新成员角色、从组织中移除成员。

---

#### `GET /orgs/{org_id}/kb-permissions`
列出组织成员的显式知识库操作权限。

---

#### `POST /orgs/{org_id}/kb-permissions`
为组织成员授予知识库权限（需要 admin 或组织管理员权限）。

**请求体**（`KBPermissionRequest`）：
```json
{"username": "alice", "permission": "write"}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `username` | string | 组织成员的用户名 |
| `permission` | string | `"read"` 或 `"write"` |

**响应**：`201 Created`

---

#### `DELETE /orgs/{org_id}/kb-permissions/{username}/{permission}`
撤销知识库权限。

**路径参数**：`username`，`permission`（`"read"` 或 `"write"`）

---

### Ollama 兼容接口

这些接口模拟 Ollama API，使 AI 前端（如 Open WebUI）可将 LightRAG 当作本地 Ollama 模型使用。

#### `GET /api/version`
返回 Ollama API 版本字符串。

---

#### `GET /api/tags`
返回可用模型列表（报告 `lightrag:latest`）。

---

#### `GET /api/ps`
返回当前已加载的模型（Ollama `ps` 等价接口）。

---

#### `POST /api/generate`
Ollama 生成补全接口 — 转发给底层 LLM（绕过 RAG）。

**请求体**（Ollama 格式）：
```json
{"model": "lightrag:latest", "prompt": "你好", "stream": false}
```

---

#### `POST /api/chat`
Ollama 聊天补全接口 — 通过 LightRAG 查询引擎处理。

**请求体**（Ollama 格式）：
```json
{
  "model": "lightrag:latest",
  "messages": [{"role": "user", "content": "/mix LightRAG 是什么？"}],
  "stream": true
}
```

**消息内容中的查询模式前缀**：

| 前缀 | 查询模式 |
|------|----------|
| `/local` | local |
| `/global` | global |
| `/hybrid` | hybrid |
| `/naive` | naive |
| `/mix` | mix |
| `/bypass` | 直接发给 LLM，跳过 RAG |
| `/context` | 仅返回检索上下文 |
| `/[自定义指令]` | 附加用户提示词 |
| *(无前缀)* | hybrid（默认） |

---

## 环境变量参考

### 服务器

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HOST` | `0.0.0.0` | 服务器绑定地址 |
| `PORT` | `9621` | 服务器端口 |
| `WORKERS` | `2` | Gunicorn Worker 进程数 |
| `WORKING_DIR` | `./rag_storage` | RAG 数据持久化目录 |
| `INPUT_DIR` | `./inputs` | 文件扫描目录 |
| `WORKSPACE` | *(空)* | 数据隔离命名空间 |
| `MAX_UPLOAD_SIZE` | `104857600` | 最大文件上传大小（字节，默认 100MB） |
| `LOG_LEVEL` | `INFO` | 日志级别 |

### LLM

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LLM_BINDING` | `ollama` | `openai` / `ollama` / `azure_openai` / `gemini` / `aws_bedrock` / `lollms` |
| `LLM_MODEL` | — | 模型名称 |
| `LLM_BINDING_HOST` | — | API 基础 URL |
| `LLM_BINDING_API_KEY` | — | API Key |
| `MAX_ASYNC` | `4` | 最大并发 LLM 请求数 |
| `TIMEOUT` | `150` | 请求超时（秒） |
| `OLLAMA_LLM_NUM_CTX` | `8192` | Ollama 上下文窗口（LightRAG 需要 ≥32768） |

### Embedding

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `EMBEDDING_BINDING` | `ollama` | `openai` / `ollama` / `azure_openai` / `jina` / `gemini` / `aws_bedrock` |
| `EMBEDDING_MODEL` | — | Embedding 模型名称 |
| `EMBEDDING_DIM` | — | 向量维度 |
| `EMBEDDING_BINDING_HOST` | — | Embedding API 地址 |

### 认证

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LIGHTRAG_API_KEY` | *(无)* | 静态 API Key |
| `WHITELIST_PATHS` | `/health,/api/*` | 免认证路径 |
| `TOKEN_SECRET` | *(随机，会产生警告)* | JWT 签名密钥（生产环境必须设置） |
| `TOKEN_EXPIRE_HOURS` | `24` | JWT 有效期（小时） |

### 存储

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LIGHTRAG_KV_STORAGE` | `JsonKVStorage` | KV 后端类名 |
| `LIGHTRAG_VECTOR_STORAGE` | `NanoVectorDBStorage` | 向量后端类名 |
| `LIGHTRAG_GRAPH_STORAGE` | `NetworkXStorage` | 图谱后端类名 |
| `LIGHTRAG_DOC_STATUS_STORAGE` | `JsonDocStatusStorage` | 文档状态后端类名 |

### 查询默认值

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `TOP_K` | `60` | 默认 KG 检索数量 |
| `CHUNK_TOP_K` | `20` | 默认文本块检索数量 |
| `MAX_TOTAL_TOKENS` | `30000` | 默认上下文 Token 预算 |
| `HISTORY_TURNS` | `3` | 默认对话历史轮数 |
| `RERANK_BINDING` | *(无)* | `cohere` / `jina` / `aliyun` |
| `RERANK_BY_DEFAULT` | `true` | 默认启用重排序 |

### 文档处理

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MAX_PARALLEL_INSERT` | `2` | 并行处理文件数（建议 2–10） |
| `ENABLE_LLM_CACHE_FOR_EXTRACT` | `true` | 缓存实体提取 LLM 调用 |
| `SUMMARY_LANGUAGE` | `English` | 实体摘要语言 |

### MinerU

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MINERU_ENABLED` | `false` | 是否启用 MinerU 文档解析引擎 |
| `MINERU_BASE_URL` | `http://localhost:28080` | MinerU 服务地址（无需结尾斜杠） |
| `MINERU_MODE` | `sync` | 调用模式：`sync`（单次请求）或 `async`（轮询，适合大文件） |
| `MINERU_BACKEND` | `hybrid-auto-engine` | 解析后端 — 参见 [MinerU 文档解析](#mineru-文档解析) |
| `MINERU_PARSE_METHOD` | `auto` | PDF 解析方式：`auto` / `txt`（数字 PDF）/ `ocr`（扫描件） |
| `MINERU_LANG_LIST` | `ch` | 逗号分隔的 OCR 语言列表，如 `ch,en` |
| `MINERU_FORMULA_ENABLE` | `true` | 是否启用公式识别 |
| `MINERU_TABLE_ENABLE` | `true` | 是否启用表格识别 |
| `MINERU_TIMEOUT` | `300` | Sync 模式 HTTP 超时（秒），大文件可适当增大 |
| `MINERU_ASYNC_POLL_INTERVAL` | `2.0` | Async 模式轮询间隔（秒） |
| `MINERU_ASYNC_MAX_WAIT` | `600` | Async 模式最大等待时间（秒） |
| `MINERU_FALLBACK_ON_ERROR` | `true` | 出错时是否回退到本地引擎（pypdf/Docling） |

---

## 部署方式

### Docker Compose

```bash
docker compose up
```

详见 [docs/DockerDeployment.md](../../docs/DockerDeployment.md)。

### Linux Systemd 服务

```bash
sudo cp lightrag.service.example /etc/systemd/system/lightrag.service
# 编辑 ExecStart 路径
sudo systemctl daemon-reload
sudo systemctl enable --now lightrag.service
```

### Nginx 反向代理

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

> 流式接口（`/query/stream`、`/api/chat`、`/api/generate`）务必关闭 `gzip`，否则会缓存响应导致无法实时输出。

---

## 文档处理流程

LightRAG 以异步方式两阶段处理文档：

1. **提取阶段** — 从文本块中并行提取实体和关系，由 `MAX_PARALLEL_INSERT`（文件并行数）和 `MAX_ASYNC`（LLM 并发数）控制
2. **合并阶段** — 将提取结果合并到知识图谱；合并操作优先级高于提取操作

**并发参数建议**：
- `MAX_PARALLEL_INSERT`：2–10，推荐设为 `MAX_ASYNC / 3`
- `MAX_ASYNC`：4–16，取决于 LLM API 速率限制

文件以原子单位处理：仅当文件所有文本块完成提取和合并后，该文件才被标记为 `processed`。

**追踪处理进度**（使用上传/插入接口返回的 `track_id`）：
```bash
GET /documents/track_status/{track_id}
```

**重试失败文档**：
```bash
POST /documents/reprocess_failed
```
