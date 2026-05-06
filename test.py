# FILE: verify_bug4_fix.py
"""
Verifies Bug 4 fix: disk and Live Word ambiguity messages are now consistent
and bounded.

The Live Word path is Windows-only and requires Word to be open. We test it
indirectly by calling format_ambiguity_error directly with the same data
the Live Word path would feed it. The DISK path is tested end-to-end by
running validate_edits on a doc with many matches.

Self-contained.
"""

import sys
from io import BytesIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from docx import Document

from adeu.markup import (
    AMBIGUITY_EXAMPLES_CAP,
    _find_match_in_text,
    format_ambiguity_error,
)
from adeu.models import ModifyText
from adeu.redline.engine import RedlineEngine


def section(title):
    print()
    print("=" * 78)
    print(title)
    print("=" * 78)


def make_docx_with_many_microsofts(n=50):
    doc = Document()
    contexts = [
        "Microsoft is a technology company.",
        "Our partner Microsoft delivered the report.",
        "We at Microsoft believe in innovation.",
        "Co-pilot from Microsoft launched globally.",
        "The Microsoft team announced new products.",
    ]
    for i in range(n):
        doc.add_paragraph(contexts[i % len(contexts)] + f" (paragraph {i + 1})")
    stream = BytesIO()
    doc.save(stream)
    stream.seek(0)
    return stream


# ---------------------------------------------------------------------------
# Test 1: Disk path with 50 matches — message must be bounded.
# ---------------------------------------------------------------------------
section("Test 1: Disk path message is bounded for 50 matches")

stream = make_docx_with_many_microsofts(n=50)
engine = RedlineEngine(stream, author="Test")
edit = ModifyText(type="modify", target_text="Microsoft", new_text="MSFT")
errors = engine.validate_edits([edit])
assert len(errors) == 1
disk_message = errors[0]

print(disk_message)
print(f"\n[Length: {len(disk_message)} characters]")

# Bound check: previous version was ~6500 chars for 50 matches.
# New version with 5-example cap should be roughly 700-900 chars.
example_count = disk_message.count("    ")  # crude — counts the indented examples
print(f"[Indented example lines: ~{example_count}]")

assert len(disk_message) < 2000, f"Disk message exceeds 2000 chars: {len(disk_message)}"
assert "and 45 more" in disk_message, "Should indicate 45 more matches not shown"
assert "Microsoft" in disk_message
print("\n[PASS] Disk message is bounded and includes overflow indicator.")


# ---------------------------------------------------------------------------
# Test 2: Disk path with exactly cap+1 matches — exactly cap shown, 1 not shown.
# ---------------------------------------------------------------------------
section(f"Test 2: Disk path with exactly {AMBIGUITY_EXAMPLES_CAP + 1} matches")

stream = make_docx_with_many_microsofts(n=AMBIGUITY_EXAMPLES_CAP + 1)
engine = RedlineEngine(stream, author="Test")
edit = ModifyText(type="modify", target_text="Microsoft", new_text="MSFT")
errors = engine.validate_edits([edit])
assert len(errors) == 1
print(errors[0])
assert f"and 1 more" in errors[0]
print(f"\n[PASS] Shows {AMBIGUITY_EXAMPLES_CAP} examples + 'and 1 more' indicator.")


# ---------------------------------------------------------------------------
# Test 3: Disk path with exactly cap matches — all shown, no overflow indicator.
# ---------------------------------------------------------------------------
section(f"Test 3: Disk path with exactly {AMBIGUITY_EXAMPLES_CAP} matches")

stream = make_docx_with_many_microsofts(n=AMBIGUITY_EXAMPLES_CAP)
engine = RedlineEngine(stream, author="Test")
edit = ModifyText(type="modify", target_text="Microsoft", new_text="MSFT")
errors = engine.validate_edits([edit])
assert len(errors) == 1
print(errors[0])
assert "more occurrence" not in errors[0], "Should NOT have overflow indicator"
print(f"\n[PASS] Exactly {AMBIGUITY_EXAMPLES_CAP} examples, no overflow indicator.")


# ---------------------------------------------------------------------------
# Test 4: Disk path with 2 matches — minimum ambiguity case.
# ---------------------------------------------------------------------------
section("Test 4: Disk path with exactly 2 matches (minimum ambiguity)")

stream = make_docx_with_many_microsofts(n=2)
engine = RedlineEngine(stream, author="Test")
edit = ModifyText(type="modify", target_text="Microsoft", new_text="MSFT")
errors = engine.validate_edits([edit])
assert len(errors) == 1
print(errors[0])
assert "appears 2 times" in errors[0]
assert "more occurrence" not in errors[0]
print("\n[PASS] 2-match case formatted correctly, no overflow indicator.")


# ---------------------------------------------------------------------------
# Test 5: Live Word formatter parity. Simulate what Live Word would feed it.
# ---------------------------------------------------------------------------
section("Test 5: Live Word formatter call produces same shape as disk")

# Re-build a haystack the way Live Word's _clean_chars would for a doc with
# many Microsofts. We use the disk haystack as a proxy (the format helper
# doesn't care which haystack source it gets).
stream = make_docx_with_many_microsofts(n=50)
engine = RedlineEngine(stream, author="Test")
haystack = engine.mapper.full_text
appendix_start = engine.mapper.appendix_start_index
if appendix_start != -1:
    haystack = haystack[:appendix_start]

# Enumerate matches the way the Live Word path will after this fix.
all_positions = []
search_offset = 0
while True:
    rel_start, rel_end = _find_match_in_text(haystack[search_offset:], "Microsoft")
    if rel_start == -1:
        break
    abs_start = search_offset + rel_start
    abs_end = search_offset + rel_end
    all_positions.append((abs_start, abs_end))
    search_offset = abs_end

live_message = format_ambiguity_error(
    edit_index=1,
    target_text="Microsoft",
    haystack=haystack,
    match_positions=all_positions,
)

print(live_message)
print(f"\n[Length: {len(live_message)} characters]")

# Should be substantially identical to the disk version.
assert len(live_message) < 2000
assert "appears 50 times" in live_message
assert "and 45 more" in live_message
print("\n[PASS] Live Word formatter call produces equivalent bounded message.")


# ---------------------------------------------------------------------------
# Test 6: format_ambiguity_error rejects single-match input.
# ---------------------------------------------------------------------------
section("Test 6: format_ambiguity_error rejects single-match input")

try:
    format_ambiguity_error(
        edit_index=1,
        target_text="Microsoft",
        haystack="Microsoft is here.",
        match_positions=[(0, 9)],
    )
    print("[FAIL] Should have raised ValueError")
except ValueError as e:
    print(f"[PASS] Raised ValueError as expected: {e}")
