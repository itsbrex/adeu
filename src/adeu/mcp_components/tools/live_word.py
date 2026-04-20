import logging
import re
import sys
from pathlib import Path
from typing import List, Optional

from fastmcp import Context
from fastmcp.exceptions import ToolError
from fastmcp.tools.tool import ToolResult

if sys.platform == "win32":
    import pythoncom
    import win32com.client

    from adeu.ingest import _build_merged_meta_block, _get_wrappers
    from adeu.markup import _find_match_in_text
    from adeu.models import AcceptChange, DocumentChange, ModifyText, RejectChange, ReplyComment
    from adeu.utils.docx import DocxEvent

    logger = logging.getLogger(__name__)

    def _strip_critic_markup(text: str) -> str:
        """Removes CriticMarkup tags so raw text can be found via Word's native Find."""
        if not text:
            return ""
        text = re.sub(r"\{--.*?--\}", "", text)
        text = re.sub(r"\{>>.*?<<\}", "", text)
        text = re.sub(r"\{\+\+(.*?)\+\+\}", r"\1", text)
        text = re.sub(r"\{==(.*?)==\}", r"\1", text)
        return text

    async def read_active_word_document(
        ctx: Context,
        clean_view: bool = False,
    ) -> ToolResult:
        await ctx.info("Connecting to active Word application...")
        pythoncom.CoInitialize()
        try:
            try:
                app = win32com.client.GetActiveObject("Word.Application")
                doc = app.ActiveDocument
            except Exception as e:
                raise ToolError(f"Could not connect to active Word document. {e}") from e

            raw_text = doc.Content.Text
            if raw_text is None:
                return ToolResult(content="", structured_content={"markdown": "", "title": "Live Word Document"})

            if clean_view:
                clean_text = raw_text.replace("\r", "\n")
                return ToolResult(
                    content=clean_text, structured_content={"markdown": clean_text, "title": "Live Word Document"}
                )

            annotations = []

            # 1. Extract Revisions
            for i in range(1, doc.Revisions.Count + 1):
                try:
                    rev = doc.Revisions(i)
                    if rev.Type in (1, 2):  # 1: Insert, 2: Delete
                        text = rev.Range.Text or ""
                        annotations.append(
                            {
                                "start": rev.Range.Start,
                                "end": rev.Range.End,
                                "text": text,
                                "type": "insert" if rev.Type == 1 else "delete",
                                "id": str(i),
                                "author": rev.Author,
                                "date": str(rev.Date) if hasattr(rev, "Date") else "",
                            }
                        )
                except Exception as e:
                    logger.warning(f"Failed to read revision {i}: {e}")

            # 2. Extract Comments
            comments_data = {}
            for i in range(1, doc.Comments.Count + 1):
                try:
                    com = doc.Comments(i)
                    text = com.Scope.Text or ""
                    cid = str(i)
                    author = com.Author
                    date = str(com.Date) if hasattr(com, "Date") else ""
                    content = com.Range.Text.strip().replace("\r", " ")

                    annotations.append(
                        {
                            "start": com.Scope.Start,
                            "end": com.Scope.End,
                            "text": text,
                            "type": "comment",
                            "id": cid,
                            "author": author,
                            "date": date,
                        }
                    )
                    comments_data[cid] = {
                        "author": author,
                        "text": content,
                        "date": date,
                        "resolved": False,
                        "parent_id": None,
                    }
                except Exception as e:
                    logger.warning(f"Failed to read comment {i}: {e}")

            # 3. Anchor annotations to raw_text to bypass COM offset drift
            mapped_annotations = []
            for ann in annotations:
                text_to_find = ann["text"]
                start_hint = ann["start"]

                if not text_to_find:
                    # Point-comment or empty revision
                    ann["mapped_start"] = min(start_hint, len(raw_text))
                    ann["mapped_end"] = ann["mapped_start"]
                    ann["inner_override"] = ""
                    mapped_annotations.append(ann)
                    continue

                # Slice a search window around the expected offset
                window_start = max(0, start_hint - 200)
                window_end = min(len(raw_text), start_hint + len(text_to_find) + 200)
                window_text = raw_text[window_start:window_end]

                rel_start, rel_end = _find_match_in_text(
                    window_text.replace("\r", "\n"), text_to_find.replace("\r", "\n")
                )

                if rel_start != -1:
                    ann["mapped_start"] = window_start + rel_start
                    ann["mapped_end"] = window_start + rel_end
                else:
                    # Fallback for text hidden from doc.Content.Text (like deletions)
                    ann["mapped_start"] = min(start_hint, len(raw_text))
                    ann["mapped_end"] = ann["mapped_start"]
                    ann["inner_override"] = text_to_find

                mapped_annotations.append(ann)

            # 4. Build sequential Event list exactly like ingest.py
            events_by_idx = {}
            for ann in mapped_annotations:
                start = ann["mapped_start"]
                end = ann["mapped_end"]
                uid = ann["id"]
                auth = ann.get("author", "Unknown")
                date = ann.get("date", "")

                if "inner_override" in ann:
                    text_val = ann["inner_override"]
                    if ann["type"] == "delete":
                        events_by_idx.setdefault(start, []).extend(
                            [DocxEvent("del_start", uid, auth, date), text_val, DocxEvent("del_end", uid)]
                        )
                    elif ann["type"] == "insert":
                        events_by_idx.setdefault(start, []).extend(
                            [DocxEvent("ins_start", uid, auth, date), text_val, DocxEvent("ins_end", uid)]
                        )
                    elif ann["type"] == "comment":
                        events_by_idx.setdefault(start, []).extend(
                            [DocxEvent("start", uid), text_val, DocxEvent("end", uid)]
                        )
                else:
                    if ann["type"] == "insert":
                        events_by_idx.setdefault(start, []).append(DocxEvent("ins_start", uid, auth, date))
                        events_by_idx.setdefault(end, []).append(DocxEvent("ins_end", uid))
                    elif ann["type"] == "delete":
                        events_by_idx.setdefault(start, []).append(DocxEvent("del_start", uid, auth, date))
                        events_by_idx.setdefault(end, []).append(DocxEvent("del_end", uid))
                    elif ann["type"] == "comment":
                        events_by_idx.setdefault(start, []).append(DocxEvent("start", uid))
                        events_by_idx.setdefault(end, []).append(DocxEvent("end", uid))

            items = []
            last_idx = 0
            indices = sorted(list(set([0, len(raw_text)] + list(events_by_idx.keys()))))

            for idx in indices:
                if idx > last_idx:
                    text_seg = raw_text[last_idx:idx]
                    if text_seg:
                        items.append(text_seg)
                    last_idx = idx

                if idx in events_by_idx:
                    evts = events_by_idx[idx]

                    def evt_sort_key(e):
                        if isinstance(e, str):
                            return 1
                        if "end" in e.type:
                            return 0
                        return 2

                    evts.sort(key=evt_sort_key)
                    items.extend(evts)

            # 5. Mirror the ingest.py State Machine
            active_ins = {}
            active_del = {}
            active_comments = set()
            deferred_meta_states = []
            pending_text = ""
            current_wrappers = ("", "")
            parts = []

            for i, item in enumerate(items):
                if isinstance(item, str):
                    seg = item

                    if clean_view and active_del:
                        continue

                    if seg:
                        if clean_view:
                            new_wrappers = ("", "")
                        else:
                            new_wrappers = _get_wrappers(active_ins, active_del, active_comments)

                        if pending_text and new_wrappers == current_wrappers:
                            pending_text += seg
                        else:
                            if pending_text:
                                s_tok, e_tok = current_wrappers
                                parts.append(f"{s_tok}{pending_text}{e_tok}")
                            pending_text = seg
                            current_wrappers = new_wrappers

                        if not clean_view:
                            current_state = (active_ins.copy(), active_del.copy(), active_comments.copy())
                            deferred_meta_states.append(current_state)

                            should_defer = False
                            is_redline = bool(active_ins) or bool(active_del)
                            if is_redline:
                                j = i + 1
                                next_is_redline = False
                                temp_ins = len(active_ins)
                                temp_del = len(active_del)
                                while j < len(items):
                                    next_item = items[j]
                                    if isinstance(next_item, str):
                                        if temp_ins > 0 or temp_del > 0:
                                            next_is_redline = True
                                        break
                                    elif isinstance(next_item, DocxEvent):
                                        if next_item.type == "ins_start":
                                            temp_ins += 1
                                        elif next_item.type == "ins_end":
                                            temp_ins = max(0, temp_ins - 1)
                                        elif next_item.type == "del_start":
                                            temp_del += 1
                                        elif next_item.type == "del_end":
                                            temp_del = max(0, temp_del - 1)
                                    j += 1

                                if next_is_redline:
                                    should_defer = True

                            if not should_defer:
                                if pending_text:
                                    s_tok, e_tok = current_wrappers
                                    parts.append(f"{s_tok}{pending_text}{e_tok}")
                                    pending_text = ""
                                    current_wrappers = ("", "")

                                meta_block = _build_merged_meta_block(deferred_meta_states, comments_data)
                                if meta_block:
                                    parts.append(f"{{>>{meta_block}<<}}")
                                deferred_meta_states = []

                elif isinstance(item, DocxEvent):
                    if pending_text:
                        s_tok, e_tok = current_wrappers
                        parts.append(f"{s_tok}{pending_text}{e_tok}")
                        pending_text = ""
                        current_wrappers = ("", "")

                    if item.type == "start":
                        active_comments.add(item.id)
                    elif item.type == "end":
                        active_comments.discard(item.id)
                    elif item.type == "ins_start":
                        active_ins[item.id] = item
                    elif item.type == "ins_end":
                        active_ins.pop(item.id, None)
                    elif item.type == "del_start":
                        active_del[item.id] = item
                    elif item.type == "del_end":
                        active_del.pop(item.id, None)

            if pending_text:
                s_tok, e_tok = current_wrappers
                parts.append(f"{s_tok}{pending_text}{e_tok}")

            if deferred_meta_states:
                meta_block = _build_merged_meta_block(deferred_meta_states, comments_data)
                if meta_block:
                    parts.append(f"{{>>{meta_block}<<}}")

            final_text = "".join(parts).replace("\r", "\n")

            return ToolResult(
                content=final_text,
                structured_content={
                    "markdown": final_text,
                    "title": "Live Word Document",
                },
            )

        finally:
            # Omitted CoUninitialize() to prevent GC access violations.
            pass

    async def process_active_word_batch(
        ctx: Context,
        changes: List[DocumentChange],
        author_name: str,
    ) -> str:
        if not changes:
            return "No changes provided."

        if not author_name or not author_name.strip():
            return "Error: author_name cannot be empty."

        await ctx.info(f"Applying {len(changes)} changes to live Word document...")
        pythoncom.CoInitialize()
        try:
            try:
                app = win32com.client.GetActiveObject("Word.Application")
                doc = app.ActiveDocument
            except Exception as e:
                raise ToolError(f"Could not connect to active Word document. {e}") from e

            original_track_revisions = doc.TrackRevisions
            doc.TrackRevisions = True

            original_user = app.UserName
            app.UserName = author_name

            stats = {"applied": 0, "failed": 0}

            # Pre-resolve Revision objects to prevent index drift.
            revisions_map = {}
            try:
                for i in range(1, doc.Revisions.Count + 1):
                    revisions_map[f"Chg:{i}"] = doc.Revisions(i)
            except Exception as e:
                logger.warning(f"Failed to pre-resolve revisions: {e}")

            try:
                for change in changes:
                    try:
                        if isinstance(change, ModifyText):
                            clean_target = _strip_critic_markup(change.target_text)
                            current_text = doc.Content.Text.replace("\r", "\n")
                            start_idx, end_idx = _find_match_in_text(current_text, clean_target)

                            if start_idx != -1:
                                exact_substring = doc.Content.Text[start_idx:end_idx]

                                search_start = max(0, start_idx - 200)
                                search_end = min(doc.Content.End, end_idx + 200)
                                rng = doc.Range(Start=search_start, End=search_end)

                                search_text = exact_substring[:250] if len(exact_substring) > 250 else exact_substring

                                rng.Find.ClearFormatting()
                                rng.Find.Text = search_text
                                rng.Find.Forward = True
                                rng.Find.Wrap = 0  # wdFindStop

                                if rng.Find.Execute():
                                    actual_start = rng.Start
                                    replace_rng = doc.Range(Start=actual_start, End=actual_start + len(exact_substring))
                                    replace_rng.Text = change.new_text.replace("\n", "\r")
                                    if change.comment:
                                        doc.Comments.Add(replace_rng, change.comment)
                                    stats["applied"] += 1
                                else:
                                    # Fallback: search entire document
                                    doc_rng = doc.Content
                                    doc_rng.Find.ClearFormatting()
                                    doc_rng.Find.Text = search_text
                                    if doc_rng.Find.Execute():
                                        replace_rng = doc.Range(
                                            Start=doc_rng.Start, End=doc_rng.Start + len(exact_substring)
                                        )
                                        replace_rng.Text = change.new_text.replace("\n", "\r")
                                        if change.comment:
                                            doc.Comments.Add(replace_rng, change.comment)
                                        stats["applied"] += 1
                                    else:
                                        stats["failed"] += 1
                            else:
                                stats["failed"] += 1
                                await ctx.warning(f"Could not find target text: '{change.target_text[:30]}...'")

                        elif isinstance(change, AcceptChange):
                            if change.target_id in revisions_map:
                                revisions_map[change.target_id].Accept()
                                stats["applied"] += 1
                            else:
                                stats["failed"] += 1
                                await ctx.warning(f"Revision {change.target_id} not found or lost to drift.")

                        elif isinstance(change, RejectChange):
                            if change.target_id in revisions_map:
                                revisions_map[change.target_id].Reject()
                                stats["applied"] += 1
                            else:
                                stats["failed"] += 1
                                await ctx.warning(f"Revision {change.target_id} not found or lost to drift.")

                        elif isinstance(change, ReplyComment):
                            idx = int(change.target_id.split(":")[1])
                            com = doc.Comments(idx)
                            try:
                                com.Replies.Add(com.Range, change.text)
                            except Exception:
                                doc.Comments.Add(com.Range, change.text)
                            stats["applied"] += 1

                    except Exception as e:
                        stats["failed"] += 1
                        await ctx.error(f"Failed to apply change {getattr(change, 'type', 'Unknown')}: {e}")

            finally:
                app.UserName = original_user
                doc.TrackRevisions = original_track_revisions

            return f"Live Word Batch complete. Applied: {stats['applied']}, Failed: {stats['failed']}."

        finally:
            pass

    async def open_word_document_impl(ctx: Context, file_path: str, visible: bool = True) -> str:
        await ctx.info(f"Opening {file_path} in Word...")
        pythoncom.CoInitialize()
        try:
            abs_path = str(Path(file_path).resolve())

            # Dispatch starts a new instance or connects to an existing one
            app = win32com.client.Dispatch("Word.Application")
            app.Visible = visible
            if visible:
                try:
                    app.Activate()
                except Exception:
                    pass

            app.Documents.Open(abs_path)
            return f"Successfully opened {abs_path} in Microsoft Word."
        except Exception as e:
            raise ToolError(f"Failed to open document in Word. {e}") from e
        finally:
            pass

    async def save_active_word_document_impl(
        ctx: Context, output_path: Optional[str] = None, close: bool = False
    ) -> str:
        await ctx.info("Saving active Word document...")
        pythoncom.CoInitialize()
        try:
            app = win32com.client.GetActiveObject("Word.Application")
            doc = app.ActiveDocument

            if output_path:
                abs_path = str(Path(output_path).resolve())
                doc.SaveAs2(abs_path)
                msg = f"Successfully saved active document as: {abs_path}"
            else:
                doc.Save()
                msg = "Successfully saved active document."

            if close:
                doc.Close(0)  # 0 = wdDoNotSaveChanges (since we just saved it)
                msg += " Document closed."

            return msg
        except Exception as e:
            raise ToolError(f"Failed to save active Word document. {e}") from e
        finally:
            pass
