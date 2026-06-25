"""
Regression tests for the two-bug report:
  1. Stringified JSON elements in the `changes` array (Gemini quirk).
  2. Hard crash when `page` is out of range during a search.
"""

import asyncio
import json

import pytest
from docx import Document

from adeu.mcp_components._response_builders import build_search_response
from adeu.mcp_components.tools.document import process_document_batch


class MockContext:
    """Mock FastMCP Context to absorb async logging calls during tests."""

    async def info(self, msg, **kwargs):
        pass

    async def debug(self, msg, **kwargs):
        pass

    async def warning(self, msg, **kwargs):
        pass

    async def error(self, msg, **kwargs):
        pass


@pytest.fixture
def sample_docx(tmp_path) -> str:
    """Creates a basic DOCX file for testing."""
    doc = Document()
    doc.add_paragraph("This is the original text.")
    path = tmp_path / "sample.docx"
    doc.save(path)
    return str(path)


# ---------------------------------------------------------------------------
# Bug 1: stringified JSON elements in `changes`
# ---------------------------------------------------------------------------


def test_process_document_batch_accepts_stringified_changes(sample_docx, tmp_path):
    """
    Gemini (and occasionally other LLM clients) wraps each object in the
    `changes` array as a JSON-encoded string. Pydantic should accept this
    via the BeforeValidator and the batch should apply normally.
    """
    ctx = MockContext()
    output_path = tmp_path / "output.docx"

    stringified_changes = [
        json.dumps(
            {
                "type": "modify",
                "target_text": "original text",
                "new_text": "new text",
                "comment": "Test comment",
            }
        )
    ]

    result = asyncio.run(
        process_document_batch(
            original_docx_path=sample_docx,
            author_name="AI Agent",
            ctx=ctx,  # type: ignore[arg-type]
            changes=stringified_changes,  # type: ignore[arg-type]
            output_path=str(output_path),
        )
    )

    assert "Batch complete" in result
    assert "Edits: 1 applied, 0 skipped" in result
    assert output_path.exists()


def test_process_document_batch_accepts_mixed_string_and_dict(sample_docx, tmp_path):
    """A list containing both stringified and real objects should also work."""
    ctx = MockContext()
    output_path = tmp_path / "output_mixed.docx"

    mixed_changes = [
        json.dumps({"type": "modify", "target_text": "original", "new_text": "first"}),
        {"type": "modify", "target_text": "text", "new_text": "second"},
    ]

    result = asyncio.run(
        process_document_batch(
            original_docx_path=sample_docx,
            author_name="AI Agent",
            ctx=ctx,  # type: ignore[arg-type]
            changes=mixed_changes,  # type: ignore[arg-type]
            output_path=str(output_path),
        )
    )

    # Both edits target text that exists; both should apply.
    assert "Edits: 2 applied" in result
    assert output_path.exists()


def test_process_document_batch_rejects_unparseable_string(sample_docx, tmp_path):
    """
    A string that is not valid JSON should leave the original string in place
    so Pydantic raises a clear validation error, not an opaque internal one.
    """
    ctx = MockContext()

    bad_changes = ["this is not json at all"]

    with pytest.raises(Exception) as exc_info:
        asyncio.run(
            process_document_batch(
                original_docx_path=sample_docx,
                author_name="AI Agent",
                ctx=ctx,  # type: ignore[arg-type]
                changes=bad_changes,  # type: ignore[arg-type]
                output_path=str(tmp_path / "fail.docx"),
            )
        )

    # We don't pin the exact exception class because FastMCP/Pydantic wrap
    # validation errors differently across versions. What matters is that the
    # failure is a validation-style failure, not a downstream AttributeError
    # on `_applied_status`.
    msg = str(exc_info.value).lower()
    assert "_applied_status" not in msg


# ---------------------------------------------------------------------------
# Bug 2: search pagination out-of-range
# ---------------------------------------------------------------------------


def test_search_out_of_range_page_falls_back_gracefully():
    """
    The previous behaviour raised ToolError when `page` exceeded the number of
    search-result pages. Now we clamp to page 1 and prepend a warning.
    """
    body = "The CC BY 4.0 license is referenced exactly once in this body."
    result = build_search_response(
        text=body,
        search_query="CC BY 4.0",
        search_regex=False,
        search_case_sensitive=True,
        page=3,  # only 1 page of results exists
        file_path="cloud-service-agreement.docx",
    )

    md = result.structured_content["markdown"]
    # Warning is present
    assert "search page 3" in md
    assert "only span 1 page" in md
    # The matched text is still shown (i.e. we didn't error out)
    assert "CC BY 4.0" in md


def test_search_in_range_page_unchanged_behaviour():
    """A valid `page` should not produce the warning."""
    # Construct a body with 15 matches so we get 2 pages of search results.
    body = " ".join(["needle"] * 15)
    result = build_search_response(
        text=body,
        search_query="needle",
        search_regex=False,
        search_case_sensitive=True,
        page=2,
        file_path="doc.docx",
    )

    md = result.structured_content["markdown"]
    assert "only span" not in md
    assert "Showing page 2 of 2" in md


def test_search_page_all_unchanged_behaviour():
    """
    `page='all'` should never trigger the clamp warning, and should not
    surface a "Showing page X of Y" hint (that hint exists only for
    multi-page paginated views, not for the all-at-once view).
    """
    body = " ".join(["needle"] * 15)
    result = build_search_response(
        text=body,
        search_query="needle",
        search_regex=False,
        search_case_sensitive=True,
        page="all",
        file_path="doc.docx",
    )

    md = result.structured_content["markdown"]
    assert "only span" not in md
    # All 15 matches should appear in the output, not just the first page's 10.
    assert "Match 15" in md
