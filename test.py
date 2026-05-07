# FILE: repro_bug3.py
"""
Reproduction script for Bug 3: Heading paragraphs whose first run contains a
leading <w:br/> project as "## \\nHeading Text" instead of "## Heading Text".

The failing test (test_issue_4_heading_2_with_leading_break):
  1. Creates a Heading 2 paragraph.
  2. First run contains only a <w:br/>.
  3. Second run contains "Heading Text".
  4. Asserts that the projected text does NOT contain "## \\n".

This script:
  1. Builds the same paragraph the test builds.
  2. Dumps the OOXML for the paragraph so we can confirm the structure.
  3. Walks iter_paragraph_content + get_run_text to show what each run
     contributes character-by-character.
  4. Calls _extract_text_from_doc and prints the projected output (repr +
     rendered).
  5. Reports the test assertion result.
  6. Also runs a "control" case: the same heading WITHOUT the leading break,
     so we can confirm that the issue is specifically the leading <w:br/>.
"""

import io

import lxml.etree as etree
from docx import Document

from adeu.ingest import _extract_text_from_doc, build_paragraph_text
from adeu.redline.comments import CommentsManager
from adeu.utils.docx import get_paragraph_prefix, get_run_text, iter_paragraph_content


def section(title: str) -> None:
    print()
    print("=" * 72)
    print(title)
    print("=" * 72)


def dump_paragraph_xml(paragraph) -> None:
    print("--- paragraph OOXML ---")
    print(etree.tostring(paragraph._element, pretty_print=True).decode("utf-8"))


def dump_run_walk(paragraph) -> None:
    print("--- iter_paragraph_content walk ---")
    for i, item in enumerate(iter_paragraph_content(paragraph)):
        type_name = type(item).__name__
        if type_name == "Run":
            text = get_run_text(item)
            print(f"  {i:2d}  Run             text={text!r}")
        else:
            # DocxEvent
            print(f"  {i:2d}  Event(type={item.type!r}, id={item.id!r})")


def case_with_leading_break() -> None:
    section("CASE A — Heading 2 with leading <w:br/>")
    doc = Document()
    p = doc.add_paragraph(style="Heading 2")
    r1 = p.add_run()
    r1.add_break()
    p.add_run("Heading Text")

    dump_paragraph_xml(p)
    print(f"get_paragraph_prefix(p) = {get_paragraph_prefix(p)!r}")
    print()
    dump_run_walk(p)

    print()
    print("--- build_paragraph_text(p) ---")
    comments_map = CommentsManager(doc).extract_comments_data()
    bp_text = build_paragraph_text(p, comments_map, clean_view=False)
    print(f"  repr: {bp_text!r}")

    print()
    print("--- _extract_text_from_doc full output ---")
    stream = io.BytesIO()
    doc.save(stream)
    stream.seek(0)
    text = _extract_text_from_doc(Document(stream))
    print(f"  repr:     {text!r}")
    print("  rendered:")
    for line in text.split("\n"):
        print(f"    {line!r}")

    print()
    has_bug = "## \n" in text
    marker = "FAIL" if has_bug else "PASS"
    print(f"  [{marker}] expected '## \\n' NOT in text  (THE BUG)")


def case_without_leading_break() -> None:
    section("CASE B — Heading 2 without leading <w:br/> (control)")
    doc = Document()
    p = doc.add_paragraph(style="Heading 2")
    p.add_run("Heading Text")

    dump_paragraph_xml(p)
    print(f"get_paragraph_prefix(p) = {get_paragraph_prefix(p)!r}")
    print()
    dump_run_walk(p)

    print()
    print("--- _extract_text_from_doc full output ---")
    stream = io.BytesIO()
    doc.save(stream)
    stream.seek(0)
    text = _extract_text_from_doc(Document(stream))
    print(f"  repr: {text!r}")


def case_with_break_inside_text() -> None:
    section("CASE C — Heading 2 with <w:br/> in the MIDDLE (regression check)")
    # We want to make sure any future fix for Bug 3 does NOT accidentally
    # eat <w:br/> that appears mid-content. A break in the middle of a
    # heading should still be preserved as a newline.
    doc = Document()
    p = doc.add_paragraph(style="Heading 2")
    p.add_run("Line 1")
    r2 = p.add_run()
    r2.add_break()
    p.add_run("Line 2")

    print(f"get_paragraph_prefix(p) = {get_paragraph_prefix(p)!r}")
    print()
    dump_run_walk(p)

    stream = io.BytesIO()
    doc.save(stream)
    stream.seek(0)
    text = _extract_text_from_doc(Document(stream))
    print("--- projected text ---")
    print(f"  repr: {text!r}")
    print()
    print("Note: A correct fix for Bug 3 must not strip the inner '\\n' here.")


def main() -> None:
    case_with_leading_break()
    case_without_leading_break()
    case_with_break_inside_text()


if __name__ == "__main__":
    main()
