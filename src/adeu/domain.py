import re
from typing import Any, Dict, List

from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph

from adeu.utils.docx import get_run_text, iter_block_items


def _get_paragraph_text(p: Paragraph) -> str:
    return "".join(get_run_text(r) for r in p.runs)


def extract_definitions(doc, base_text: str) -> dict:
    """
    Heuristically extracts terms wrapped in quotes inside a 'Definitions' section
    and calculates their usage frequency in the full text.
    """
    definitions = {}
    in_definitions_section = False

    for item in iter_block_items(doc):
        if isinstance(item, Paragraph):
            style_name = ""
            try:
                if item.style:
                    style_name = item.style.name or ""
            except AttributeError:
                pass

            text = _get_paragraph_text(item).strip()

            if style_name.startswith("Heading"):
                if "definitions" in text.lower():
                    in_definitions_section = True
                else:
                    in_definitions_section = False

            if in_definitions_section and text:
                # Look for "Term" or “Term” at the beginning of the paragraph
                match = re.match(r"^[\"“]([^\”\"]+)[\"”]", text)
                if match:
                    term = match.group(1)
                    count = len(re.findall(rf"\b{re.escape(term)}\b", base_text))
                    definitions[term] = count
    return definitions


def extract_anchors(doc) -> Dict[str, Dict[str, Any]]:
    """
    Deterministically builds a dependency map of Bookmarks and Cross-References.
    """
    anchors: Dict[str, Dict[str, Any]] = {}

    # Pass 1: Find bookmarks
    for item in iter_block_items(doc):
        if isinstance(item, Paragraph):
            for node in item._element.iter():
                if node.tag == qn("w:bookmarkStart"):
                    b_name = node.get(qn("w:name"))
                    if b_name and not b_name.startswith("_GoBack") and not b_name.startswith("_MailAutoSig"):
                        if b_name not in anchors:
                            text = _get_paragraph_text(item).strip()
                            anchors[b_name] = {
                                "anchored_to": text[:60] + ("..." if len(text) > 60 else ""),
                                "referenced_from": [],
                            }

    # Pass 2: Find references
    for item in iter_block_items(doc):
        if isinstance(item, Paragraph):
            p_text = _get_paragraph_text(item).strip()
            for node in item._element.iter():
                target = None
                if node.tag == qn("w:fldSimple"):
                    instr = node.get(qn("w:instr"), "")
                    parts = instr.strip().split()
                    if parts and parts[0] == "REF" and len(parts) > 1:
                        target = parts[1]
                elif node.tag == qn("w:instrText"):
                    instr = node.text or ""
                    parts = instr.strip().split()
                    if parts and parts[0] == "REF" and len(parts) > 1:
                        target = parts[1]

                if target and target in anchors:
                    anchors[target]["referenced_from"].append(p_text[:60] + ("..." if len(p_text) > 60 else ""))

    return anchors


def build_structural_appendix(doc, base_text: str) -> str:
    """
    Compiles the Read-Only Structural Appendix block for the agent.
    Returns an empty string if no relevant domain metadata is found.
    """
    defs = extract_definitions(doc, base_text)
    anchors = extract_anchors(doc)

    lines: List[str] = [
        "\n\n---",
        "",
        "<!-- READONLY_BOUNDARY_START -->",
        "# Document Structure (Read-Only)",
        (
            "The content below is metadata describing the document's reference structure. "
            "Do not include this section in any tracked changes or edits — it is for your "
            "context only and will be discarded on write."
        ),
    ]

    has_content = False

    if defs:
        has_content = True
        lines.append("\n## Defined Terms")
        for term, count in defs.items():
            lines.append(f'- "{term}" — used {count} times.')

    if anchors:
        has_content = True
        lines.append("\n## Named Anchors")
        for b_name, data in anchors.items():
            lines.append(f'- {b_name} → Anchored to: "{data["anchored_to"]}"')
            for ref in data["referenced_from"]:
                lines.append(f'  - Referenced from: "{ref}"')

    if has_content:
        return "\n".join(lines)
    return ""
