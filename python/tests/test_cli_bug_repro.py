import io

from docx import Document

from adeu.ingest import extract_text_from_stream
from adeu.models import ModifyText
from adeu.redline.engine import RedlineEngine


def test_gfm_table_divider_extraction():
    # 1. Create a document with a table
    doc = Document()
    table = doc.add_table(rows=3, cols=3)

    # Fill first row (header)
    table.cell(0, 0).text = "ID"
    table.cell(0, 1).text = "Name"
    table.cell(0, 2).text = "Description"

    # Fill second row
    table.cell(1, 0).text = "1"
    table.cell(1, 1).text = "Item A"
    table.cell(1, 2).text = "This is item A"

    # Fill third row
    table.cell(2, 0).text = "2"
    table.cell(2, 1).text = "Item B"
    table.cell(2, 2).text = "This is item B"

    stream = io.BytesIO()
    doc.save(stream)
    stream.seek(0)

    # 2. Extract clean view text
    text = extract_text_from_stream(stream, clean_view=True)

    # 3. Assert correct GFM pipe table formatting with divider row
    expected_lines = [
        "ID | Name | Description",
        "--- | --- | ---",
        "1 | Item A | This is item A",
        "2 | Item B | This is item B",
    ]
    expected_text = "\n".join(expected_lines)
    assert expected_text in text


def test_gfm_table_divider_mapping():
    # Verifies that mapping and editing works flawlessly when the divider is present
    doc = Document()
    table = doc.add_table(rows=2, cols=2)
    table.cell(0, 0).text = "Col1"
    table.cell(0, 1).text = "Col2"
    table.cell(1, 0).text = "Val1"
    table.cell(1, 1).text = "Val2"

    stream = io.BytesIO()
    doc.save(stream)
    stream.seek(0)

    # Let's apply a text modification inside a table cell
    # Target "Val1", replace with "NewVal1"
    edit = ModifyText(target_text="Val1", new_text="NewVal1")
    engine = RedlineEngine(stream)
    applied, skipped = engine.apply_edits([edit])

    assert applied == 1
    assert skipped == 0

    res_stream = engine.save_to_stream()
    res_text = extract_text_from_stream(res_stream, clean_view=False)

    # Check that CriticMarkup is correct
    assert "{--Val1--}{++NewVal1++}" in res_text

    # Assert that the divider row is present in the mapped/edited raw view text
    assert "Col1 | Col2\n--- | ---\n" in res_text
