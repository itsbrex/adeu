# Appendix Schema & Data Extraction Blueprint

This document defines the heuristics and XML crawl strategies for generating the read-only "Structural Appendix". Because this runs on every `read_docx` call, extraction must be single-pass where possible.

## 1. Definitions Detection (Heuristic)

Finding defined terms is an imprecise domain problem, but high-confidence heuristics cover 95% of standard legal templates.

### Extraction Strategy:
1.  **Definitions Section Scan:** 
    *   Locate paragraphs descending from a heading containing the word "Definitions".
    *   *Rule 1 (Quotes):* Extract text wrapped in double quotes at the start of a paragraph (e.g., `"Affiliate" means...` or `“Affiliate”`).
    *   *Rule 2 (Styling):* Extract the first italicized or bolded span in a list item/paragraph within this section.
2.  **Usage Counting (Global Scan):**
    *   Once a list of defined terms is collected, do a fast regex pass over the plain-text projection of the document.
    *   Regex: `\b{Term}\b` (Case-sensitive, whole word match).
    *   *Output:* `"Term" — defined in [Heading], used [X] times.`

## 2. Bookmarks & Back-References (Deterministic)

We must map the exact relationship between anchors and pointers.

### Extraction Strategy:
1.  **First Pass (Anchors):**
    *   Scan the document for `<w:bookmarkStart w:name="X">`. 
    *   Exclude internal noise bookmarks (e.g., names starting with `_GoBack` or `_MailAutoSig`).
    *   Record the text of the paragraph containing the bookmark (truncated to 60 chars) as the "Anchored to" text.
2.  **Second Pass (Pointers):**
    *   Scan the document for field codes: `<w:fldSimple w:instr="REF X">` or `<w:instrText>REF X</w:instrText>`.
    *   Record the text of the paragraph *containing* the reference as the "Referenced from" text.
3.  **Resolution:**
    *   Group by Bookmark ID.
    *   *Output:*
        ```
        - {Bookmark ID} → Anchored to: "{Heading/Para Text}"
          - Referenced from: "{Usage Para 1}", "{Usage Para 2}"
        ```

## 3. Table of Contents / Table of Authorities Boundaries

To prevent the LLM from attempting to edit auto-generated TOC text, we must collapse the entire block into a single `[~Table of Contents — N entries~]` token.

### Extraction Strategy:
Word TOCs are built using Field Codes, typically wrapped in an `sdt` (Structured Document Tag) but occasionally left bare.

1.  **Block Start Detection:**
    *   Scan for `<w:fldChar w:fldCharType="begin">` immediately followed by `<w:instrText>TOC ...</w:instrText>`.
    *   OR scan for `<w:sdt>` containing `<w:docPartGallery w:val="Table of Contents"/>`.
2.  **Entry Counting:**
    *   Count the number of `w:p` tags containing `w:hyperlink` or `PAGEREF` fields within the block.
3.  **Block End Detection:**
    *   Continue consuming paragraphs until `<w:fldChar w:fldCharType="end">` is reached for the TOC field, OR the closing `</w:sdt>` is reached.
4.  **Mapper Rule:**
    *   The `DocumentMapper` registers the *entire block of XML* as a single Virtual Span corresponding to the placeholder text. The real text inside the TOC is never projected to the LLM.