"""
Indexed edits (_match_start_index fast path) fed straight into process_batch.

Mirrors node/packages/core/src/repro.indexed-edit-insertion-loss.test.ts.
Edits carrying a caller-pinned index bypass _pre_resolve_heuristic_edit, so
they must be classified by op fallback and validated by position, not content
(content ambiguity checks false-positive against coincidental matches such as
comment timestamps).
"""

import io

import docx

from adeu.diff import generate_edits_from_text
from adeu.ingest import extract_text_from_stream
from adeu.models import ModifyText
from adeu.redline.engine import RedlineEngine


def _make_engine(text: str) -> RedlineEngine:
    doc = docx.Document()
    doc.add_paragraph(text)
    stream = io.BytesIO()
    doc.save(stream)
    stream.seek(0)
    return RedlineEngine(stream, author="QA Bot")


def _indexed_edit(target: str, new: str, idx: int) -> ModifyText:
    edit = ModifyText(type="modify", target_text=target, new_text=new)
    edit._match_start_index = idx
    return edit


def test_indexed_replacement_produces_del_and_ins():
    engine = _make_engine("The fee is 100 euros.")
    idx = engine.mapper.full_text.index("100")

    stats = engine.process_batch([_indexed_edit("100", "250", idx)])
    assert stats["edits_applied"] == 1

    xml = engine.doc.element.xml
    assert "<w:del" in xml
    assert "<w:ins" in xml

    clean = extract_text_from_stream(engine.save_to_stream(), clean_view=True)
    assert "The fee is 250 euros." in clean
    assert "100" not in clean


def test_indexed_pure_deletion():
    engine = _make_engine("Payment is strictly due on Friday.")
    idx = engine.mapper.full_text.index("strictly ")

    stats = engine.process_batch([_indexed_edit("strictly ", "", idx)])
    assert stats["edits_applied"] == 1

    clean = extract_text_from_stream(engine.save_to_stream(), clean_view=True)
    assert "Payment is due on Friday." in clean


def test_indexed_pure_insertion_mid_paragraph():
    engine = _make_engine("Payment is due on Friday.")
    idx = engine.mapper.full_text.index("due")

    stats = engine.process_batch([_indexed_edit("", "strictly ", idx)])
    assert stats["edits_applied"] == 1

    clean = extract_text_from_stream(engine.save_to_stream(), clean_view=True)
    assert "Payment is strictly due on Friday." in clean


def test_indexed_insertion_at_index_zero_lands_before_first_run():
    engine = _make_engine("World peace treaty.")

    stats = engine.process_batch([_indexed_edit("", "PREAMBLE: ", 0)])
    assert stats["edits_applied"] == 1

    clean = extract_text_from_stream(engine.save_to_stream(), clean_view=True)
    assert "PREAMBLE: World peace treaty." in clean


def test_generated_diff_edits_feed_straight_into_process_batch():
    original = "Payment of 100 EUR is due within 30 days of invoice."
    modified = "Payment of 250 EUR is due within 14 days of receipt."
    engine = _make_engine(original)

    edits = generate_edits_from_text(original, modified)
    assert len(edits) > 0
    assert all(e._match_start_index is not None for e in edits)

    stats = engine.process_batch(edits)
    assert stats["edits_applied"] == len(edits)
    assert stats["edits_skipped"] == 0

    out = engine.save_to_stream()
    clean = extract_text_from_stream(out, clean_view=True)
    assert modified in clean
    out.seek(0)
    tracked = extract_text_from_stream(out, clean_view=False)
    assert "100" in tracked
    assert "250" in tracked
