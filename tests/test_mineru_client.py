"""Unit tests for lightrag.api.mineru_client.

All tests are offline (no real MinerU service required).  HTTP calls are
intercepted with unittest.mock so the suite runs without any network access.

Test areas:
  - _extract_markdown: response-parsing helper
  - _extract_task_id / _extract_task_status: response-parsing helpers
  - MinerUClient.health_check: reachable / unreachable
  - MinerUClient._parse_sync: success, HTTP error, non-200 status
  - MinerUClient._parse_async: success flow, task failure, timeout
  - MinerUConfig: defaults and field values
  - _get_effective_mineru_config: KB-level override logic (document_routes)
  - _extract_with_mineru: fallback-on-error behaviour (document_routes)
"""

from __future__ import annotations

import sys

# Override sys.argv before any lightrag imports so that config.parse_args()
# (which is triggered lazily on first attribute access) doesn't interpret
# pytest arguments as unknown command-line flags.
sys.argv = ["lightrag-server"]

from pathlib import Path  # noqa: E402
from unittest.mock import AsyncMock, MagicMock, patch  # noqa: E402

import pytest  # noqa: E402

from lightrag.api.mineru_client import (  # noqa: E402
    MinerUClient,
    MinerUConfig,
    MinerUError,
    _extract_markdown,
    _extract_task_id,
    _extract_task_status,
)

# ── Fixtures ──────────────────────────────────────────────────────────────────

SAMPLE_PDF_BYTES = b"%PDF-1.4 fake content"
SAMPLE_PATH = Path("report.pdf")
SAMPLE_MARKDOWN = "# Title\n\nSome content."


def _make_cfg(**kwargs) -> MinerUConfig:
    defaults = dict(
        enabled=True,
        base_url="http://mineru.test:28080",
        mode="sync",
        backend="hybrid-auto-engine",
        parse_method="auto",
        lang_list=["ch"],
        formula_enable=True,
        table_enable=True,
        timeout=30,
        async_poll_interval=0.01,
        async_max_wait=1,
        fallback_on_error=True,
    )
    defaults.update(kwargs)
    return MinerUConfig(**defaults)


def _mock_response(status: int, json_body=None, text_body: str = ""):
    """Build a fake aiohttp response usable as an async context manager."""
    resp = MagicMock()
    resp.status = status
    resp.json = AsyncMock(return_value=json_body)
    resp.text = AsyncMock(return_value=text_body)
    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=resp)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return ctx


def _make_mock_session(**http_method_kwargs) -> MagicMock:
    """Return a MagicMock that passes isinstance checks as aiohttp.ClientSession.

    ``close`` is an AsyncMock so that ``await session.close()`` works inside
    ``MinerUClient.__aexit__``.  Extra keyword arguments set named attributes on
    the session mock, e.g. ``get=MagicMock(return_value=...)``.
    """
    session = MagicMock()
    session.close = AsyncMock()
    for attr, value in http_method_kwargs.items():
        setattr(session, attr, value)
    return session


# ── _extract_markdown ─────────────────────────────────────────────────────────


@pytest.mark.offline
def test_extract_markdown_list_md_content():
    result = _extract_markdown([{"md_content": "# Hello"}])
    assert result == "# Hello"


@pytest.mark.offline
def test_extract_markdown_list_multiple_files():
    result = _extract_markdown(
        [{"md_content": "Part A"}, {"md_content": "Part B"}]
    )
    assert "Part A" in result
    assert "Part B" in result


@pytest.mark.offline
def test_extract_markdown_dict_fallback_keys():
    assert _extract_markdown({"markdown": "MD"}) == "MD"
    assert _extract_markdown({"content": "CT"}) == "CT"


@pytest.mark.offline
def test_extract_markdown_empty_and_none():
    assert _extract_markdown([]) == ""
    assert _extract_markdown(None) == ""
    assert _extract_markdown({}) == ""
    assert _extract_markdown([{"other_key": "ignored"}]) == ""


@pytest.mark.offline
def test_extract_markdown_strips_whitespace():
    result = _extract_markdown([{"md_content": "  hello  "}])
    assert result == "hello"


@pytest.mark.offline
def test_extract_markdown_mineru_307_results_format():
    """MinerU 3.0.7+ wraps per-file content under a top-level 'results' dict."""
    response = {
        "task_id": "c7bb8bcd",
        "status": "completed",
        "file_names": ["report"],
        "results": {
            "report": {"md_content": "# Hello MinerU"}
        },
    }
    assert _extract_markdown(response) == "# Hello MinerU"


@pytest.mark.offline
def test_extract_markdown_mineru_307_multiple_files():
    """Multiple files in results dict are joined with blank lines."""
    response = {
        "results": {
            "file_a": {"md_content": "Part A"},
            "file_b": {"md_content": "Part B"},
        }
    }
    result = _extract_markdown(response)
    assert "Part A" in result
    assert "Part B" in result


@pytest.mark.offline
def test_extract_markdown_mineru_307_empty_results():
    """Empty results dict yields empty string, not a crash."""
    assert _extract_markdown({"results": {}}) == ""
    assert _extract_markdown({"results": {"f": {}}}) == ""


@pytest.mark.offline
def test_extract_markdown_mineru_307_fallback_keys():
    """Per-file entries may use 'markdown' or 'content' instead of 'md_content'."""
    assert _extract_markdown({"results": {"f": {"markdown": "MD"}}}) == "MD"
    assert _extract_markdown({"results": {"f": {"content": "CT"}}}) == "CT"


# ── _extract_task_id / _extract_task_status ───────────────────────────────────


@pytest.mark.offline
def test_extract_task_id_primary_key():
    assert _extract_task_id({"task_id": "abc-123"}) == "abc-123"


@pytest.mark.offline
def test_extract_task_id_fallback_keys():
    assert _extract_task_id({"taskId": "T1"}) == "T1"
    assert _extract_task_id({"id": "T2"}) == "T2"


@pytest.mark.offline
def test_extract_task_id_missing():
    assert _extract_task_id({}) == ""
    assert _extract_task_id([]) == ""


@pytest.mark.offline
def test_extract_task_status_variants():
    assert _extract_task_status({"status": "done"}) == "done"
    assert _extract_task_status({"state": "processing"}) == "processing"
    assert _extract_task_status({"task_status": "failed"}) == "failed"
    assert _extract_task_status({}) == ""


# ── MinerUConfig defaults ─────────────────────────────────────────────────────


@pytest.mark.offline
def test_mineru_config_defaults():
    cfg = MinerUConfig()
    assert cfg.enabled is False
    assert cfg.base_url == "http://localhost:28080"
    assert cfg.mode == "sync"
    assert cfg.backend == "hybrid-auto-engine"
    assert cfg.lang_list == ["ch"]
    assert cfg.timeout == 300
    assert cfg.fallback_on_error is True


# ── health_check ──────────────────────────────────────────────────────────────


@pytest.mark.offline
@pytest.mark.asyncio
async def test_health_check_ok():
    cfg = _make_cfg()
    mock_session = _make_mock_session(get=MagicMock(return_value=_mock_response(200)))
    with patch("lightrag.api.mineru_client.aiohttp.ClientSession", return_value=mock_session):
        async with MinerUClient(cfg) as client:
            assert await client.health_check() is True


@pytest.mark.offline
@pytest.mark.asyncio
async def test_health_check_non_200():
    cfg = _make_cfg()
    mock_session = _make_mock_session(get=MagicMock(return_value=_mock_response(503)))
    with patch("lightrag.api.mineru_client.aiohttp.ClientSession", return_value=mock_session):
        async with MinerUClient(cfg) as client:
            assert await client.health_check() is False


@pytest.mark.offline
@pytest.mark.asyncio
async def test_health_check_connection_error():
    cfg = _make_cfg()
    mock_session = _make_mock_session(
        get=MagicMock(side_effect=Exception("connection refused"))
    )
    with patch("lightrag.api.mineru_client.aiohttp.ClientSession", return_value=mock_session):
        async with MinerUClient(cfg) as client:
            assert await client.health_check() is False


# ── _parse_sync ───────────────────────────────────────────────────────────────


@pytest.mark.offline
@pytest.mark.asyncio
async def test_parse_sync_success():
    cfg = _make_cfg(mode="sync")
    payload = [{"md_content": SAMPLE_MARKDOWN}]
    mock_session = _make_mock_session(
        post=MagicMock(return_value=_mock_response(200, payload))
    )
    with patch("lightrag.api.mineru_client.aiohttp.ClientSession", return_value=mock_session):
        async with MinerUClient(cfg) as client:
            result = await client.parse(SAMPLE_PATH, SAMPLE_PDF_BYTES)
    assert result == SAMPLE_MARKDOWN


@pytest.mark.offline
@pytest.mark.asyncio
async def test_parse_sync_http_error_raises():
    cfg = _make_cfg(mode="sync")
    mock_session = _make_mock_session(
        post=MagicMock(return_value=_mock_response(500, text_body="Internal Server Error"))
    )
    with patch("lightrag.api.mineru_client.aiohttp.ClientSession", return_value=mock_session):
        async with MinerUClient(cfg) as client:
            with pytest.raises(MinerUError, match="HTTP 500"):
                await client.parse(SAMPLE_PATH, SAMPLE_PDF_BYTES)


@pytest.mark.offline
@pytest.mark.asyncio
async def test_parse_sync_empty_response():
    cfg = _make_cfg(mode="sync")
    mock_session = _make_mock_session(
        post=MagicMock(return_value=_mock_response(200, []))
    )
    with patch("lightrag.api.mineru_client.aiohttp.ClientSession", return_value=mock_session):
        async with MinerUClient(cfg) as client:
            result = await client.parse(SAMPLE_PATH, SAMPLE_PDF_BYTES)
    assert result == ""


# ── _parse_async ──────────────────────────────────────────────────────────────


@pytest.mark.offline
@pytest.mark.asyncio
async def test_parse_async_success():
    cfg = _make_cfg(mode="async", async_poll_interval=0.01, async_max_wait=5)
    task_id = "task-xyz"
    result_payload = [{"md_content": SAMPLE_MARKDOWN}]

    submit_resp = _mock_response(202, {"task_id": task_id})
    status_resp = _mock_response(200, {"status": "done"})
    result_resp = _mock_response(200, result_payload)

    def _get_side_effect(url, **kwargs):
        if f"/tasks/{task_id}/result" in url:
            return result_resp
        return status_resp

    mock_session = _make_mock_session(
        post=MagicMock(return_value=submit_resp),
        get=MagicMock(side_effect=_get_side_effect),
    )
    with patch("lightrag.api.mineru_client.aiohttp.ClientSession", return_value=mock_session):
        async with MinerUClient(cfg) as client:
            content = await client.parse(SAMPLE_PATH, SAMPLE_PDF_BYTES)
    assert content == SAMPLE_MARKDOWN


@pytest.mark.offline
@pytest.mark.asyncio
async def test_parse_async_task_failure_raises():
    cfg = _make_cfg(mode="async", async_poll_interval=0.01, async_max_wait=5)
    task_id = "task-fail"
    mock_session = _make_mock_session(
        post=MagicMock(return_value=_mock_response(202, {"task_id": task_id})),
        get=MagicMock(return_value=_mock_response(200, {"status": "failed"})),
    )
    with patch("lightrag.api.mineru_client.aiohttp.ClientSession", return_value=mock_session):
        async with MinerUClient(cfg) as client:
            with pytest.raises(MinerUError, match="failure status"):
                await client.parse(SAMPLE_PATH, SAMPLE_PDF_BYTES)


@pytest.mark.offline
@pytest.mark.asyncio
async def test_parse_async_timeout_raises():
    cfg = _make_cfg(mode="async", async_poll_interval=0.01, async_max_wait=0.02)
    task_id = "task-slow"
    mock_session = _make_mock_session(
        post=MagicMock(return_value=_mock_response(202, {"task_id": task_id})),
        # Always return "processing" → never completes within max_wait
        get=MagicMock(return_value=_mock_response(200, {"status": "processing"})),
    )
    with patch("lightrag.api.mineru_client.aiohttp.ClientSession", return_value=mock_session):
        async with MinerUClient(cfg) as client:
            with pytest.raises(MinerUError, match="did not finish"):
                await client.parse(SAMPLE_PATH, SAMPLE_PDF_BYTES)


@pytest.mark.offline
@pytest.mark.asyncio
async def test_parse_async_missing_task_id_raises():
    cfg = _make_cfg(mode="async")
    mock_session = _make_mock_session(
        post=MagicMock(return_value=_mock_response(202, {"other_field": "no_id_here"}))
    )
    with patch("lightrag.api.mineru_client.aiohttp.ClientSession", return_value=mock_session):
        async with MinerUClient(cfg) as client:
            with pytest.raises(MinerUError, match="missing task_id"):
                await client.parse(SAMPLE_PATH, SAMPLE_PDF_BYTES)


# ── Context manager guard ─────────────────────────────────────────────────────


@pytest.mark.offline
@pytest.mark.asyncio
async def test_require_session_raises_outside_context():
    cfg = _make_cfg()
    client = MinerUClient(cfg)  # not used as context manager
    with pytest.raises(RuntimeError, match="async context manager"):
        client._require_session()


# ── _get_effective_mineru_config (document_routes integration) ────────────────


@pytest.mark.offline
def test_get_effective_mineru_config_defaults():
    """Config function returns defaults from global_args when no KB overrides."""
    from lightrag.api.routers.document_routes import _get_effective_mineru_config

    with patch(
        "lightrag.api.routers.document_routes.global_args",
        mineru_enabled=False,
        mineru_base_url="http://default:28080",
        mineru_mode="sync",
        mineru_backend="hybrid-auto-engine",
        mineru_parse_method="auto",
        mineru_lang_list=["ch"],
        mineru_formula_enable=True,
        mineru_table_enable=True,
        mineru_timeout=300,
        mineru_async_poll_interval=2.0,
        mineru_async_max_wait=600,
        mineru_fallback_on_error=True,
    ):
        cfg = _get_effective_mineru_config(None)

    assert cfg["enabled"] is False
    assert cfg["base_url"] == "http://default:28080"
    assert cfg["lang_list"] == ["ch"]
    assert cfg["fallback_on_error"] is True


@pytest.mark.offline
def test_get_effective_mineru_config_kb_override():
    """Per-KB settings override global_args values."""
    from lightrag.api.routers.document_routes import _get_effective_mineru_config

    with patch(
        "lightrag.api.routers.document_routes.global_args",
        mineru_enabled=False,
        mineru_base_url="http://global:28080",
        mineru_mode="sync",
        mineru_backend="pipeline",
        mineru_parse_method="auto",
        mineru_lang_list=["ch"],
        mineru_formula_enable=True,
        mineru_table_enable=True,
        mineru_timeout=300,
        mineru_async_poll_interval=2.0,
        mineru_async_max_wait=600,
        mineru_fallback_on_error=True,
    ):
        kb_settings = {
            "mineru_enabled": True,
            "mineru_base_url": "http://kb-specific:28080",
            "mineru_backend": "vlm-auto-engine",
            "mineru_lang_list": ["en"],
        }
        cfg = _get_effective_mineru_config(kb_settings)

    assert cfg["enabled"] is True
    assert cfg["base_url"] == "http://kb-specific:28080"
    assert cfg["backend"] == "vlm-auto-engine"
    assert cfg["lang_list"] == ["en"]
    # Non-overridden fields still come from global_args
    assert cfg["parse_method"] == "auto"


# ── _extract_with_mineru (document_routes integration) ───────────────────────


# ── Shared helper for _extract_with_mineru tests ──────────────────────────────

_EXTRACT_CFG = {
    "enabled": True,
    "base_url": "http://mineru.test",
    "mode": "sync",
    "backend": "hybrid-auto-engine",
    "parse_method": "auto",
    "lang_list": ["ch"],
    "formula_enable": True,
    "table_enable": True,
    "timeout": 30,
    "async_poll_interval": 0.01,
    "async_max_wait": 5,
    "fallback_on_error": True,
    "_config_cls": MinerUConfig,
}


def _make_extract_cfg(**overrides) -> dict:
    return {**_EXTRACT_CFG, **overrides}


def _make_mineru_mock_client(health: bool = True, parse_result=SAMPLE_MARKDOWN):
    """Build an AsyncMock that mimics MinerUClient as a context manager."""
    mock_client = AsyncMock()
    mock_client.health_check = AsyncMock(return_value=health)
    if isinstance(parse_result, Exception):
        mock_client.parse = AsyncMock(side_effect=parse_result)
    else:
        mock_client.parse = AsyncMock(return_value=parse_result)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    return mock_client


# _extract_with_mineru uses `from lightrag.api.mineru_client import MinerUClient`
# inside the function body, so we must patch the class in its source module.
_MINERU_CLIENT_PATCH = "lightrag.api.mineru_client.MinerUClient"


@pytest.mark.offline
@pytest.mark.asyncio
async def test_extract_with_mineru_success():
    """Returns Markdown when MinerU is healthy and returns content."""
    from lightrag.api.routers.document_routes import _extract_with_mineru

    mock_client = _make_mineru_mock_client(health=True, parse_result=SAMPLE_MARKDOWN)
    with patch(_MINERU_CLIENT_PATCH, return_value=mock_client):
        result = await _extract_with_mineru(
            SAMPLE_PATH, SAMPLE_PDF_BYTES, _make_extract_cfg()
        )
    assert result == SAMPLE_MARKDOWN


@pytest.mark.offline
@pytest.mark.asyncio
async def test_extract_with_mineru_unhealthy_fallback():
    """Returns empty string when service is unreachable and fallback_on_error=True."""
    from lightrag.api.routers.document_routes import _extract_with_mineru

    mock_client = _make_mineru_mock_client(health=False)
    with patch(_MINERU_CLIENT_PATCH, return_value=mock_client):
        result = await _extract_with_mineru(
            SAMPLE_PATH, SAMPLE_PDF_BYTES, _make_extract_cfg(fallback_on_error=True)
        )
    assert result == ""


@pytest.mark.offline
@pytest.mark.asyncio
async def test_extract_with_mineru_unhealthy_no_fallback_raises():
    """Raises MinerUError when service is unreachable and fallback_on_error=False."""
    from lightrag.api.routers.document_routes import _extract_with_mineru

    mock_client = _make_mineru_mock_client(health=False)
    with patch(_MINERU_CLIENT_PATCH, return_value=mock_client):
        with pytest.raises(MinerUError):
            await _extract_with_mineru(
                SAMPLE_PATH, SAMPLE_PDF_BYTES, _make_extract_cfg(fallback_on_error=False)
            )


@pytest.mark.offline
@pytest.mark.asyncio
async def test_extract_with_mineru_empty_content_fallback():
    """Returns empty string when MinerU returns empty Markdown and fallback is on."""
    from lightrag.api.routers.document_routes import _extract_with_mineru

    mock_client = _make_mineru_mock_client(health=True, parse_result="")
    with patch(_MINERU_CLIENT_PATCH, return_value=mock_client):
        result = await _extract_with_mineru(
            SAMPLE_PATH, SAMPLE_PDF_BYTES, _make_extract_cfg(fallback_on_error=True)
        )
    assert result == ""


@pytest.mark.offline
@pytest.mark.asyncio
async def test_extract_with_mineru_exception_fallback():
    """Returns empty string on unexpected exception when fallback_on_error=True."""
    from lightrag.api.routers.document_routes import _extract_with_mineru

    mock_client = _make_mineru_mock_client(
        health=True, parse_result=ConnectionError("network down")
    )
    with patch(_MINERU_CLIENT_PATCH, return_value=mock_client):
        result = await _extract_with_mineru(
            SAMPLE_PATH, SAMPLE_PDF_BYTES, _make_extract_cfg(fallback_on_error=True)
        )
    assert result == ""
