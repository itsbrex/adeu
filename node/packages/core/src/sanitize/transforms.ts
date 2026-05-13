import { DocumentObject, Part } from '../docx/bridge.js';
import { findAllDescendants, findChild, findChildren } from '../docx/dom.js';
import { extract_comments_data, CommentsManager } from '../comments.js';
import { RedlineEngine } from '../engine.js';

export function findDescendantsByLocalName(element: Element, localName: string): Element[] {
  const result: Element[] = [];
  const all = element.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    const tag = all[i].tagName;
    if (tag === localName || tag.endsWith(':' + localName)) {
      result.push(all[i]);
    }
  }
  return result;
}

export function strip_rsid(doc: DocumentObject): string[] {
  let count = 0;
  const rsidAttrs = ['w:rsidR', 'w:rsidRPr', 'w:rsidRDefault', 'w:rsidP', 'w:rsidDel', 'w:rsidSect', 'w:rsidTr'];
  
  const all = doc.element.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    for (const attr of rsidAttrs) {
      if (all[i].hasAttribute(attr)) {
        all[i].removeAttribute(attr);
        count++;
      }
    }
  }
  
  const rsidsElements = findAllDescendants(doc.element, 'w:rsids');
  for (const el of rsidsElements) {
    if (el.parentNode) {
      el.parentNode.removeChild(el);
      count++;
    }
  }
  
  return count ? [`rsid attributes: ${count} removed`] : [];
}

export function strip_para_ids(doc: DocumentObject): string[] {
  let count = 0;
  const attrs = ['w14:paraId', 'w14:textId'];
  const all = doc.element.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    for (const attr of attrs) {
      if (all[i].hasAttribute(attr)) {
        all[i].removeAttribute(attr);
        count++;
      }
    }
  }
  return count ? [`Paragraph/text IDs: ${count} removed`] : [];
}

export function strip_proof_errors(doc: DocumentObject): string[] {
  const elements = findAllDescendants(doc.element, 'w:proofErr');
  elements.forEach(el => el.parentNode?.removeChild(el));
  return elements.length ? [`Spell check markers: ${elements.length} removed`] : [];
}

export function strip_empty_properties(doc: DocumentObject): string[] {
  let count = 0;
  for (const tag of ['w:rPr', 'w:pPr']) {
    const elements = findAllDescendants(doc.element, tag);
    for (const el of elements) {
      if (el.childNodes.length === 0 || (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3 && !el.childNodes[0].textContent?.trim())) {
        el.parentNode?.removeChild(el);
        count++;
      }
    }
  }
  return count ? [`Empty property elements: ${count} removed`] : [];
}

export function strip_hidden_text(doc: DocumentObject): string[] {
  let count = 0;
  const elements = findAllDescendants(doc.element, 'w:rPr');
  for (const rPr of elements) {
    if (findChild(rPr, 'w:vanish') || findChild(rPr, 'w:webHidden')) {
      const run = rPr.parentNode as Element;
      if (run && run.tagName === 'w:r' && run.parentNode) {
        run.parentNode.removeChild(run);
        count++;
      }
    }
  }
  return count ? [`Hidden text runs: ${count} removed`] : [];
}

export function count_tracked_changes(doc: DocumentObject): [number, number, number] {
  const ins = findAllDescendants(doc.element, 'w:ins').length;
  const del = findAllDescendants(doc.element, 'w:del').length;
  const fmt = findAllDescendants(doc.element, 'w:rPrChange').length +
              findAllDescendants(doc.element, 'w:pPrChange').length +
              findAllDescendants(doc.element, 'w:sectPrChange').length;
  return [ins, del, fmt];
}

export function get_track_change_authors(doc: DocumentObject): Set<string> {
  const authors = new Set<string>();
  for (const tag of ['w:ins', 'w:del', 'w:rPrChange', 'w:pPrChange', 'w:sectPrChange']) {
    for (const el of findAllDescendants(doc.element, tag)) {
      const author = el.getAttribute('w:author');
      if (author) authors.add(author);
    }
  }
  return authors;
}

function _getElementText(el: Element): string {
  const texts: string[] = [];
  const ts = findAllDescendants(el, 'w:t');
  for (const t of ts) if (t.textContent) texts.push(t.textContent);
  const dts = findAllDescendants(el, 'w:delText');
  for (const dt of dts) if (dt.textContent) texts.push(dt.textContent);
  return texts.join('');
}

export function _truncate(text: string, maxLen: number = 60): string {
  const clean = text.replace(/\n/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return clean.substring(0, maxLen - 3) + "...";
}

export function accept_all_tracked_changes(doc: DocumentObject): string[] {
  const lines: string[] = [];
  const insEls = findAllDescendants(doc.element, 'w:ins');
  const delEls = findAllDescendants(doc.element, 'w:del');
  
  for (const ins of insEls) {
    const text = _getElementText(ins).trim();
    if (text) lines.push(`  Accepted insertion: "${_truncate(text, 60)}"`);
  }
  for (const del of delEls) {
    const text = _getElementText(del).trim();
    if (text) lines.push(`  Accepted deletion of: "${_truncate(text, 60)}"`);
  }

  const engine = new RedlineEngine(doc);
  engine.accept_all_revisions();

  for (const tag of ['w:rPrChange', 'w:pPrChange', 'w:sectPrChange']) {
    for (const el of findAllDescendants(doc.element, tag)) {
      el.parentNode?.removeChild(el);
    }
  }

  const total = insEls.length + delEls.length;
  if (total) {
    return [`Tracked changes auto-accepted: ${total}`].concat(lines);
  }
  return [];
}

export function get_comments_summary(doc: DocumentObject): any {
  const data = extract_comments_data(doc.pkg);
  const comments = [];
  let openCount = 0;
  let resolvedCount = 0;

  for (const [cId, info] of Object.entries(data)) {
    if (info.resolved) resolvedCount++;
    else openCount++;
    comments.push({ id: cId, ...info });
  }

  return { total: comments.length, open: openCount, resolved: resolvedCount, comments };
}

export function remove_all_comments(doc: DocumentObject): string[] {
  const data = extract_comments_data(doc.pkg);
  const keys = Object.keys(data);
  if (keys.length === 0) return [];

  const lines: string[] = [];
  const cm = new CommentsManager(doc);

  for (const [cId, info] of Object.entries(data)) {
    const status = info.resolved ? "[Resolved]" : "[Open]";
    lines.push(`  ${status} "${_truncate(info.text || '', 60)}" (${info.author || 'Unknown'})`);
    cm.deleteComment(cId);
  }

  for (const tag of ['w:commentRangeStart', 'w:commentRangeEnd', 'w:commentReference']) {
    for (const el of findAllDescendants(doc.element, tag)) {
      el.parentNode?.removeChild(el);
    }
  }

  const resolvedCount = Object.values(data).filter(c => c.resolved).length;
  const openCount = Object.values(data).filter(c => !c.resolved).length;
  return [`Comments removed: ${keys.length} (${resolvedCount} resolved, ${openCount} open)`].concat(lines);
}

export function replace_comment_authors(doc: DocumentObject, newAuthor: string): string[] {
  const cm = new CommentsManager(doc);
  if (!cm.commentsPart) return [];

  const original = new Set<string>();
  const comments = findAllDescendants(cm.commentsPart._element, 'w:comment');
  for (const c of comments) {
    const author = c.getAttribute('w:author');
    if (author) {
      original.add(author);
      c.setAttribute('w:author', newAuthor);
    }
    if (c.hasAttribute('w:initials')) {
      const initials = newAuthor.split(' ').filter(Boolean).map(p => p[0]).join('').toUpperCase();
      c.setAttribute('w:initials', initials);
    }
  }
  return original.size ? [`Comment authors replaced: ${Array.from(original).sort().join(', ')} → "${newAuthor}"`] : [];
}

export function replace_change_authors(doc: DocumentObject, newAuthor: string): string[] {
  const original = new Set<string>();
  for (const tag of ['w:ins', 'w:del', 'w:rPrChange', 'w:pPrChange']) {
    for (const el of findAllDescendants(doc.element, tag)) {
      const author = el.getAttribute('w:author');
      if (author) {
        original.add(author);
        el.setAttribute('w:author', newAuthor);
      }
    }
  }
  return original.size ? [`Track change authors replaced: ${Array.from(original).sort().join(', ')} → "${newAuthor}"`] : [];
}

export function normalize_change_dates(doc: DocumentObject): string[] {
  let count = 0;
  const fixed = "2025-01-01T00:00:00Z";
  for (const tag of ['w:ins', 'w:del', 'w:rPrChange', 'w:pPrChange']) {
    for (const el of findAllDescendants(doc.element, tag)) {
      if (el.hasAttribute('w:date')) {
        el.setAttribute('w:date', fixed);
        count++;
      }
    }
  }
  return count ? [`Track change timestamps: ${count} normalized`] : [];
}

export function scrub_doc_properties(doc: DocumentObject): string[] {
  const lines: string[] = [];
  const corePart = doc.pkg.getPartByPath('docProps/core.xml');
  if (corePart) {
    const creators = findDescendantsByLocalName(corePart._element, 'creator');
    creators.forEach(c => { if (c.textContent) { lines.push(`Author: ${c.textContent}`); c.textContent = ""; }});
    
    const modifiers = findDescendantsByLocalName(corePart._element, 'lastModifiedBy');
    modifiers.forEach(c => { if (c.textContent) { lines.push(`Last modified by: ${c.textContent}`); c.textContent = ""; }});
    
    const revisions = findDescendantsByLocalName(corePart._element, 'revision');
    revisions.forEach(c => { if (c.textContent && parseInt(c.textContent) > 1) { lines.push(`Revision count: ${c.textContent} → 1`); c.textContent = "1"; }});
  }

  const appPart = doc.pkg.getPartByPath('docProps/app.xml');
  if (appPart) {
    const docEl = appPart._element;
    const intFields = ["TotalTime", "Words", "Characters", "Paragraphs", "Lines", "CharactersWithSpaces"];
    for (const f of intFields) {
      findDescendantsByLocalName(docEl, f).forEach(el => {
        if (el.textContent && el.textContent !== "0") {
          if (f === "TotalTime") lines.push(`Total editing time: ${el.textContent} minutes`);
          el.textContent = "0";
        }
      });
    }
    const strFields = ["Template", "Manager", "Company"];
    for (const f of strFields) {
      findDescendantsByLocalName(docEl, f).forEach(el => {
        if (el.textContent) {
          lines.push(`${f}: ${el.textContent}`);
          el.textContent = "";
        }
      });
    }
  }

  return lines.length ? ["Metadata scrubbed:", ...lines.map(l => `  ${l}`)] : [];
}

export function scrub_timestamps(doc: DocumentObject): string[] {
  let modified = false;
  const epoch = "1970-01-01T00:00:00Z";
  const corePart = doc.pkg.getPartByPath('docProps/core.xml');
  if (corePart) {
    for (const tag of ['created', 'modified', 'lastPrinted']) {
      findDescendantsByLocalName(corePart._element, tag).forEach(el => {
        if (el.textContent && el.textContent !== epoch) {
          el.textContent = epoch;
          modified = true;
        }
      });
    }
  }
  return modified ? ["Timestamps normalized to epoch"] : [];
}

export function strip_custom_xml(doc: DocumentObject): string[] {
  const customParts = doc.pkg.parts.filter(p => p.partname.includes('/customXml'));
  if (customParts.length === 0) return [];

  const partnames = new Set(customParts.map(p => p.partname));
  doc.pkg.parts = doc.pkg.parts.filter(p => !partnames.has(p.partname));

  const removeRelationsTo = (relsPart: Part) => {
    const toRemove: Element[] = [];
    for (const rel of findAllDescendants(relsPart._element, 'Relationship')) {
      const target = rel.getAttribute('Target');
      if (target && target.includes('customXml')) toRemove.push(rel);
    }
    toRemove.forEach(r => r.parentNode?.removeChild(r));
  };

  const rootRels = doc.pkg.getPartByPath('_rels/.rels');
  if (rootRels) removeRelationsTo(rootRels);

  const docRels = doc.pkg.getOrCreateRelsPart(doc.part.partname);
  if (docRels) removeRelationsTo(docRels);

  for (const sdtPr of findAllDescendants(doc.element, 'w:sdtPr')) {
    findChildren(sdtPr, 'w:dataBinding').forEach(b => sdtPr.removeChild(b));
  }

  return [`Custom XML parts: ${customParts.length} removed`];
}

export function strip_image_alt_text(doc: DocumentObject): string[] {
  let count = 0;
  for (const docPr of findDescendantsByLocalName(doc.element, 'docPr')) {
    const descr = docPr.getAttribute('descr');
    if (descr) {
      const isShort = descr.length < 10;
      const isFile = descr.includes('.') && descr.length < 60;
      if (isShort || isFile) {
        docPr.removeAttribute('descr');
        count++;
      }
    }
  }
  return count ? [`Image alt text: ${count} auto-generated descriptions removed`] : [];
}

export function audit_hyperlinks(doc: DocumentObject): string[] {
  const internal = ["sharepoint.com", "onedrive.com", ".internal", "intranet", "localhost", "10.", "192.168.", "172.16."];
  const warnings: string[] = [];
  
  const docRels = doc.pkg.getOrCreateRelsPart(doc.part.partname);
  for (const rel of findAllDescendants(docRels._element, 'Relationship')) {
    if (rel.getAttribute('TargetMode') === 'External') {
      const url = rel.getAttribute('Target') || '';
      for (const pattern of internal) {
        if (url.toLowerCase().includes(pattern.toLowerCase())) {
          warnings.push(`Hyperlink targets internal URL: ${_truncate(url, 80)}`);
          break;
        }
      }
    }
  }
  return warnings;
}