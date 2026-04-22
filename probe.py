# FILE: C:\Users\Uzair\Desktop\NDA\probe_inserted_bullet.py
"""
Saves a COPY of the active Word document to a temp path (doesn't disturb
the live document), extracts the XML of the inserted-bullet paragraph vs
the original deleted-bullet paragraph, and prints both for comparison.
"""

import re
import tempfile
import zipfile
from pathlib import Path

import pythoncom
import win32com.client

pythoncom.CoInitialize()
app = win32com.client.GetActiveObject("Word.Application")
doc = app.ActiveDocument

tmp = Path(tempfile.gettempdir()) / "nda_with_inserted_bullets.docx"

# Use the Copy method — writes a file at `tmp` without changing the
# active document's own save path, so the user's live doc stays
# in-memory as whatever it was.
#
# Word COM doesn't have a direct "save copy" on Document objects, so
# we use a sentinel: save the active doc's current state to bytes via
# the Flat-OPC round-trip we already use elsewhere.
xml_str = doc.WordOpenXML

# Write via our existing adeu helper so we get a proper ZIP
# NOTE: if adeu isn't on PYTHONPATH when running this, fall back to
# a manual flat-opc unpack. Try the adeu route first.
try:
    from adeu.mcp_components.tools.live_word import _build_mock_docx_stream

    stream = _build_mock_docx_stream(xml_str)
    tmp.write_bytes(stream.getvalue())
    print(f"Saved copy to: {tmp} (via adeu._build_mock_docx_stream)")
except Exception as e:
    print(f"adeu path unavailable ({e}); falling back to SaveAs2")
    doc.SaveAs2(str(tmp))
    print(f"Saved to: {tmp}")

with zipfile.ZipFile(tmp) as z:
    doc_xml = z.read("word/document.xml").decode("utf-8")

# Find the inserted bullet paragraph
print()
for m in re.finditer(r"<w:p\b[^>]*>.*?</w:p>", doc_xml, re.DOTALL):
    body = m.group(0)
    if "hardware configuration information" in body and "<w:ins" in body:
        print("=== INSERTED BULLET PARAGRAPH XML ===")
        print(body)
        print()
        break
else:
    print("!!! Could not find inserted bullet paragraph.")

# Find the deleted original bullet paragraph
for m in re.finditer(r"<w:p\b[^>]*>.*?</w:p>", doc_xml, re.DOTALL):
    body = m.group(0)
    if "hardware configuration information" in body and "<w:del" in body:
        print("=== ORIGINAL DELETED BULLET PARAGRAPH XML ===")
        print(body)
        break
else:
    print("!!! Could not find deleted original bullet paragraph.")
