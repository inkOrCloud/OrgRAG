"""MinerU WebAPI client for high-accuracy document parsing.

MinerU converts PDF and image files into Markdown text using layout analysis,
OCR, and optional VLM backends.  Two call modes are supported:

  sync  – POST /file_parse and wait for the response in a single HTTP request.
  async – POST /tasks to get a task_id, poll GET /tasks/{id} until done,
          then fetch the result from GET /tasks/{id}/result.

Example::

    from pathlib import Path
    from lightrag.api.mineru_client import MinerUClient, MinerUConfig

    cfg = MinerUConfig(base_url="http://192.168.10.170:28080", mode="sync")
    async with MinerUClient(cfg) as client:
        if await client.health_check():
            md = await client.parse(Path("report.pdf"), pdf_bytes)
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import aiohttp

logger = logging.getLogger(__name__)

# Task terminal states (case-insensitive comparison)
_TASK_STATUS_DONE: frozenset[str] = frozenset(
    {"done", "succeeded", "completed", "success"}
)
_TASK_STATUS_FAILED: frozenset[str] = frozenset({"failed", "error", "cancelled"})

# ── Public configuration dataclass ────────────────────────────────────────────


@dataclass
class MinerUConfig:
    """Resolved runtime configuration for a single MinerU parsing session.

    Build instances via :func:`~lightrag.api.routers.document_routes._get_effective_mineru_config`
    so that per-KB overrides are applied on top of the global ``global_args``.
    """

    enabled: bool = False
    base_url: str = "http://localhost:28080"
    mode: str = "sync"  # "sync" | "async"
    backend: str = "hybrid-auto-engine"
    parse_method: str = "auto"  # "auto" | "txt" | "ocr"
    lang_list: list[str] = field(default_factory=lambda: ["ch"])
    formula_enable: bool = True
    table_enable: bool = True
    # sync mode: total HTTP timeout in seconds
    timeout: int = 300
    # async mode: seconds between status-poll requests
    async_poll_interval: float = 2.0
    # async mode: hard ceiling on total wait time in seconds
    async_max_wait: int = 600
    # fall back to the local engine when MinerU returns an error or empty content
    fallback_on_error: bool = True


# ── Exception ─────────────────────────────────────────────────────────────────


class MinerUError(Exception):
    """Raised when the MinerU service returns an unexpected or error response."""


# ── Main client class ─────────────────────────────────────────────────────────


class MinerUClient:
    """Async HTTP client for the MinerU WebAPI document parsing service.

    Must be used as an async context manager so that the underlying
    ``aiohttp.ClientSession`` is properly created and closed::

        async with MinerUClient(cfg) as client:
            markdown = await client.parse(file_path, file_bytes)
    """

    def __init__(self, cfg: MinerUConfig) -> None:
        self._cfg = cfg
        self._session: aiohttp.ClientSession | None = None

    # ── Context manager ───────────────────────────────────────────────────────

    async def __aenter__(self) -> "MinerUClient":
        # Add a small buffer over the configured timeout so the session itself
        # does not time out before the per-request timeout fires.
        total = max(self._cfg.timeout, self._cfg.async_max_wait) + 60
        self._session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=total)
        )
        return self

    async def __aexit__(self, *_: Any) -> None:
        if self._session:
            await self._session.close()
            self._session = None

    # ── Public API ────────────────────────────────────────────────────────────

    async def health_check(self) -> bool:
        """Return True if the MinerU service is reachable and reports healthy."""
        url = f"{self._cfg.base_url.rstrip('/')}/health"
        try:
            session = self._require_session()
            async with session.get(
                url, timeout=aiohttp.ClientTimeout(total=10)
            ) as resp:
                return resp.status == 200
        except Exception as exc:  # noqa: BLE001
            logger.warning("[MinerU] Health check failed: %s", exc)
            return False

    async def parse(self, file_path: Path, file_bytes: bytes) -> str:
        """Parse *file_bytes* and return Markdown text.

        Selects sync or async mode based on :attr:`MinerUConfig.mode`.

        Args:
            file_path: Used for the ``filename`` field in multipart upload.
            file_bytes: Raw binary content of the file.

        Returns:
            Extracted Markdown string (may be empty when the file has no text).

        Raises:
            MinerUError: On HTTP errors or task failures.
        """
        if self._cfg.mode == "async":
            return await self._parse_async(file_path, file_bytes)
        return await self._parse_sync(file_path, file_bytes)

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _require_session(self) -> aiohttp.ClientSession:
        if self._session is None:
            raise RuntimeError(
                "MinerUClient must be used as an async context manager. "
                "Use `async with MinerUClient(cfg) as client: ...`"
            )
        return self._session

    def _build_form_data(self, file_path: Path, file_bytes: bytes) -> aiohttp.FormData:
        """Construct the multipart/form-data payload for a parse request."""
        cfg = self._cfg
        data = aiohttp.FormData()
        data.add_field(
            "files",
            file_bytes,
            filename=file_path.name,
            content_type="application/octet-stream",
        )
        for lang in cfg.lang_list:
            data.add_field("lang_list", lang)
        data.add_field("backend", cfg.backend)
        data.add_field("parse_method", cfg.parse_method)
        data.add_field("formula_enable", str(cfg.formula_enable).lower())
        data.add_field("table_enable", str(cfg.table_enable).lower())
        data.add_field("return_md", "true")
        return data

    async def _parse_sync(self, file_path: Path, file_bytes: bytes) -> str:
        """POST /file_parse and return Markdown (single blocking HTTP call)."""
        url = f"{self._cfg.base_url.rstrip('/')}/file_parse"
        session = self._require_session()
        data = self._build_form_data(file_path, file_bytes)

        logger.info(
            "[MinerU] Sync parse: %s (backend=%s, parse_method=%s)",
            file_path.name,
            self._cfg.backend,
            self._cfg.parse_method,
        )
        async with session.post(
            url, data=data, timeout=aiohttp.ClientTimeout(total=self._cfg.timeout)
        ) as resp:
            if resp.status != 200:
                text = await resp.text()
                raise MinerUError(
                    f"POST /file_parse returned HTTP {resp.status}: {text[:300]}"
                )
            result = await resp.json(content_type=None)

        markdown = _extract_markdown(result)
        logger.info(
            "[MinerU] Sync parse done: %s (%d chars)", file_path.name, len(markdown)
        )
        return markdown

    async def _parse_async(self, file_path: Path, file_bytes: bytes) -> str:
        """POST /tasks → poll status → GET /tasks/{id}/result."""
        cfg = self._cfg
        session = self._require_session()

        # Step 1 – submit task
        submit_url = f"{cfg.base_url.rstrip('/')}/tasks"
        data = self._build_form_data(file_path, file_bytes)

        logger.info(
            "[MinerU] Async submit: %s (backend=%s)", file_path.name, cfg.backend
        )
        async with session.post(
            submit_url, data=data, timeout=aiohttp.ClientTimeout(total=60)
        ) as resp:
            if resp.status not in (200, 202):
                text = await resp.text()
                raise MinerUError(
                    f"POST /tasks returned HTTP {resp.status}: {text[:300]}"
                )
            submit_result = await resp.json(content_type=None)

        task_id = _extract_task_id(submit_result)
        if not task_id:
            raise MinerUError(
                f"POST /tasks response missing task_id field: {submit_result!r:.300}"
            )
        logger.info("[MinerU] Task submitted: task_id=%s", task_id)

        # Step 2 – poll until terminal state
        status_url = f"{cfg.base_url.rstrip('/')}/tasks/{task_id}"
        elapsed = 0.0
        interval = cfg.async_poll_interval

        while elapsed < cfg.async_max_wait:
            await asyncio.sleep(interval)
            elapsed += interval

            async with session.get(
                status_url, timeout=aiohttp.ClientTimeout(total=30)
            ) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    raise MinerUError(
                        f"GET /tasks/{task_id} returned HTTP {resp.status}: {text[:300]}"
                    )
                status_data = await resp.json(content_type=None)

            status = _extract_task_status(status_data)
            logger.debug(
                "[MinerU] task_id=%s status=%s elapsed=%.1fs",
                task_id,
                status,
                elapsed,
            )

            if status.lower() in _TASK_STATUS_DONE:
                break
            if status.lower() in _TASK_STATUS_FAILED:
                raise MinerUError(
                    f"MinerU task {task_id} ended with failure status: {status!r}"
                )
            # Gradual back-off (caps at 15 s)
            interval = min(interval * 1.2, 15.0)
        else:
            raise MinerUError(
                f"MinerU task {task_id} did not finish within {cfg.async_max_wait}s"
            )

        # Step 3 – fetch result
        result_url = f"{cfg.base_url.rstrip('/')}/tasks/{task_id}/result"
        async with session.get(
            result_url, timeout=aiohttp.ClientTimeout(total=60)
        ) as resp:
            if resp.status != 200:
                text = await resp.text()
                raise MinerUError(
                    f"GET /tasks/{task_id}/result returned HTTP {resp.status}: {text[:300]}"
                )
            result = await resp.json(content_type=None)

        markdown = _extract_markdown(result)
        logger.info(
            "[MinerU] Async parse done: task_id=%s (%d chars)", task_id, len(markdown)
        )
        return markdown


# ── Response-parsing utilities (module-level for testability) ─────────────────


def _extract_markdown(response: Any) -> str:
    """Extract Markdown text from a MinerU parse response.

    Handles two response formats:

    * **MinerU ≥ 3.0.7** – the top-level dict contains a ``results`` key
      whose value is a dict keyed by filename (without extension).  Each
      per-file entry has ``md_content`` (and optionally ``markdown`` /
      ``content``) fields::

          {
              "status": "completed",
              "results": {
                  "report": {"md_content": "# Title\\n..."}
              }
          }

    * **Legacy list format** – a list of per-file result dicts, each with
      ``md_content``, ``markdown``, or ``content``::

          [{"md_content": "# Title\\n..."}]

    * **Legacy flat dict format** – a single dict with ``md_content``,
      ``markdown``, or ``content`` at the top level::

          {"md_content": "# Title\\n..."}

    Args:
        response: Parsed JSON value (list, dict, or anything else).

    Returns:
        Concatenated Markdown from all file results, joined by blank lines.
        Returns an empty string when no content is found.
    """
    if not response:
        return ""

    def _md_from_dict(item: dict) -> str:
        md = item.get("md_content") or item.get("markdown") or item.get("content") or ""
        return md.strip() if isinstance(md, str) else ""

    if isinstance(response, list):
        parts: list[str] = []
        for item in response:
            if isinstance(item, dict):
                md = _md_from_dict(item)
                if md:
                    parts.append(md)
        return "\n\n".join(parts)

    if isinstance(response, dict):
        # MinerU 3.0.7+: {"results": {"<filename>": {"md_content": "..."}}}
        results = response.get("results")
        if isinstance(results, dict):
            parts = []
            for file_result in results.values():
                if isinstance(file_result, dict):
                    md = _md_from_dict(file_result)
                    if md:
                        parts.append(md)
            if parts:
                return "\n\n".join(parts)

        # Legacy flat dict: {"md_content": "..."} or {"markdown": "..."}
        return _md_from_dict(response)

    return ""


def _extract_task_id(response: Any) -> str:
    """Extract the task identifier from POST /tasks response."""
    if isinstance(response, dict):
        return (
            response.get("task_id")
            or response.get("taskId")
            or response.get("id")
            or ""
        )
    return ""


def _extract_task_status(response: Any) -> str:
    """Extract the status string from GET /tasks/{id} response."""
    if isinstance(response, dict):
        return (
            response.get("status")
            or response.get("state")
            or response.get("task_status")
            or ""
        )
    return ""
