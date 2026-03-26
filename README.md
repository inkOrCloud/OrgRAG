<div align="center">
<img src="./assets/logo.png" width="100" height="100" alt="LightRAG Logo" style="border-radius: 20px;">

# LightRAG

**Graph-Based Retrieval-Augmented Generation — Enterprise Edition**

[![Python](https://img.shields.io/badge/Python-3.10+-4ecdc4?style=flat-square&logo=python)](https://www.python.org/)
[![PyPI](https://img.shields.io/pypi/v/lightrag-hku.svg?style=flat-square&logo=pypi)](https://pypi.org/project/lightrag-hku/)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)
[![arXiv](https://img.shields.io/badge/arXiv-2410.05779-red?style=flat-square)](https://arxiv.org/abs/2410.05779)

[English](README.md) · [中文](README-zh.md) · [API Server Docs](lightrag/api/README.md)

</div>

---

## Overview

LightRAG is a graph-based Retrieval-Augmented Generation framework. This repository is a production-grade derivative of [HKUDS/LightRAG](https://github.com/HKUDS/LightRAG), built on top of the same graph-RAG core engine and extended with a complete server platform:

| Layer | What's here |
|-------|------------|
| **Core engine** | Graph-based entity/relation extraction, multi-mode retrieval (local · global · hybrid · mix · naive) |
| **API server** | FastAPI server with 58+ REST endpoints, multi-KB routing, JWT auth, streaming |
| **Management** | Multi-knowledge-base system, user & role management, organization hierarchy |
| **WebUI** | React 19 + Sigma.js graph visualization, document manager, retrieval testing, 11 languages |
| **Integrations** | 7 LLM bindings, 7 embedding bindings, 23 storage implementations, 4 rerank providers |

---

## What's New vs. Upstream LightRAG

| Feature | Upstream | This repo |
|---------|----------|-----------|
| Knowledge bases | Single | **Multi-KB** (unlimited, per-request routing via `X-KB-ID`) |
| User management | — | **Full user system** (admin / user / guest roles) |
| Organization management | — | **Tree-structure orgs** with member roles and KB permissions |
| Authentication | API Key only | **JWT Bearer + API Key** dual auth, bcrypt passwords |
| Chat sessions | — | **Persistent chat history** per user per KB |
| API surface | ~10 endpoints | **58 REST endpoints** across 9 modules |
| WebUI | Basic | **Full WebUI**: graph viewer, document manager, retrieval testing |
| Languages | 1 | **11 UI languages** |

---

## Table of Contents

- [Quick Start](#quick-start)
- [Core Python Library](#core-python-library)
- [Query Modes](#query-modes)
- [API Server & WebUI](#api-server--webui)
- [Multi-Knowledge-Base System](#multi-knowledge-base-system)
- [Authentication](#authentication)
- [Storage Backends](#storage-backends)
- [LLM & Embedding Bindings](#llm--embedding-bindings)
- [WebUI Features](#webui-features)
- [Development](#development)

---

## Quick Start

### Install

```bash
# API server + WebUI (recommended)
pip install "lightrag-hku[api]"

# Core library only
pip install lightrag-hku
```

### Configure

```bash
cp env.example .env
# Edit .env with your LLM and embedding settings
```

Minimal `.env` for OpenAI:

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

Minimal `.env` for Ollama:

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

### Start the Server

```bash
lightrag-server                        # single-process (Uvicorn)
lightrag-gunicorn --workers 4          # multi-process (production)
```

Open **http://localhost:9621** for the WebUI, or **http://localhost:9621/docs** for Swagger UI.

---

## Core Python Library

LightRAG can be used as a Python library independently of the server.

### Initialization

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
    await rag.initialize_storages()  # required

    await rag.ainsert("Your document text here...")
    result = await rag.aquery("Your question?", param=QueryParam(mode="hybrid"))
    print(result)

    await rag.finalize_storages()

asyncio.run(main())
```

> **Critical**: Always call `await rag.initialize_storages()` before use and `await rag.finalize_storages()` on shutdown.

### Document Insertion

```python
# Single document
await rag.ainsert("Text content")

# Batch insertion
await rag.ainsert(["Doc 1", "Doc 2", "Doc 3"])

# With custom IDs (idempotent re-insert)
await rag.ainsert(["Text"], ids=["my-doc-001"])

# With file paths (used for citations in responses)
await rag.ainsert(["Text 1", "Text 2"], file_paths=["doc1.pdf", "doc2.pdf"])
```

### Querying

```python
from lightrag import QueryParam

result = await rag.aquery(
    "What is LightRAG?",
    param=QueryParam(
        mode="mix",            # local | global | hybrid | naive | mix
        top_k=60,              # KG entities/relations to retrieve
        chunk_top_k=20,        # text chunks to retrieve
        max_total_tokens=30000,
        enable_rerank=True,
        include_references=True,
        include_chunk_content=False,
        stream=False,
    )
)
```

### Custom LLM / Embedding Functions

```python
from lightrag.llm.openai import openai_complete_if_cache, openai_embed
from lightrag.utils import wrap_embedding_func_with_attrs
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

## Query Modes

| Mode | Description | Best for |
|------|-------------|----------|
| `local` | Entity-focused retrieval from local subgraph | Specific entity questions |
| `global` | Community-level summary retrieval | Broad thematic questions |
| `hybrid` | local + global combined | General purpose |
| `naive` | Direct vector similarity search (no graph) | Simple factual lookup |
| `mix` | local + global + naive, optionally reranked | **Recommended with reranker** |
| `bypass` | Skip RAG, pass query directly to LLM | Non-RAG conversations |

---

## API Server & WebUI

The included FastAPI server exposes all LightRAG capabilities via REST API and a built-in WebUI.

### Build the WebUI

```bash
cd lightrag_webui
bun install --frozen-lockfile
bun run build
cd ..
```

### Server Endpoints Summary

| Module | Endpoints | Description |
|--------|-----------|-------------|
| **System** | `GET /health`, `GET /auth-status`, `POST /login` | Health check, auth |
| **Query** | `POST /query`, `POST /query/stream`, `POST /query/data` | RAG queries |
| **Documents** | 15 endpoints under `/documents/*` | Upload, manage, monitor |
| **Graph** | 10 endpoints under `/graph/*`, `GET /graphs` | KG visualization & editing |
| **Knowledge Bases** | 10 endpoints under `/kbs/*` | Multi-KB management |
| **Chat Sessions** | 4 endpoints under `/chat/*` | Persistent conversations |
| **Users** | 7 endpoints under `/users/*` | User management (admin) |
| **Organizations** | 13 endpoints under `/orgs/*` | Org hierarchy & permissions |
| **Ollama** | 5 endpoints under `/api/*` | Ollama-compatible interface |

Full API documentation: [lightrag/api/README.md](lightrag/api/README.md) or Swagger UI at `/docs`.

---

## Multi-Knowledge-Base System

Each knowledge base (KB) is an independent LightRAG instance with its own graph, vectors, and documents.

### Key Concepts

- **Default KB** — always exists, serves requests without an `X-KB-ID` header
- **Named KBs** — created via API, identified by UUID
- **KB routing** — the `X-KB-ID` request header routes any document/query request to the target KB

### KB Management API

```bash
# List all KBs visible to current user
GET /kbs

# Create a new KB
POST /kbs
{"name": "Product Docs", "description": "..."}

# Route a query to a specific KB
POST /query
X-KB-ID: <kb_uuid>
{"query": "...", "mode": "hybrid"}

# Export/import KB data
GET /kbs/{kb_id}/export
POST /kbs/import
```

---

## Authentication

The server supports two complementary authentication methods.

### API Key

```env
LIGHTRAG_API_KEY=your-secret-key
WHITELIST_PATHS=/health,/api/*
```

Pass via header: `X-API-Key: your-secret-key`

### JWT (Bearer Token)

```env
AUTH_ACCOUNTS=admin:{bcrypt}$2b$12$...,editor:plaintext-password
TOKEN_SECRET=your-signing-secret
TOKEN_EXPIRE_HOURS=24
```

Generate a bcrypt password entry:
```bash
lightrag-hash-password --username admin
```

Login and use the token:
```bash
# Login
curl -X POST http://localhost:9621/login \
  -d "username=admin&password=secret"
# Returns: {"access_token": "eyJ...", "token_type": "bearer"}

# Use token
curl http://localhost:9621/query \
  -H "Authorization: Bearer eyJ..." \
  -H "Content-Type: application/json" \
  -d '{"query": "...", "mode": "hybrid"}'
```

### User Roles

| Role | Capabilities |
|------|-------------|
| `admin` | Full access: user management, org management, all KBs |
| `user` | Access to assigned KBs, own chat sessions |
| `guest` | Read-only when auth is disabled |

---

## Storage Backends

LightRAG uses four storage types. Each has multiple backend implementations.

### KV Storage (chunks, LLM cache, doc info)

| Backend | Class | Notes |
|---------|-------|-------|
| JSON files | `JsonKVStorage` | **Default**, no setup |
| Redis | `RedisKVStorage` | Production caching |
| MongoDB | `MongoKVStorage` | Document store |
| PostgreSQL | `PGKVStorage` | Relational DB |
| OpenSearch | `OpenSearchKVStorage` | Search-native |

### Vector Storage (entity/relation/chunk embeddings)

| Backend | Class | Notes |
|---------|-------|-------|
| NanoVectorDB | `NanoVectorDBStorage` | **Default**, file-based |
| FAISS | `FaissVectorDBStorage` | High-performance local |
| Milvus | `MilvusVectorDBStorage` | Scalable vector DB |
| Qdrant | `QdrantVectorDBStorage` | Multitenancy support |
| MongoDB | `MongoVectorDBStorage` | Integrated with Mongo |
| PostgreSQL+pgvector | `PGVectorStorage` | SQL + vector |
| OpenSearch | `OpenSearchVectorDBStorage` | Search + vector |

### Graph Storage (entity-relation graph)

| Backend | Class | Notes |
|---------|-------|-------|
| NetworkX | `NetworkXStorage` | **Default**, in-memory |
| Neo4j | `Neo4JStorage` | Native graph DB |
| Memgraph | `MemgraphStorage` | In-memory graph DB |
| MongoDB | `MongoGraphStorage` | Document-based graph |
| PostgreSQL | `PGGraphStorage` | Relational graph |
| OpenSearch | `OpenSearchGraphStorage` | Search-native |

### Document Status Storage

| Backend | Class |
|---------|-------|
| JSON files | `JsonDocStatusStorage` |
| Redis | `RedisDocStatusStorage` |
| MongoDB | `MongoDocStatusStorage` |
| PostgreSQL | `PGDocStatusStorage` |
| OpenSearch | `OpenSearchDocStatusStorage` |

### Configuring Storage

```env
LIGHTRAG_KV_STORAGE=PGKVStorage
LIGHTRAG_VECTOR_STORAGE=PGVectorStorage
LIGHTRAG_GRAPH_STORAGE=Neo4JStorage
LIGHTRAG_DOC_STATUS_STORAGE=PGDocStatusStorage
```

> ⚠️ Storage type cannot be changed after documents have been inserted. Embedding model changes require clearing vector storage.

---

## LLM & Embedding Bindings

### LLM Bindings (`LLM_BINDING`)

| Binding | Value | Notes |
|---------|-------|-------|
| OpenAI / OpenAI-compatible | `openai` | GPT-4o, vLLM, SGLang, LiteLLM… |
| Ollama | `ollama` | Local models, set `OLLAMA_LLM_NUM_CTX≥32768` |
| Azure OpenAI | `azure_openai` | Enterprise Azure deployment |
| Google Gemini | `gemini` | Gemini 1.5 / 2.0 models |
| AWS Bedrock | `aws_bedrock` | Claude, Titan… via AWS |
| LoLLMs | `lollms` | Local LoLLMs server |

### Embedding Bindings (`EMBEDDING_BINDING`)

| Binding | Value | Recommended models |
|---------|-------|--------------------|
| OpenAI | `openai` | `text-embedding-3-large` (3072d), `text-embedding-3-small` (1536d) |
| Ollama | `ollama` | `bge-m3:latest` (1024d) |
| Azure OpenAI | `azure_openai` | Azure embedding deployments |
| Google Gemini | `gemini` | `text-embedding-004` |
| Jina | `jina` | `jina-embeddings-v3` |
| AWS Bedrock | `aws_bedrock` | Titan embeddings |
| LoLLMs | `lollms` | Local server |

### Rerank Providers (`RERANK_BINDING`)

| Provider | Value | Notes |
|----------|-------|-------|
| Cohere / vLLM | `cohere` | `BAAI/bge-reranker-v2-m3` via vLLM |
| Jina | `jina` | `jina-reranker-v2-base-multilingual` |
| Aliyun | `aliyun` | `gte-rerank-v2` |
| None | `null` | Disable reranking |

---

## WebUI Features

The built-in WebUI (React 19 + TypeScript + Tailwind CSS) provides:

### Document Manager
- Upload files via drag-and-drop (supports TXT, MD, PDF, DOCX, PPTX, XLSX, HTML, code files, etc.)
- View processing status (pending / processing / processed / failed) with pagination
- Scan input directory, retry failed documents, clear LLM cache
- Real-time pipeline status monitoring

### Knowledge Graph Viewer
- Interactive visualization powered by **Sigma.js**
- 26 entity types with distinct colors
- Layout algorithms: circular, force-atlas2, force-directed, circle-pack, random, no-overlap
- Node/relation editing, entity merge, subgraph search
- Fullscreen mode, minimap, zoom/rotate controls

### Retrieval Testing
- Query interface supporting all 6 query modes
- Configurable parameters: top_k, chunk_top_k, max tokens, history turns
- Streaming output, markdown rendering with math (KaTeX) and diagram (Mermaid) support
- Chat history with copy and timing display

### Internationalization
Supports 11 languages: **English, 简体中文, 繁體中文, Français, Deutsch, 日本語, 한국어, Русский, Українська, العربية, Tiếng Việt**

---

## Development

### Setup

```bash
git clone https://github.com/HKUDS/LightRAG.git
cd LightRAG

# Python environment
uv sync --extra api --extra test
source .venv/bin/activate

# WebUI
cd lightrag_webui
bun install --frozen-lockfile
bun run dev       # dev server at http://localhost:5173
cd ..
```

### Run Tests

```bash
# Offline tests only (default)
python -m pytest tests

# With integration tests (requires external services)
LIGHTRAG_RUN_INTEGRATION=true python -m pytest tests

# Specific test
python test_graph_storage.py
```

### Lint

```bash
ruff check .
```

### Build WebUI for Production

```bash
cd lightrag_webui
bun run build
cd ..
lightrag-server   # WebUI served at http://localhost:9621
```

### Multiple Instances

```bash
lightrag-server --port 9621 --workspace project_a
lightrag-server --port 9622 --workspace project_b
```

### Docker

```bash
docker compose up
```

See [docs/DockerDeployment.md](docs/DockerDeployment.md) for details.

---

## Configuration Reference

Key environment variables. See `env.example` for the full list.

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST` | `0.0.0.0` | Listen address |
| `PORT` | `9621` | Listen port |
| `WORKERS` | `2` | Gunicorn worker count |
| `WORKING_DIR` | `./rag_storage` | RAG data directory |
| `INPUT_DIR` | `./inputs` | File scan directory |
| `WORKSPACE` | *(empty)* | Data isolation namespace |

### LLM

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_BINDING` | `ollama` | LLM backend |
| `LLM_MODEL` | — | Model name |
| `LLM_BINDING_HOST` | — | API endpoint |
| `LLM_BINDING_API_KEY` | — | API key |
| `MAX_ASYNC` | `4` | Max concurrent LLM requests |
| `TIMEOUT` | `150` | LLM request timeout (seconds) |

### Embedding

| Variable | Default | Description |
|----------|---------|-------------|
| `EMBEDDING_BINDING` | `ollama` | Embedding backend |
| `EMBEDDING_MODEL` | — | Model name |
| `EMBEDDING_DIM` | — | Embedding dimensions |
| `EMBEDDING_BINDING_HOST` | — | API endpoint |

### Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `LIGHTRAG_API_KEY` | *(none)* | Static API key |
| `WHITELIST_PATHS` | `/health,/api/*` | Paths exempt from auth |
| `AUTH_ACCOUNTS` | *(none)* | `user:{bcrypt}hash,...` pairs |
| `TOKEN_SECRET` | *(random)* | JWT signing secret |
| `TOKEN_EXPIRE_HOURS` | `24` | JWT token lifetime |

### Query Defaults

| Variable | Default | Description |
|----------|---------|-------------|
| `TOP_K` | `60` | KG entities/relations retrieved |
| `CHUNK_TOP_K` | `20` | Text chunks retrieved |
| `MAX_TOTAL_TOKENS` | `30000` | Context window limit |
| `RERANK_BINDING` | *(none)* | Rerank provider |
| `RERANK_BY_DEFAULT` | `true` | Enable rerank by default |

### Document Processing

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_PARALLEL_INSERT` | `2` | Files processed in parallel |
| `ENABLE_LLM_CACHE_FOR_EXTRACT` | `true` | Cache extraction LLM calls |
| `SUMMARY_LANGUAGE` | `English` | Entity summary language |

---

## License

MIT License. See [LICENSE](LICENSE).

This project is a derivative of [HKUDS/LightRAG](https://github.com/HKUDS/LightRAG) (MIT).
The graph-RAG algorithm is described in [arXiv:2410.05779](https://arxiv.org/abs/2410.05779).
