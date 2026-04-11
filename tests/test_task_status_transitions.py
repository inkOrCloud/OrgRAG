"""Unit tests for manual task-status-switching operations.

Covers the three previously untested API surface areas:
  1. cancel_pipeline      – busy → cancellation_requested; idle → not_busy;
                            EXTRACTING docs → immediately marked FAILED
  2. delete_document      – busy → busy; idle → deletion_started
  3. background_delete_documents – abort-if-busy, success, mid-batch cancel,
                                   per-doc failure, exception resilience
  4. _reprocess_all_failed_background – always calls pipeline after reprocess
  5. reprocess_failed_documents endpoint – enqueues task, returns correct status
  6. pipeline_index_file  – cancellation after extraction skips pipeline and
                            marks newly created PENDING doc as FAILED
  7. apipeline_process_enqueue_documents – skips start when cancellation_requested
                                           is already set (idle-cancel guard)
"""

import sys

sys.argv = ["lightrag-server"]

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import BackgroundTasks
from fastapi.routing import APIRoute

from lightrag.api.routers.document_routes import (
    DeleteDocRequest,
    create_document_routes,
    router as _doc_router,
)

pytestmark = pytest.mark.offline


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


class _FakeLock:
    """Minimal reusable async context-manager standing in for NamespaceLock."""

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        pass


def _make_pipeline_status(busy: bool = False) -> dict:
    return {
        "busy": busy,
        "cancellation_requested": False,
        "latest_message": "",
        "history_messages": [],
        "request_pending": False,
    }


def _make_rag(workspace: str = "test-ws") -> MagicMock:
    rag = MagicMock()
    rag.workspace = workspace
    rag.doc_status = MagicMock()
    rag.doc_status.delete = AsyncMock()
    rag.doc_status.upsert = AsyncMock()
    rag.apipeline_process_enqueue_documents = AsyncMock()
    return rag


def _make_doc_manager(tmp_path: Path) -> MagicMock:
    dm = MagicMock()
    dm.input_dir = tmp_path
    return dm


def _last_endpoint(path: str, method: str = "POST"):
    """Return the most-recently registered handler for *path* on the shared doc router.

    Routes are stored with the router prefix (/documents), so we accept both
    the bare path and the prefixed path for convenience.
    """
    prefixed = f"/documents{path}" if not path.startswith("/documents") else path
    matching = [
        r
        for r in _doc_router.routes
        if isinstance(r, APIRoute)
        and r.path == prefixed
        and method.upper() in r.methods
    ]
    return matching[-1].endpoint if matching else None


def _register(rag, doc_manager):
    """Register a fresh set of route closures on the shared router."""
    create_document_routes(rag, doc_manager, api_key=None)


# ===========================================================================
# 1. cancel_pipeline
# ===========================================================================


class TestCancelPipeline:
    @pytest.mark.asyncio
    async def test_cancel_when_busy_returns_cancellation_requested(
        self, tmp_path, monkeypatch
    ):
        """Pipeline busy → status='cancellation_requested', flag set in pipeline_status."""
        rag = _make_rag()
        _register(rag, _make_doc_manager(tmp_path))
        cancel_fn = _last_endpoint("/cancel_pipeline", "POST")

        pipeline_status = _make_pipeline_status(busy=True)
        monkeypatch.setattr(
            "lightrag.kg.shared_storage.get_namespace_data",
            AsyncMock(return_value=pipeline_status),
        )
        monkeypatch.setattr(
            "lightrag.kg.shared_storage.get_namespace_lock",
            lambda *a, **kw: _FakeLock(),
        )

        result = await cancel_fn()

        assert result.status == "cancellation_requested"
        assert pipeline_status["cancellation_requested"] is True

    @pytest.mark.asyncio
    async def test_cancel_when_idle_returns_not_busy(self, tmp_path, monkeypatch):
        """Pipeline idle with no EXTRACTING docs → status='not_busy', flag not set."""
        rag = _make_rag()
        # cancel_pipeline now checks for EXTRACTING docs even when not busy
        rag.doc_status.get_docs_by_status = AsyncMock(return_value={})
        _register(rag, _make_doc_manager(tmp_path))
        cancel_fn = _last_endpoint("/cancel_pipeline", "POST")

        pipeline_status = _make_pipeline_status(busy=False)
        monkeypatch.setattr(
            "lightrag.kg.shared_storage.get_namespace_data",
            AsyncMock(return_value=pipeline_status),
        )
        monkeypatch.setattr(
            "lightrag.kg.shared_storage.get_namespace_lock",
            lambda *a, **kw: _FakeLock(),
        )

        result = await cancel_fn()

        assert result.status == "not_busy"
        assert pipeline_status.get("cancellation_requested", False) is False

    @pytest.mark.asyncio
    async def test_cancel_busy_records_message_in_history(
        self, tmp_path, monkeypatch
    ):
        """Pipeline busy → history_messages must contain a cancellation notice."""
        rag = _make_rag()
        _register(rag, _make_doc_manager(tmp_path))
        cancel_fn = _last_endpoint("/cancel_pipeline", "POST")

        pipeline_status = _make_pipeline_status(busy=True)
        monkeypatch.setattr(
            "lightrag.kg.shared_storage.get_namespace_data",
            AsyncMock(return_value=pipeline_status),
        )
        monkeypatch.setattr(
            "lightrag.kg.shared_storage.get_namespace_lock",
            lambda *a, **kw: _FakeLock(),
        )

        await cancel_fn()

        assert any("cancel" in m.lower() for m in pipeline_status["history_messages"])

    @pytest.mark.asyncio
    async def test_cancel_when_idle_but_extracting_docs_returns_cancellation_requested(
        self, tmp_path, monkeypatch
    ):
        """Pipeline idle but EXTRACTING docs exist → must return
        status='cancellation_requested' (not 'not_busy') and set the flag."""
        from lightrag.base import DocStatus, DocProcessingStatus

        rag = _make_rag()
        _register(rag, _make_doc_manager(tmp_path))
        cancel_fn = _last_endpoint("/cancel_pipeline", "POST")

        pipeline_status = _make_pipeline_status(busy=False)

        fake_extracting = {"extract-abc": MagicMock(spec=DocProcessingStatus)}
        fake_extracting["extract-abc"].content_summary = "extracting"
        fake_extracting["extract-abc"].content_length = 0
        fake_extracting["extract-abc"].file_path = "report.pdf"
        fake_extracting["extract-abc"].track_id = "track-abc"
        fake_extracting["extract-abc"].created_at = "2024-01-01T00:00:00+00:00"

        rag.doc_status.get_docs_by_status = AsyncMock(return_value=fake_extracting)

        monkeypatch.setattr(
            "lightrag.kg.shared_storage.get_namespace_data",
            AsyncMock(return_value=pipeline_status),
        )
        monkeypatch.setattr(
            "lightrag.kg.shared_storage.get_namespace_lock",
            lambda *a, **kw: _FakeLock(),
        )

        result = await cancel_fn()

        assert result.status == "cancellation_requested"
        assert pipeline_status["cancellation_requested"] is True

    @pytest.mark.asyncio
    async def test_cancel_with_extracting_docs_marks_them_failed(
        self, tmp_path, monkeypatch
    ):
        """When EXTRACTING docs exist, cancel_pipeline must upsert them all
        with status=FAILED so the frontend stops showing '提取中'."""
        from lightrag.base import DocStatus, DocProcessingStatus

        rag = _make_rag()
        _register(rag, _make_doc_manager(tmp_path))
        cancel_fn = _last_endpoint("/cancel_pipeline", "POST")

        pipeline_status = _make_pipeline_status(busy=False)

        doc1 = MagicMock(spec=DocProcessingStatus)
        doc1.content_summary = "s1"
        doc1.content_length = 0
        doc1.file_path = "a.pdf"
        doc1.track_id = "t1"
        doc1.created_at = "2024-01-01T00:00:00+00:00"
        doc2 = MagicMock(spec=DocProcessingStatus)
        doc2.content_summary = "s2"
        doc2.content_length = 0
        doc2.file_path = "b.pdf"
        doc2.track_id = "t2"
        doc2.created_at = "2024-01-01T00:00:00+00:00"

        rag.doc_status.get_docs_by_status = AsyncMock(
            return_value={"extract-1": doc1, "extract-2": doc2}
        )

        monkeypatch.setattr(
            "lightrag.kg.shared_storage.get_namespace_data",
            AsyncMock(return_value=pipeline_status),
        )
        monkeypatch.setattr(
            "lightrag.kg.shared_storage.get_namespace_lock",
            lambda *a, **kw: _FakeLock(),
        )

        await cancel_fn()

        rag.doc_status.upsert.assert_awaited_once()
        upserted: dict = rag.doc_status.upsert.call_args[0][0]
        assert set(upserted.keys()) == {"extract-1", "extract-2"}
        for record in upserted.values():
            assert record["status"] == DocStatus.FAILED
            assert record["error_msg"] == "User cancelled"

    @pytest.mark.asyncio
    async def test_cancel_when_idle_and_no_extracting_docs_returns_not_busy(
        self, tmp_path, monkeypatch
    ):
        """Pipeline idle with no EXTRACTING docs → still returns 'not_busy'."""
        rag = _make_rag()
        _register(rag, _make_doc_manager(tmp_path))
        cancel_fn = _last_endpoint("/cancel_pipeline", "POST")

        pipeline_status = _make_pipeline_status(busy=False)
        rag.doc_status.get_docs_by_status = AsyncMock(return_value={})

        monkeypatch.setattr(
            "lightrag.kg.shared_storage.get_namespace_data",
            AsyncMock(return_value=pipeline_status),
        )
        monkeypatch.setattr(
            "lightrag.kg.shared_storage.get_namespace_lock",
            lambda *a, **kw: _FakeLock(),
        )

        result = await cancel_fn()

        assert result.status == "not_busy"
        assert pipeline_status.get("cancellation_requested", False) is False


# ===========================================================================
# 2. delete_document
# ===========================================================================


class TestDeleteDocument:
    @pytest.mark.asyncio
    async def test_delete_when_pipeline_busy_returns_busy(self, tmp_path, monkeypatch):
        """Pipeline busy → endpoint returns status='busy', no background task enqueued."""
        rag = _make_rag()
        _register(rag, _make_doc_manager(tmp_path))
        delete_fn = _last_endpoint("/delete_document", "DELETE")

        pipeline_status = _make_pipeline_status(busy=True)
        monkeypatch.setattr(
            "lightrag.kg.shared_storage.get_namespace_data",
            AsyncMock(return_value=pipeline_status),
        )
        monkeypatch.setattr(
            "lightrag.kg.shared_storage.get_namespace_lock",
            lambda *a, **kw: _FakeLock(),
        )

        bg = BackgroundTasks()
        result = await delete_fn(DeleteDocRequest(doc_ids=["doc-abc"]), bg)

        assert result.status == "busy"
        assert len(bg.tasks) == 0

    @pytest.mark.asyncio
    async def test_delete_when_pipeline_idle_returns_deletion_started(
        self, tmp_path, monkeypatch
    ):
        """Pipeline idle → endpoint returns status='deletion_started'."""
        rag = _make_rag()
        _register(rag, _make_doc_manager(tmp_path))
        delete_fn = _last_endpoint("/delete_document", "DELETE")

        pipeline_status = _make_pipeline_status(busy=False)
        monkeypatch.setattr(
            "lightrag.kg.shared_storage.get_namespace_data",
            AsyncMock(return_value=pipeline_status),
        )
        monkeypatch.setattr(
            "lightrag.kg.shared_storage.get_namespace_lock",
            lambda *a, **kw: _FakeLock(),
        )

        bg = BackgroundTasks()
        result = await delete_fn(
            DeleteDocRequest(doc_ids=["doc-abc", "doc-def"]), bg
        )

        assert result.status == "deletion_started"
        assert "doc-abc" in result.doc_id
        assert "doc-def" in result.doc_id
        assert len(bg.tasks) == 1

    @pytest.mark.asyncio
    async def test_delete_idle_enqueues_background_delete_function(
        self, tmp_path, monkeypatch
    ):
        """Idle pipeline → background task must be background_delete_documents."""
        from lightrag.api.routers.document_routes import background_delete_documents

        rag = _make_rag()
        _register(rag, _make_doc_manager(tmp_path))
        delete_fn = _last_endpoint("/delete_document", "DELETE")

        pipeline_status = _make_pipeline_status(busy=False)
        monkeypatch.setattr(
            "lightrag.kg.shared_storage.get_namespace_data",
            AsyncMock(return_value=pipeline_status),
        )
        monkeypatch.setattr(
            "lightrag.kg.shared_storage.get_namespace_lock",
            lambda *a, **kw: _FakeLock(),
        )

        bg = BackgroundTasks()
        await delete_fn(DeleteDocRequest(doc_ids=["doc-xyz"]), bg)

        task = bg.tasks[0]
        assert task.func is background_delete_documents
        # doc_ids list is the third positional argument
        assert "doc-xyz" in task.args[2]


# ===========================================================================
# 3. background_delete_documents
# ===========================================================================


class TestBackgroundDeleteDocuments:
    @pytest.mark.asyncio
    async def test_aborts_if_pipeline_already_busy(self, tmp_path, monkeypatch):
        """Busy flag at background-task start → abort immediately, no deletions."""
        from lightrag.api.routers.document_routes import background_delete_documents

        rag = _make_rag()
        rag.adelete_by_doc_id = AsyncMock()
        pipeline_status = _make_pipeline_status(busy=True)

        monkeypatch.setattr(
            "lightrag.kg.shared_storage.get_namespace_data",
            AsyncMock(return_value=pipeline_status),
        )
        monkeypatch.setattr(
            "lightrag.kg.shared_storage.get_namespace_lock",
            lambda *a, **kw: _FakeLock(),
        )

        await background_delete_documents(rag, _make_doc_manager(tmp_path), ["doc-1"])

        rag.adelete_by_doc_id.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_successful_deletion_resets_busy_flag(self, tmp_path, monkeypatch):
        """After successful deletion busy must be reset to False."""
        from lightrag.api.routers.document_routes import background_delete_documents

        rag = _make_rag()
        rag.adelete_by_doc_id = AsyncMock(
            return_value=MagicMock(status="success", file_path=None, message="ok")
        )
        pipeline_status = _make_pipeline_status(busy=False)

        monkeypatch.setattr(
            "lightrag.kg.shared_storage.get_namespace_data",
            AsyncMock(return_value=pipeline_status),
        )
        monkeypatch.setattr(
            "lightrag.kg.shared_storage.get_namespace_lock",
            lambda *a, **kw: _FakeLock(),
        )

        await background_delete_documents(rag, _make_doc_manager(tmp_path), ["doc-1"])

        rag.adelete_by_doc_id.assert_awaited_once_with("doc-1", delete_llm_cache=False)
        assert pipeline_status["busy"] is False
        assert pipeline_status["cancellation_requested"] is False

    @pytest.mark.asyncio
    async def test_cancellation_mid_batch_stops_remaining_docs(
        self, tmp_path, monkeypatch
    ):
        """cancellation_requested set after first deletion → remaining docs skipped."""
        from lightrag.api.routers.document_routes import background_delete_documents

        rag = _make_rag()
        pipeline_status = _make_pipeline_status(busy=False)

        async def _delete_and_cancel(doc_id, *, delete_llm_cache):
            # Signal cancellation so the *next* doc is skipped
            pipeline_status["cancellation_requested"] = True
            return MagicMock(status="success", file_path=None, message="ok")

        rag.adelete_by_doc_id = AsyncMock(side_effect=_delete_and_cancel)

        monkeypatch.setattr(
            "lightrag.kg.shared_storage.get_namespace_data",
            AsyncMock(return_value=pipeline_status),
        )
        monkeypatch.setattr(
            "lightrag.kg.shared_storage.get_namespace_lock",
            lambda *a, **kw: _FakeLock(),
        )

        await background_delete_documents(
            rag, _make_doc_manager(tmp_path), ["doc-1", "doc-2", "doc-3"]
        )

        assert rag.adelete_by_doc_id.await_count == 1
        assert pipeline_status["busy"] is False  # always reset in finally

    @pytest.mark.asyncio
    async def test_per_document_failure_continues_remaining(
        self, tmp_path, monkeypatch
    ):
        """A failed individual deletion must not abort the remaining documents."""
        from lightrag.api.routers.document_routes import background_delete_documents

        rag = _make_rag()
        outcomes = {
            "doc-1": MagicMock(status="error", file_path=None, message="not found"),
            "doc-2": MagicMock(status="success", file_path=None, message="ok"),
            "doc-3": MagicMock(status="success", file_path=None, message="ok"),
        }
        rag.adelete_by_doc_id = AsyncMock(side_effect=lambda d, **kw: outcomes[d])
        pipeline_status = _make_pipeline_status(busy=False)

        monkeypatch.setattr(
            "lightrag.kg.shared_storage.get_namespace_data",
            AsyncMock(return_value=pipeline_status),
        )
        monkeypatch.setattr(
            "lightrag.kg.shared_storage.get_namespace_lock",
            lambda *a, **kw: _FakeLock(),
        )

        await background_delete_documents(
            rag, _make_doc_manager(tmp_path), ["doc-1", "doc-2", "doc-3"]
        )

        assert rag.adelete_by_doc_id.await_count == 3
        assert pipeline_status["busy"] is False

    @pytest.mark.asyncio
    async def test_exception_during_deletion_continues_remaining(
        self, tmp_path, monkeypatch
    ):
        """RuntimeError from adelete_by_doc_id must not abort the rest of the batch."""
        from lightrag.api.routers.document_routes import background_delete_documents

        rag = _make_rag()
        call_count = 0

        async def _sometimes_raises(doc_id, *, delete_llm_cache):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise RuntimeError("storage error")
            return MagicMock(status="success", file_path=None, message="ok")

        rag.adelete_by_doc_id = AsyncMock(side_effect=_sometimes_raises)
        pipeline_status = _make_pipeline_status(busy=False)

        monkeypatch.setattr(
            "lightrag.kg.shared_storage.get_namespace_data",
            AsyncMock(return_value=pipeline_status),
        )
        monkeypatch.setattr(
            "lightrag.kg.shared_storage.get_namespace_lock",
            lambda *a, **kw: _FakeLock(),
        )

        await background_delete_documents(
            rag, _make_doc_manager(tmp_path), ["doc-1", "doc-2"]
        )

        assert call_count == 2
        assert pipeline_status["busy"] is False


# ===========================================================================
# 4. _reprocess_all_failed_background
# ===========================================================================


class TestReprocessAllFailedBackground:
    @pytest.mark.asyncio
    async def test_pipeline_called_after_extraction_reprocess(self, tmp_path):
        """apipeline_process_enqueue_documents must always be called, even when
        some files were re-scheduled for re-extraction."""
        from lightrag.api.routers.document_routes import _reprocess_all_failed_background

        rag = _make_rag()
        with patch(
            "lightrag.api.routers.document_routes._reprocess_extraction_failures",
            new=AsyncMock(return_value=2),
        ):
            await _reprocess_all_failed_background(rag, tmp_path)

        rag.apipeline_process_enqueue_documents.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_pipeline_called_even_when_nothing_scheduled(self, tmp_path):
        """Pipeline must run even when 0 files are re-scheduled, to handle
        processing-stage failures that were reset to PENDING."""
        from lightrag.api.routers.document_routes import _reprocess_all_failed_background

        rag = _make_rag()
        with patch(
            "lightrag.api.routers.document_routes._reprocess_extraction_failures",
            new=AsyncMock(return_value=0),
        ):
            await _reprocess_all_failed_background(rag, tmp_path)

        rag.apipeline_process_enqueue_documents.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_reprocess_extraction_failures_receives_correct_args(self, tmp_path):
        """_reprocess_extraction_failures must be called with the rag instance
        and input_dir supplied to _reprocess_all_failed_background."""
        from lightrag.api.routers.document_routes import _reprocess_all_failed_background

        rag = _make_rag()
        with patch(
            "lightrag.api.routers.document_routes._reprocess_extraction_failures",
            new=AsyncMock(return_value=0),
        ) as mock_reprocess:
            await _reprocess_all_failed_background(rag, tmp_path, kb_settings=None)

        mock_reprocess.assert_awaited_once_with(rag, tmp_path, None)


# ===========================================================================
# 5. reprocess_failed_documents endpoint
# ===========================================================================


class TestReprocessFailedDocumentsEndpoint:
    @pytest.mark.asyncio
    async def test_returns_reprocessing_started(self, tmp_path):
        """Endpoint must return status='reprocessing_started'."""
        rag = _make_rag()
        _register(rag, _make_doc_manager(tmp_path))
        reprocess_fn = _last_endpoint("/reprocess_failed", "POST")

        result = await reprocess_fn(BackgroundTasks())

        assert result.status == "reprocessing_started"

    @pytest.mark.asyncio
    async def test_enqueues_reprocess_all_failed_background_function(self, tmp_path):
        """Endpoint must enqueue _reprocess_all_failed_background as the task."""
        from lightrag.api.routers.document_routes import _reprocess_all_failed_background

        rag = _make_rag()
        _register(rag, _make_doc_manager(tmp_path))
        reprocess_fn = _last_endpoint("/reprocess_failed", "POST")

        bg = BackgroundTasks()
        await reprocess_fn(bg)

        assert len(bg.tasks) == 1
        assert bg.tasks[0].func is _reprocess_all_failed_background

    @pytest.mark.asyncio
    async def test_enqueues_task_with_correct_rag_and_input_dir(self, tmp_path):
        """Background task must receive the correct rag instance and input_dir."""
        rag = _make_rag()
        doc_manager = _make_doc_manager(tmp_path)
        _register(rag, doc_manager)
        reprocess_fn = _last_endpoint("/reprocess_failed", "POST")

        bg = BackgroundTasks()
        await reprocess_fn(bg)

        task = bg.tasks[0]
        assert task.args[0] is rag
        assert task.args[1] == doc_manager.input_dir


# ===========================================================================
# 6. pipeline_index_file – cancellation-after-extraction guard (Fix B)
# ===========================================================================


class TestPipelineIndexFileCancellationGuard:
    @pytest.mark.asyncio
    async def test_cancellation_after_extraction_skips_pipeline_and_marks_pending_failed(
        self, tmp_path
    ):
        """If cancellation_requested is True when extraction finishes, the
        newly-created PENDING document must be marked FAILED and
        apipeline_process_enqueue_documents must NOT be called."""
        from lightrag.base import DocStatus, DocProcessingStatus
        from lightrag.api.routers.document_routes import pipeline_index_file

        pdf = tmp_path / "report.pdf"
        pdf.write_bytes(b"%PDF fake")

        rag = _make_rag()
        rag.apipeline_process_enqueue_documents = AsyncMock()

        # Simulate a PENDING doc that was just created for this file
        pending_doc = MagicMock(spec=DocProcessingStatus)
        pending_doc.file_path = "report.pdf"
        pending_doc.content_summary = "summary"
        pending_doc.content_length = 100
        pending_doc.track_id = "track-1"
        pending_doc.created_at = "2024-01-01T00:00:00+00:00"

        rag.doc_status.get_docs_by_status = AsyncMock(
            return_value={"doc-hash-1": pending_doc}
        )

        pipeline_status = {"cancellation_requested": True, "history_messages": []}

        with (
            patch(
                "lightrag.api.routers.document_routes.pipeline_enqueue_file",
                new=AsyncMock(return_value=(True, "track-1")),
            ),
            patch(
                "lightrag.kg.shared_storage.get_namespace_data",
                new=AsyncMock(return_value=pipeline_status),
            ),
        ):
            await pipeline_index_file(
                rag, pdf, "track-1", extract_doc_id="extract-track-1"
            )

        # Pipeline must NOT be triggered
        rag.apipeline_process_enqueue_documents.assert_not_awaited()

        # The PENDING doc for this file must be flipped to FAILED
        rag.doc_status.upsert.assert_awaited_once()
        upserted: dict = rag.doc_status.upsert.call_args[0][0]
        assert "doc-hash-1" in upserted
        assert upserted["doc-hash-1"]["status"] == DocStatus.FAILED
        assert upserted["doc-hash-1"]["error_msg"] == "User cancelled"

    @pytest.mark.asyncio
    async def test_no_cancellation_after_extraction_calls_pipeline(self, tmp_path):
        """If cancellation_requested is False, extraction success must trigger
        apipeline_process_enqueue_documents as before."""
        from lightrag.api.routers.document_routes import pipeline_index_file

        pdf = tmp_path / "report.pdf"
        pdf.write_bytes(b"%PDF fake")

        rag = _make_rag()
        pipeline_status = {"cancellation_requested": False, "history_messages": []}

        with (
            patch(
                "lightrag.api.routers.document_routes.pipeline_enqueue_file",
                new=AsyncMock(return_value=(True, "track-1")),
            ),
            patch(
                "lightrag.kg.shared_storage.get_namespace_data",
                new=AsyncMock(return_value=pipeline_status),
            ),
        ):
            await pipeline_index_file(rag, pdf, "track-1")

        rag.apipeline_process_enqueue_documents.assert_awaited_once()


# ===========================================================================
# 7. apipeline_process_enqueue_documents – idle-cancel guard (Fix C)
# ===========================================================================


class TestPipelineStartCancellationGuard:
    @pytest.mark.asyncio
    async def test_skips_start_when_cancellation_requested_while_idle(
        self, tmp_path, monkeypatch
    ):
        """If cancellation_requested is True when apipeline_process_enqueue_documents
        is called and the pipeline is not busy, it must clear the flag and return
        without processing any documents."""
        import numpy as np
        from lightrag.lightrag import LightRAG
        from lightrag.utils import EmbeddingFunc, Tokenizer

        class _Tok:
            def encode(self, s):
                return list(s.encode())

            def decode(self, t):
                return bytes(t).decode()

        async def _emb(texts):
            return np.ones((len(texts), 8), dtype=float)

        async def _llm(*a, **kw):
            return "ok"

        from uuid import uuid4

        rag = LightRAG(
            working_dir=str(tmp_path / "rag"),
            workspace=f"test_{uuid4().hex[:6]}",
            llm_model_func=_llm,
            embedding_func=EmbeddingFunc(
                embedding_dim=8, max_token_size=512, func=_emb
            ),
            tokenizer=Tokenizer("t", _Tok()),
        )
        await rag.initialize_storages()

        try:
            # Seed a PENDING document so the pipeline would normally start
            from lightrag.base import DocStatus
            from datetime import datetime, timezone

            now = datetime.now(timezone.utc).isoformat()
            await rag.doc_status.upsert(
                {
                    "doc-pending-1": {
                        "status": DocStatus.PENDING,
                        "content_summary": "test",
                        "content_length": 4,
                        "chunks_count": 0,
                        "chunks_list": [],
                        "created_at": now,
                        "updated_at": now,
                        "file_path": "test.txt",
                        "track_id": "track-x",
                    }
                }
            )

            # Pre-set the cancellation flag (simulating cancel while extracting)
            from lightrag.kg.shared_storage import (
                get_namespace_data,
                initialize_pipeline_status,
            )

            await initialize_pipeline_status(rag.workspace)
            ps = await get_namespace_data("pipeline_status", workspace=rag.workspace)
            ps["cancellation_requested"] = True
            ps["busy"] = False

            # Call the pipeline; it must return immediately without processing
            await rag.apipeline_process_enqueue_documents()

            # The flag must be cleared
            assert ps.get("cancellation_requested", False) is False
            # The PENDING document must remain PENDING (not processed)
            doc = await rag.doc_status.get_by_id("doc-pending-1")
            assert doc is not None
            status_val = doc["status"]
            if hasattr(status_val, "value"):
                status_val = status_val.value
            assert str(status_val) in ("pending", "DocStatus.PENDING")
        finally:
            await rag.finalize_storages()
