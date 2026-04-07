"""Unit tests for pipeline_index_file EXTRACTING-status lifecycle.

Covers the three branching paths introduced by the extract_doc_id parameter:
  1. Success      – placeholder deleted, apipeline_process_enqueue_documents called.
  2. Known failure – pipeline_enqueue_file returns (False, ...) after recording its
                    own error; placeholder deleted, processing NOT started.
  3. Unexpected exception – placeholder updated to DocStatus.FAILED so the user
                            always sees the failure in the document list.

Also verifies:
  - DocStatus.EXTRACTING exists in the enum.
  - Backward-compat: extract_doc_id=None causes no storage calls.
  - Inner delete failure does not bubble up and crash the upload.
"""

from __future__ import annotations

import sys

sys.argv = ["lightrag-server"]

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, call, patch

import pytest

from lightrag.base import DocStatus

pytestmark = pytest.mark.offline


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_rag() -> MagicMock:
    rag = MagicMock()
    rag.doc_status = MagicMock()
    rag.doc_status.delete = AsyncMock()
    rag.doc_status.upsert = AsyncMock()
    rag.apipeline_process_enqueue_documents = AsyncMock()
    return rag


FAKE_PATH = Path("report.pdf")
FAKE_TRACK = "track-abc123"
FAKE_EXTRACT_ID = f"extract-{FAKE_TRACK}"

# ---------------------------------------------------------------------------
# Enum
# ---------------------------------------------------------------------------


@pytest.mark.offline
def test_docstatus_extracting_exists():
    assert DocStatus.EXTRACTING == "extracting"
    assert DocStatus.EXTRACTING in list(DocStatus)


# ---------------------------------------------------------------------------
# pipeline_index_file – success path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.offline
async def test_success_deletes_placeholder_and_starts_processing():
    from lightrag.api.routers.document_routes import pipeline_index_file

    rag = _make_rag()

    with patch(
        "lightrag.api.routers.document_routes.pipeline_enqueue_file",
        new=AsyncMock(return_value=(True, FAKE_TRACK)),
    ):
        await pipeline_index_file(
            rag, FAKE_PATH, FAKE_TRACK, extract_doc_id=FAKE_EXTRACT_ID
        )

    rag.doc_status.delete.assert_awaited_once_with([FAKE_EXTRACT_ID])
    rag.apipeline_process_enqueue_documents.assert_awaited_once()
    rag.doc_status.upsert.assert_not_awaited()


# ---------------------------------------------------------------------------
# pipeline_index_file – known failure path (enqueue returns False)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.offline
async def test_known_failure_deletes_placeholder_and_skips_processing():
    from lightrag.api.routers.document_routes import pipeline_index_file

    rag = _make_rag()

    with patch(
        "lightrag.api.routers.document_routes.pipeline_enqueue_file",
        new=AsyncMock(return_value=(False, FAKE_TRACK)),
    ):
        await pipeline_index_file(
            rag, FAKE_PATH, FAKE_TRACK, extract_doc_id=FAKE_EXTRACT_ID
        )

    rag.doc_status.delete.assert_awaited_once_with([FAKE_EXTRACT_ID])
    rag.apipeline_process_enqueue_documents.assert_not_awaited()
    rag.doc_status.upsert.assert_not_awaited()


# ---------------------------------------------------------------------------
# pipeline_index_file – unexpected exception path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.offline
async def test_unexpected_exception_updates_placeholder_to_failed():
    from lightrag.api.routers.document_routes import pipeline_index_file

    rag = _make_rag()

    with patch(
        "lightrag.api.routers.document_routes.pipeline_enqueue_file",
        new=AsyncMock(side_effect=RuntimeError("boom")),
    ):
        await pipeline_index_file(
            rag, FAKE_PATH, FAKE_TRACK, extract_doc_id=FAKE_EXTRACT_ID
        )

    rag.doc_status.delete.assert_not_awaited()
    rag.apipeline_process_enqueue_documents.assert_not_awaited()

    rag.doc_status.upsert.assert_awaited_once()
    upsert_arg: dict = rag.doc_status.upsert.call_args[0][0]
    assert FAKE_EXTRACT_ID in upsert_arg
    record = upsert_arg[FAKE_EXTRACT_ID]
    assert record["status"] == DocStatus.FAILED
    assert "boom" in record["error_msg"]
    assert record["file_path"] == FAKE_PATH.name


# ---------------------------------------------------------------------------
# pipeline_index_file – no extract_doc_id (backward compat)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.offline
async def test_no_extract_doc_id_does_not_touch_storage():
    from lightrag.api.routers.document_routes import pipeline_index_file

    rag = _make_rag()

    with patch(
        "lightrag.api.routers.document_routes.pipeline_enqueue_file",
        new=AsyncMock(return_value=(True, FAKE_TRACK)),
    ):
        await pipeline_index_file(rag, FAKE_PATH, FAKE_TRACK, extract_doc_id=None)

    rag.doc_status.delete.assert_not_awaited()
    rag.doc_status.upsert.assert_not_awaited()
    rag.apipeline_process_enqueue_documents.assert_awaited_once()


# ---------------------------------------------------------------------------
# pipeline_index_file – inner delete raises but must not crash the caller
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.offline
async def test_delete_failure_does_not_propagate():
    from lightrag.api.routers.document_routes import pipeline_index_file

    rag = _make_rag()
    rag.doc_status.delete = AsyncMock(side_effect=OSError("storage gone"))

    with patch(
        "lightrag.api.routers.document_routes.pipeline_enqueue_file",
        new=AsyncMock(return_value=(True, FAKE_TRACK)),
    ):
        # Must not raise
        await pipeline_index_file(
            rag, FAKE_PATH, FAKE_TRACK, extract_doc_id=FAKE_EXTRACT_ID
        )

    rag.apipeline_process_enqueue_documents.assert_awaited_once()



# ===========================================================================
# _reprocess_extraction_failures
# ===========================================================================

def _make_status_doc(file_path: str, track_id: str = FAKE_TRACK, has_content: bool = False):
    """Return a minimal mock doc_status entry."""
    doc = MagicMock()
    doc.file_path = file_path
    doc.track_id = track_id
    doc.status = "failed"
    # full_docs mock is set separately via rag.full_docs.get_by_id
    return doc


# ---------------------------------------------------------------------------
# file exists → extraction succeeds → placeholder deleted, count = 1
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.offline
async def test_reprocess_file_exists_success(tmp_path):
    from lightrag.api.routers.document_routes import _reprocess_extraction_failures

    pdf = tmp_path / "report.pdf"
    pdf.write_bytes(b"%PDF fake")

    rag = _make_rag()
    # FAILED record with no full_docs content
    rag.doc_status.get_docs_by_status = AsyncMock(
        return_value={"error-abc": _make_status_doc("report.pdf")}
    )
    rag.full_docs = MagicMock()
    rag.full_docs.get_by_id = AsyncMock(return_value=None)  # no extracted content

    with patch(
        "lightrag.api.routers.document_routes.pipeline_enqueue_file",
        new=AsyncMock(return_value=(True, FAKE_TRACK)),
    ):
        count = await _reprocess_extraction_failures(rag, tmp_path)

    assert count == 1
    rag.doc_status.delete.assert_any_call(["error-abc"])           # old record removed
    extract_id = f"extract-{FAKE_TRACK}"
    rag.doc_status.delete.assert_any_call([extract_id])            # placeholder cleaned up


# ---------------------------------------------------------------------------
# file exists → extraction fails (known failure) → placeholder deleted, count = 0
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.offline
async def test_reprocess_file_exists_known_failure(tmp_path):
    from lightrag.api.routers.document_routes import _reprocess_extraction_failures

    pdf = tmp_path / "report.pdf"
    pdf.write_bytes(b"%PDF fake")

    rag = _make_rag()
    rag.doc_status.get_docs_by_status = AsyncMock(
        return_value={"error-abc": _make_status_doc("report.pdf")}
    )
    rag.full_docs = MagicMock()
    rag.full_docs.get_by_id = AsyncMock(return_value=None)

    with patch(
        "lightrag.api.routers.document_routes.pipeline_enqueue_file",
        new=AsyncMock(return_value=(False, FAKE_TRACK)),
    ):
        count = await _reprocess_extraction_failures(rag, tmp_path)

    assert count == 0
    extract_id = f"extract-{FAKE_TRACK}"
    rag.doc_status.delete.assert_any_call([extract_id])            # placeholder cleaned up


# ---------------------------------------------------------------------------
# file exists → unexpected exception → placeholder updated to FAILED
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.offline
async def test_reprocess_unexpected_exception_marks_failed(tmp_path):
    from lightrag.api.routers.document_routes import _reprocess_extraction_failures

    pdf = tmp_path / "report.pdf"
    pdf.write_bytes(b"%PDF fake")

    rag = _make_rag()
    rag.doc_status.get_docs_by_status = AsyncMock(
        return_value={"error-abc": _make_status_doc("report.pdf")}
    )
    rag.full_docs = MagicMock()
    rag.full_docs.get_by_id = AsyncMock(return_value=None)

    with patch(
        "lightrag.api.routers.document_routes.pipeline_enqueue_file",
        new=AsyncMock(side_effect=RuntimeError("network gone")),
    ):
        count = await _reprocess_extraction_failures(rag, tmp_path)

    assert count == 0
    upsert_calls = rag.doc_status.upsert.await_args_list
    # Last upsert should mark the placeholder as FAILED
    last_call_arg = upsert_calls[-1][0][0]
    extract_id = f"extract-{FAKE_TRACK}"
    assert extract_id in last_call_arg
    assert last_call_arg[extract_id]["status"].value == "failed"
    assert "network gone" in last_call_arg[extract_id]["error_msg"]


# ---------------------------------------------------------------------------
# file does NOT exist → old record kept, nothing scheduled
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.offline
async def test_reprocess_file_missing_skipped(tmp_path):
    from lightrag.api.routers.document_routes import _reprocess_extraction_failures

    # Note: we do NOT create the file on disk

    rag = _make_rag()
    rag.doc_status.get_docs_by_status = AsyncMock(
        return_value={"error-abc": _make_status_doc("missing.pdf")}
    )
    rag.full_docs = MagicMock()
    rag.full_docs.get_by_id = AsyncMock(return_value=None)

    count = await _reprocess_extraction_failures(rag, tmp_path)

    assert count == 0
    # Old record must NOT be deleted (file is gone, nothing to retry)
    rag.doc_status.delete.assert_not_awaited()


# ---------------------------------------------------------------------------
# doc has full_docs content → it is a processing failure, must be skipped
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.offline
async def test_reprocess_processing_failure_not_touched(tmp_path):
    from lightrag.api.routers.document_routes import _reprocess_extraction_failures

    rag = _make_rag()
    rag.doc_status.get_docs_by_status = AsyncMock(
        return_value={"doc-xyz": _make_status_doc("report.pdf")}
    )
    rag.full_docs = MagicMock()
    # Has extracted content → processing failure, not extraction failure
    rag.full_docs.get_by_id = AsyncMock(return_value={"content": "some text"})

    with patch(
        "lightrag.api.routers.document_routes.pipeline_enqueue_file",
        new=AsyncMock(),
    ) as mock_enqueue:
        count = await _reprocess_extraction_failures(rag, tmp_path)

    assert count == 0
    mock_enqueue.assert_not_awaited()
    rag.doc_status.delete.assert_not_awaited()
