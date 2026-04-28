import io

import pytest
from docx import Document
from docx.opc.packuri import PackURI
from docx.opc.part import XmlPart
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

from adeu.ingest import extract_text_from_stream
from adeu.models import ModifyText
from adeu.redline.engine import BatchValidationError, RedlineEngine


def setup_footnotes_fixture() -> io.BytesIO:
    """
    Programmatically creates a DOCX in memory containing a valid footnotes.xml part,
    allowing us to test Footnote Virtual DOM integration without needing static fixtures.
    """
    doc = Document()
    p = doc.add_paragraph("Sentence with footnote")

    # Manually append the inline <w:footnoteReference w:id="1"/>
    r = OxmlElement("w:r")
    ref = OxmlElement("w:footnoteReference")
    ref.set(qn("w:id"), "1")
    r.append(ref)
    p._element.append(r)

    # Fabricate the standalone footnotes.xml package part
    fn_xml = b"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:footnote w:type="separator" w:id="-1">
            <w:p><w:r><w:separator/></w:r></w:p>
        </w:footnote>
        <w:footnote w:id="1">
            <w:p><w:r><w:t>Footnote content.</w:t></w:r></w:p>
        </w:footnote>
    </w:footnotes>
    """
    partname = PackURI("/word/footnotes.xml")
    content_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"
    rel_type = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes"

    part = XmlPart.load(partname, content_type, fn_xml, doc.part.package)
    doc.part.package.parts.append(part)
    doc.part.relate_to(part, rel_type)

    stream = io.BytesIO()
    doc.save(stream)
    stream.seek(0)
    return stream


def test_footnote_extraction():
    """Verify that footnote parts are correctly surfaced in Markdown (both inline and appended block)."""
    stream = setup_footnotes_fixture()
    text = extract_text_from_stream(stream)

    # Verify Inline Reference Syntax
    assert "[^fn-1]" in text, "Inline footnote reference missing."

    # Verify System Appendix Headers
    assert "## Footnotes" in text, "Footnotes appendix block header missing."

    # Verify Content Body and Prefix
    assert "[^fn-1]: Footnote content." in text, "Structural footnote prefix missing or incorrect."


def test_footnote_redline_edit():
    """Verify that text edits safely target the footnotes.xml payload structure via the main pipeline."""
    stream = setup_footnotes_fixture()
    engine = RedlineEngine(stream)

    # Find and edit the footnote text directly
    edit = ModifyText(target_text="Footnote content.", new_text="This is an edited footnote.")

    stats = engine.process_batch([edit])
    assert stats["edits_applied"] == 1, f"Failed to edit footnote. Details: {stats.get('skipped_details')}"

    # Verify the accepted edit state
    engine.accept_all_revisions()
    clean_text = extract_text_from_stream(engine.save_to_stream(), clean_view=True)

    assert "edited" in clean_text
    assert "[^fn-1]: This is an edited footnote." in clean_text
    assert "[^fn-1]: This is an edited footnote." in clean_text


def test_footnote_accept_changes():
    """VAL-CRIT-1: Verify accept_all_changes processes footnotes.xml and leaves it clean."""
    stream = setup_footnotes_fixture()
    engine = RedlineEngine(stream)

    edit = ModifyText(target_text="Footnote content.", new_text="Edited content.")
    engine.process_batch([edit])

    # Run acceptance (which must traverse footnotes.xml)
    engine.accept_all_revisions()

    # Verify clean XML in the footnote part
    fn_part = next(p for p in engine.doc.part.package.parts if "footnotes" in p.partname)

    if hasattr(fn_part, "_adeu_element"):
        import lxml.etree as etree

        xml_after = etree.tostring(fn_part._adeu_element).decode("utf-8")
    else:
        xml_after = fn_part.blob.decode("utf-8")

    assert "w:ins" not in xml_after, "Footnote insertions not accepted"
    assert "w:del" not in xml_after, "Footnote deletions not accepted"
    assert "Edited" in xml_after
    assert "content." in xml_after


def test_footnote_deletion_rejected():
    """VAL-CRIT-3: Verify that attempting to delete a footnote reference via text replacement is rejected."""
    stream = setup_footnotes_fixture()
    engine = RedlineEngine(stream)

    # Try to delete [^fn-1]
    edit = ModifyText(target_text="Sentence with footnote[^fn-1]", new_text="Sentence with footnote")

    with pytest.raises(BatchValidationError) as exc_info:
        engine.process_batch([edit])

    assert "footnote" in str(exc_info.value).lower()
    assert "delete" in str(exc_info.value).lower() or "remove" in str(exc_info.value).lower()


def test_footnote_insertion_rejected():
    """VAL-CRIT-4: Verify that attempting to fabricate a footnote reference via text replacement is rejected."""
    stream = setup_footnotes_fixture()
    engine = RedlineEngine(stream)

    # Try to inject a new [^fn-99]
    edit = ModifyText(target_text="Sentence with footnote", new_text="Sentence with footnote[^fn-99]")

    with pytest.raises(BatchValidationError) as exc_info:
        engine.process_batch([edit])

    assert "footnote" in str(exc_info.value).lower()
    assert "insert" in str(exc_info.value).lower() or "create" in str(exc_info.value).lower()
