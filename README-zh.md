<div align="center">
<img src="./assets/logo.png" width="100" height="100" alt="LightRAG Logo" style="border-radius: 20px;">

# LightRAG

**基于图谱的检索增强生成框架 — 企业版**

[![Python](https://img.shields.io/badge/Python-3.10+-4ecdc4?style=flat-square&logo=python)](https://www.python.org/)
[![PyPI](https://img.shields.io/pypi/v/lightrag-hku.svg?style=flat-square&logo=pypi)](https://pypi.org/project/lightrag-hku/)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)
[![arXiv](https://img.shields.io/badge/arXiv-2410.05779-red?style=flat-square)](https://arxiv.org/abs/2410.05779)

[English](README.md) · [中文](README-zh.md) · [API 文档](lightrag/api/README-zh.md)

</div>

---

## 项目简介

LightRAG 是一个基于图谱的检索增强生成框架。本仓库是 [HKUDS/LightRAG](https://github.com/HKUDS/LightRAG) 的生产级衍生项目，保留了原版图谱 RAG 核心引擎，并在此基础上扩展了完整的服务器平台：

| 层次 | 功能 |
|------|------|
| **核心引擎** | 图谱实体/关系提取，多模式检索（local · global · hybrid · mix · naive） |
| **API 服务器** | FastAPI，58+ REST 接口，多知识库路由，JWT 认证，流式响应 |
| **管理系统** | 多知识库管理、用户与角色体系、组织层级权限 |
| **WebUI** | React 19 + Sigma.js 图谱可视化、文档管理、检索测试，支持 11 种语言 |
| **集成能力** | 7 种 LLM 绑定、7 种 Embedding 绑定、23 种存储后端、4 种重排序方案 |

---

## 相比上游 LightRAG 的新增特性

| 特性 | 上游版本 | 本项目 |
|------|----------|--------|
| 知识库数量 | 单个 | **多知识库**（无限，通过 `X-KB-ID` 请求头路由） |
| 用户管理 | — | **完整用户体系**（admin / user / guest 角色） |
| 组织管理 | — | **树状组织结构**，含成员角色与知识库权限管理 |
| 认证方式 | 仅 API Key | **JWT Bearer + API Key** 双重认证，bcrypt 密码加密 |
| 对话管理 | — | **持久化聊天历史**，按用户按知识库隔离 |
| API 接口数 | ~10 个 | **58 个 REST 接口**，覆盖 9 个功能模块 |
| WebUI | 基础版 | **完整 WebUI**：图谱查看器、文档管理、检索测试 |
| 界面语言 | 1 种 | **11 种语言**支持 |

---

## 目录

- [快速开始](#快速开始)
- [核心 Python 库](#核心-python-库)
- [查询模式](#查询模式)
- [API 服务器与 WebUI](#api-服务器与-webui)
- [多知识库系统](#多知识库系统)
- [认证机制](#认证机制)
- [存储后端](#存储后端)
- [LLM 与 Embedding 绑定](#llm-与-embedding-绑定)
- [WebUI 功能](#webui-功能)
- [开发指南](#开发指南)
- [配置参考](#配置参考)

---

## 快速开始

### 安装

```bash
# 安装 API 服务器（推荐）
pip install "lightrag-hku[api]"

# 仅安装核心库
pip install lightrag-hku
```

### 配置

```bash
cp env.example .env
# 编辑 .env 填入 LLM 和 Embedding 配置
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

### 启动服务器

```bash
lightrag-server                        # 单进程（Uvicorn）
lightrag-gunicorn --workers 4          # 多进程（生产环境）
```

打开 **http://localhost:9621** 访问 WebUI，**http://localhost:9621/docs** 访问 Swagger UI。

---

## 核心 Python 库

LightRAG 可作为独立 Python 库使用，无需启动服务器。

### 初始化

```python
import asyncio
from lightrag import LightRAG, QueryParam
from lightrag.llm.openai import gpt_4o_mini_complete, openai_embed

async def main():
    rag = LightRAG(
        working_dir="./rag_storage",
        llm_model_func=gpt_4o_mini_complete,
        embedding_func=openai_embed,
    )
    await rag.initialize_storages()  # 必须调用

    await rag.ainsert("你的文档内容...")
    result = await rag.aquery("你的问题？", param=QueryParam(mode="hybrid"))
    print(result)

    await rag.finalize_storages()

asyncio.run(main())
```

> **重要**：使用前必须调用 `await rag.initialize_storages()`，关闭前调用 `await rag.finalize_storages()`。

### 文档插入

```python
# 单文档
await rag.ainsert("文本内容")

# 批量插入
await rag.ainsert(["文档 1", "文档 2", "文档 3"])

# 指定自定义 ID（支持幂等重插）
await rag.ainsert(["内容"], ids=["my-doc-001"])

# 携带文件路径（用于引用溯源）
await rag.ainsert(["内容 1", "内容 2"], file_paths=["doc1.pdf", "doc2.pdf"])
```

### 查询

```python
from lightrag import QueryParam

result = await rag.aquery(
    "LightRAG 是什么？",
    param=QueryParam(
        mode="mix",            # local | global | hybrid | naive | mix
        top_k=60,              # 检索的 KG 实体/关系数量
        chunk_top_k=20,        # 检索的文本块数量
        max_total_tokens=30000,
        enable_rerank=True,
        include_references=True,
        include_chunk_content=False,
    )
)
```

### 自定义 LLM / Embedding 函数

```python
from lightrag.utils import wrap_embedding_func_with_attrs
from lightrag.llm.openai import openai_complete_if_cache, openai_embed
import numpy as np

async def my_llm(prompt, system_prompt=None, history_messages=[], **kwargs):
    return await openai_complete_if_cache(
        "gpt-4o-mini", prompt,
        system_prompt=system_prompt,
        history_messages=history_messages,
        api_key="sk-...",
        **kwargs,
    )

@wrap_embedding_func_with_attrs(embedding_dim=3072, max_token_size=8192)
async def my_embed(texts: list[str]) -> np.ndarray:
    return await openai_embed.func(texts, model="text-embedding-3-large", api_key="sk-...")

rag = LightRAG(
    working_dir="./storage",
    llm_model_func=my_llm,
    embedding_func=my_embed,
)
```

---

## 查询模式

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| `local` | 以实体为中心，从局部子图检索 | 针对特定实体的问题 |
| `global` | 基于社区摘要的宏观知识检索 | 广泛主题性问题 |
| `hybrid` | local + global 组合 | 通用场景 |
| `naive` | 直接向量相似度搜索（不使用图谱） | 简单事实查找 |
| `mix` | local + global + naive，可选重排序 | **配合重排序推荐使用** |
| `bypass` | 跳过 RAG，直接将问题发给 LLM | 非 RAG 对话 |

---

## API 服务器与 WebUI

内置 FastAPI 服务器通过 REST API 暴露 LightRAG 全部能力，并提供内置 WebUI。

### 构建 WebUI

```bash
cd lightrag_webui
bun install --frozen-lockfile
bun run build
cd ..
```

### 接口模块概览

| 模块 | 接口数 | 说明 |
|------|--------|------|
| **系统** | 4 个 | 健康检查、认证状态、登录 |
| **查询** | 3 个 | RAG 查询（普通 / 流式 / 数据） |
| **文档** | 15 个 | 上传、管理、监控进度 |
| **知识图谱** | 10 个 | 图谱可视化与编辑 |
| **知识库** | 10 个 | 多知识库管理 |
| **聊天会话** | 4 个 | 持久化对话历史 |
| **用户管理** | 7 个 | 用户 CRUD（管理员） |
| **组织管理** | 13 个 | 组织层级与权限 |
| **Ollama 兼容** | 5 个 | Ollama 协议接口 |

完整 API 文档：[lightrag/api/README-zh.md](lightrag/api/README-zh.md) 或通过 `/docs` 访问 Swagger UI。

---

## 多知识库系统

每个知识库（KB）是独立的 LightRAG 实例，拥有独立的图谱、向量存储和文档数据。

### 核心概念

- **默认知识库** — 始终存在，处理不含 `X-KB-ID` 请求头的请求
- **命名知识库** — 通过 API 创建，以 UUID 标识
- **知识库路由** — `X-KB-ID` 请求头将文档/查询请求路由到目标知识库

### 知识库管理 API 示例

```bash
# 列出当前用户可见的所有知识库
GET /kbs

# 创建新知识库
POST /kbs
{"name": "产品文档", "description": "..."}

# 向指定知识库发送查询
POST /query
X-KB-ID: <kb_uuid>
{"query": "...", "mode": "hybrid"}

# 导出/导入知识库
GET  /kbs/{kb_id}/export
POST /kbs/import
```

---

## 认证机制

服务器支持两种可同时使用的认证方式。

### API Key 认证

```env
LIGHTRAG_API_KEY=your-secret-key
WHITELIST_PATHS=/health,/api/*
```

通过请求头传递：`X-API-Key: your-secret-key`

### JWT Bearer 令牌认证

用户账户存储在本地 SQLite 数据库（`lightrag_users.db`）中。
配置 JWT 签名密钥：

```env
TOKEN_SECRET=你的签名密钥
TOKEN_EXPIRE_HOURS=24
```

命令行重置用户密码：
```bash
lightrag-server reset-password <用户名> --password <新密码>
# 或安全交互式输入（密码不回显）：
lightrag-server reset-password <用户名>
```

登录获取令牌：
```bash
curl -X POST http://localhost:9621/login \
  -d "username=admin&password=密码"
# 返回：{"access_token": "eyJ...", "token_type": "bearer"}

# 使用令牌
curl http://localhost:9621/query \
  -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  -d '{"query": "...", "mode": "hybrid"}'
```

### 用户角色

| 角色 | 权限说明 |
|------|----------|
| `admin` | 完全访问权限：用户管理、组织管理、所有知识库 |
| `user` | 访问已分配的知识库，管理自己的聊天会话 |
| `guest` | 禁用认证时的自动角色（只读） |

---

## 存储后端

LightRAG 使用四种存储类型，每种均有多个后端实现。

### KV 存储（文本块、LLM 缓存、文档信息）

| 后端 | 类名 | 说明 |
|------|------|------|
| JSON 文件 | `JsonKVStorage` | **默认**，无需配置 |
| Redis | `RedisKVStorage` | 生产级缓存 |
| MongoDB | `MongoKVStorage` | 文档型数据库 |
| PostgreSQL | `PGKVStorage` | 关系型数据库 |
| OpenSearch | `OpenSearchKVStorage` | 搜索引擎原生 |

### 向量存储（实体/关系/文本块向量）

| 后端 | 类名 | 说明 |
|------|------|------|
| NanoVectorDB | `NanoVectorDBStorage` | **默认**，基于文件 |
| FAISS | `FaissVectorDBStorage` | 高性能本地检索 |
| Milvus | `MilvusVectorDBStorage` | 可扩展向量数据库 |
| Qdrant | `QdrantVectorDBStorage` | 支持多租户 |
| MongoDB | `MongoVectorDBStorage` | 与 Mongo 集成 |
| PostgreSQL + pgvector | `PGVectorStorage` | SQL + 向量 |
| OpenSearch | `OpenSearchVectorDBStorage` | 搜索 + 向量 |

### 图谱存储（实体-关系图）

| 后端 | 类名 | 说明 |
|------|------|------|
| NetworkX | `NetworkXStorage` | **默认**，内存图 |
| Neo4j | `Neo4JStorage` | 原生图数据库 |
| Memgraph | `MemgraphStorage` | 内存图数据库 |
| MongoDB | `MongoGraphStorage` | 文档型图 |
| PostgreSQL | `PGGraphStorage` | 关系型图 |
| OpenSearch | `OpenSearchGraphStorage` | 搜索引擎原生 |

### 文档状态存储

| 后端 | 类名 |
|------|------|
| JSON 文件 | `JsonDocStatusStorage` |
| Redis | `RedisDocStatusStorage` |
| MongoDB | `MongoDocStatusStorage` |
| PostgreSQL | `PGDocStatusStorage` |
| OpenSearch | `OpenSearchDocStatusStorage` |

### 存储配置

```env
LIGHTRAG_KV_STORAGE=PGKVStorage
LIGHTRAG_VECTOR_STORAGE=PGVectorStorage
LIGHTRAG_GRAPH_STORAGE=Neo4JStorage
LIGHTRAG_DOC_STATUS_STORAGE=PGDocStatusStorage
```

> ⚠️ 已插入文档后不可更换存储后端类型。更换 Embedding 模型需清空向量存储并重新构建索引。

---

## LLM 与 Embedding 绑定

### LLM 绑定（`LLM_BINDING`）

| 绑定值 | 说明 |
|--------|------|
| `openai` | OpenAI 及兼容接口（vLLM、SGLang、LiteLLM 等） |
| `ollama` | 本地 Ollama 服务，需设置 `OLLAMA_LLM_NUM_CTX≥32768` |
| `azure_openai` | Azure OpenAI 企业部署 |
| `gemini` | Google Gemini 1.5 / 2.0 |
| `aws_bedrock` | AWS Bedrock（Claude、Titan 等） |
| `lollms` | 本地 LoLLMs 服务器 |

### Embedding 绑定（`EMBEDDING_BINDING`）

| 绑定值 | 推荐模型 |
|--------|----------|
| `openai` | `text-embedding-3-large`（3072d）、`text-embedding-3-small`（1536d） |
| `ollama` | `bge-m3:latest`（1024d） |
| `azure_openai` | Azure Embedding 部署 |
| `gemini` | `text-embedding-004` |
| `jina` | `jina-embeddings-v3` |
| `aws_bedrock` | Titan Embeddings |
| `lollms` | 本地服务器 |

### 重排序方案（`RERANK_BINDING`）

| 提供商 | 绑定值 | 推荐模型 |
|--------|--------|----------|
| Cohere / vLLM | `cohere` | `BAAI/bge-reranker-v2-m3` |
| Jina | `jina` | `jina-reranker-v2-base-multilingual` |
| 阿里云 | `aliyun` | `gte-rerank-v2` |
| 禁用 | `null` | — |

---

## WebUI 功能

内置 WebUI（React 19 + TypeScript + Tailwind CSS）提供以下功能模块：

### 文档管理器
- 拖放上传文件，支持 TXT、MD、PDF、DOCX、PPTX、XLSX、HTML、代码文件等多种格式
- 按状态查看文档列表（待处理 / 处理中 / 已完成 / 失败），支持分页
- 扫描输入目录、重试失败文档、清除 LLM 缓存
- 实时管道状态监控

### 知识图谱查看器
- 基于 **Sigma.js** 的交互式图谱可视化
- 26 种实体类型颜色区分
- 布局算法：圆形、力导向（force-atlas2）、力有向、圆形打包、随机、无重叠
- 节点/关系编辑、实体合并、子图搜索
- 全屏模式、小地图、缩放/旋转控制

### 检索测试
- 支持全部 6 种查询模式的查询界面
- 可配置参数：top_k、chunk_top_k、最大 token 数、历史轮数
- 流式输出、Markdown 渲染（含 KaTeX 公式和 Mermaid 图表）
- 对话历史记录，支持复制和耗时显示

### 国际化支持
支持 11 种语言：**English、简体中文、繁體中文、Français、Deutsch、日本語、한국어、Русский、Українська、العربية、Tiếng Việt**

---

## 开发指南

### 环境搭建

```bash
git clone https://github.com/HKUDS/LightRAG.git
cd LightRAG

# Python 环境
uv sync --extra api --extra test
source .venv/bin/activate

# WebUI 开发模式
cd lightrag_webui
bun install --frozen-lockfile
bun run dev       # 开发服务器: http://localhost:5173
cd ..
```

### 运行测试

```bash
# 仅运行离线测试（默认）
python -m pytest tests

# 包含集成测试（需要外部服务）
LIGHTRAG_RUN_INTEGRATION=true python -m pytest tests

# 指定测试文件
python test_graph_storage.py
```

### 代码检查

```bash
ruff check .
```

### 构建 WebUI（生产环境）

```bash
cd lightrag_webui
bun run build
cd ..
lightrag-server   # WebUI 在 http://localhost:9621 提供服务
```

### Docker 部署

```bash
docker compose up
```

详见 [docs/DockerDeployment.md](docs/DockerDeployment.md)。

---

## 配置参考

以下为主要环境变量，完整列表见 `env.example`。

### 服务器

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HOST` | `0.0.0.0` | 监听地址 |
| `PORT` | `9621` | 监听端口 |
| `WORKERS` | `2` | Gunicorn Worker 进程数 |
| `WORKING_DIR` | `./rag_storage` | RAG 数据目录 |
| `INPUT_DIR` | `./inputs` | 文件扫描目录 |
| `WORKSPACE` | *(空)* | 数据隔离命名空间 |

### LLM

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LLM_BINDING` | `ollama` | LLM 后端 |
| `LLM_MODEL` | — | 模型名称 |
| `LLM_BINDING_HOST` | — | API 地址 |
| `LLM_BINDING_API_KEY` | — | API Key |
| `MAX_ASYNC` | `4` | 最大并发 LLM 请求数 |
| `TIMEOUT` | `150` | 请求超时（秒） |
| `OLLAMA_LLM_NUM_CTX` | `8192` | Ollama 上下文窗口（建议 ≥32768） |

### Embedding

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `EMBEDDING_BINDING` | `ollama` | Embedding 后端 |
| `EMBEDDING_MODEL` | — | Embedding 模型名称 |
| `EMBEDDING_DIM` | — | 向量维度 |
| `EMBEDDING_BINDING_HOST` | — | Embedding API 地址 |

### 认证

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LIGHTRAG_API_KEY` | *(无)* | 静态 API Key |
| `WHITELIST_PATHS` | `/health,/api/*` | 免认证路径（逗号分隔） |
| `TOKEN_SECRET` | *(随机，会警告)* | JWT 签名密钥 |
| `TOKEN_EXPIRE_HOURS` | `24` | JWT 有效期（小时） |

### 查询默认值

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `TOP_K` | `60` | KG 实体/关系检索数 |
| `CHUNK_TOP_K` | `20` | 文本块检索数 |
| `MAX_TOTAL_TOKENS` | `30000` | 上下文 Token 预算 |
| `RERANK_BINDING` | *(无)* | 重排序提供商 |
| `RERANK_BY_DEFAULT` | `true` | 默认启用重排序 |

### 文档处理

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MAX_PARALLEL_INSERT` | `2` | 并行处理文件数（建议 2–10） |
| `ENABLE_LLM_CACHE_FOR_EXTRACT` | `true` | 缓存实体提取 LLM 调用 |
| `SUMMARY_LANGUAGE` | `English` | 实体摘要语言 |
| `DOCUMENT_LOADING_ENGINE` | `PYPDF` | PDF/Office 解析引擎：`PYPDF`（纯文字）或 `DOCLING`（版面感知，支持 OCR） |
| `PDF_DECRYPT_PASSWORD` | *(无)* | 加密 PDF 文件的解密密码 |

### Docling VLM（文档解析视觉语言模型）

需要先设置 `DOCUMENT_LOADING_ENGINE=DOCLING`。开启后，VLM 可辅助解析文档内嵌图片及扫描件。

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DOCLING_VLM_ENABLED` | `false` | VLM 文档解析总开关 |
| `DOCLING_VLM_MODE` | `auto` | 解析模式（见下表） |
| `DOCLING_VLM_ENGINE` | `ollama` | 推理引擎（见下表） |
| `DOCLING_VLM_URL` | *(引擎默认值)* | 自定义 API 端点；engine=`api` 时必填 |
| `DOCLING_VLM_API_KEY` | *(无)* | VLM API 端点的 Bearer 鉴权密钥 |
| `DOCLING_VLM_MODEL` | *(preset 默认)* | 模型名称覆盖 |
| `DOCLING_VLM_TIMEOUT` | `120` | 单次 VLM API 超时（秒） |
| `DOCLING_VLM_CONCURRENCY` | `1` | 并发 VLM API 请求数 |

**`DOCLING_VLM_MODE` 取值：**

| 值 | 说明 |
|----|------|
| `auto` | 先用 pypdf 探测文字层，无文字则自动切换为 `vlm_convert`（**推荐**） |
| `picture_description` | 标准 Docling 管道 + 对每张嵌入图片调用 VLM 生成描述 |
| `vlm_convert` | 整页 VLM 转换，最适合扫描件和图片型 PDF |
| `disabled` | 标准 Docling，不使用 VLM |

**`DOCLING_VLM_ENGINE` 取值：**

| 值 | 说明 |
|----|------|
| `ollama` | 本地 Ollama 服务（`http://localhost:11434`），推荐模型：`ibm/granite-docling:258m` |
| `openai` | OpenAI API（`https://api.openai.com`） |
| `lmstudio` | LM Studio（`http://localhost:1234`） |
| `api` | 任意 OpenAI 兼容端点，需同时设置 `DOCLING_VLM_URL` |
| `local` | 本机 Transformers / MLX 推理，**macOS + Gunicorn 不兼容** |

以上所有配置均可在知识库设置页面或 `PUT /kbs/{kb_id}/settings` 接口中按知识库单独覆盖，KB 级设置优先于全局环境变量。

### MinerU WebAPI（高精度文档解析）

[MinerU](https://github.com/opendatalab/MinerU) 是一个高精度文档解析引擎，通过版面分析、OCR 及可选的 VLM 后端将 PDF 和图片文件转换为 Markdown。启用后，MinerU 对支持的文件类型优先级高于 Docling/PYPDF 引擎。

> **注意**：图片文件（`.png` `.jpg` `.jpeg` `.bmp` `.tiff` `.gif` `.webp`）**只能**通过 MinerU 解析，其他引擎无法处理原始图片文件。

**快速开始**：部署 MinerU WebAPI 服务后，在 `.env` 中添加：

```env
MINERU_ENABLED=true
MINERU_BASE_URL=http://<MinerU服务地址>:28080
```

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MINERU_ENABLED` | `false` | 是否启用 MinerU 文档解析引擎 |
| `MINERU_BASE_URL` | `http://localhost:28080` | MinerU 服务地址（无需结尾斜杠） |
| `MINERU_MODE` | `sync` | 调用模式：`sync`（单次请求）或 `async`（轮询，适合大文件） |
| `MINERU_BACKEND` | `hybrid-auto-engine` | 解析后端（见下表） |
| `MINERU_PARSE_METHOD` | `auto` | PDF 解析方式：`auto` / `txt`（数字 PDF）/ `ocr`（扫描件） |
| `MINERU_LANG_LIST` | `ch` | 逗号分隔的 OCR 语言列表，如 `ch,en` |
| `MINERU_FORMULA_ENABLE` | `true` | 是否启用公式识别 |
| `MINERU_TABLE_ENABLE` | `true` | 是否启用表格识别 |
| `MINERU_TIMEOUT` | `300` | Sync 模式 HTTP 超时（秒），大文件可适当增大 |
| `MINERU_ASYNC_POLL_INTERVAL` | `2.0` | Async 模式轮询间隔（秒） |
| `MINERU_ASYNC_MAX_WAIT` | `600` | Async 模式最大等待时间（秒） |
| `MINERU_FALLBACK_ON_ERROR` | `true` | 出错时是否回退到本地引擎（pypdf/Docling） |

**`MINERU_BACKEND` 取值：**

| 值 | 说明 |
|----|------|
| `pipeline` | 通用多语言，无幻觉风险 |
| `vlm-auto-engine` | 本地 GPU 高精度（仅支持中英文） |
| `vlm-http-client` | 远程 VLM 服务器高精度（仅支持中英文） |
| `hybrid-auto-engine` | 新一代本地 GPU 高精度，多语言支持 **（默认）** |
| `hybrid-http-client` | 远程 VLM + 本地版面分析，多语言支持 |

以上配置均可通过知识库设置页面或 `PUT /kbs/{kb_id}/settings` 接口按知识库单独覆盖。

---

## 许可证

MIT License。见 [LICENSE](LICENSE)。

本项目是 [HKUDS/LightRAG](https://github.com/HKUDS/LightRAG)（MIT）的衍生作品。  
图谱 RAG 算法详见论文 [arXiv:2410.05779](https://arxiv.org/abs/2410.05779)。
