# Engineering Policy: Link & Reference Resolution

This matrix defines the exact behavior the `RedlineEngine` must execute when a `ModifyText` operation intersects with a link or reference.

## 1. External Hyperlinks (`<w:hyperlink>`)

Hyperlinks consist of Virtual Wrappers (`[` and `](URL)`) and Real Text Runs (`Visible Text`). 

| LLM Edit Intent | Condition Detected | Action Required | Reviewer Visibility |
| :--- | :--- | :--- | :--- |
| **Display Text Edit** | The text inside `[]` changed. URL inside `()` is unchanged. | 1. Apply `<w:del>` and `<w:ins>` directly to the `<w:r>` tags *inside* the parent `<w:hyperlink>`. <br> 2. Ensure nested formatting (`<w:b>`) on the display text is preserved. | Tracked Change (Redline) |
| **URL Retargeting** (Existing Target Type) | The text inside `[]` is unchanged. The URL inside `()` changed to another valid external URL. | 1. Find the `r:id` on the `<w:hyperlink>`.<br>2. Look up the relationship in `word/_rels/document.xml.rels`.<br>3. Overwrite the `Target` attribute. | **Silent Update**<br>(Caught only by `diff_docx_files`) |
| **Both Edited** | Both `[]` and `()` contents changed. | Execute both actions above simultaneously. | Partial (Text is redlined, URL is silent) |

## 2. Cross-References (`<w:fldSimple>` / `<w:instrText>`)

Cross-references use the syntax `[~Display Text~](#_RefTarget)`. 

Because cross-reference display text is computed by MS Word on field refresh, allowing text edits here creates fatal synchronization issues. Allowing LLMs to retarget the hash via Markdown risks silently breaking the document's dependency graph.

| LLM Edit Intent | Condition Detected | Action Required | Reviewer Visibility |
| :--- | :--- | :--- | :--- |
| **Display Text Edit** | The text inside `[~` and `~]` changed. | **REJECT EDIT**. <br> Raise `BatchValidationError`: *"Cross-reference display text is computed from the target. To change what this reference says, edit the heading or paragraph at the target instead."* | N/A |
| **Hash Retargeting** | The target hash inside `(#...)` changed. | **REJECT EDIT**. <br> Raise `BatchValidationError`: *"Directly retargeting cross-references via text replacement is disallowed to prevent dependency corruption. Edit the target text directly."* | N/A |

### 2.1 Exception: Structural Deletion
If an LLM deletes an *entire block of text* (e.g., an entire paragraph) that happens to contain a cross-reference, the deletion **MUST BE ALLOWED**. 
*   **Mechanism:** The `ModifyText` operation targets the surrounding text, and the `[~...~](#...)` span is fully consumed within the deleted region. The engine wraps the `<w:fldSimple>` inside a `<w:del>` tag.