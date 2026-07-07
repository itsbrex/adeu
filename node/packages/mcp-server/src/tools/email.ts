import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { DesktopAuthManager, getCloudAuthToken } from "../desktop-auth.js";
import { BACKEND_URL } from "../shared.js";
import { ToolResult } from "../response-builders.js";
import { createHash } from "node:crypto";
const KNOWN_ERROR_HINTS: Record<string, string> = {
  "Email not found.":
    "The email ID was not found. If this was a short ID (msg_*), it may have been " +
    "evicted from the local cache or come from a different machine — re-run " +
    "search_and_fetch_emails with filters to get a fresh ID. If it was an " +
    "adeu_<numeric> or raw provider ID, verify it's correct. If the email lives in " +
    "a shared or secondary mailbox, pass `mailbox_address` explicitly — provider " +
    "IDs only resolve within the mailbox they came from.",
  "Adeu email reference not found.":
    "The adeu_<id> reference doesn't resolve to any processed email for this user. " +
    "Verify the ID, or re-run search_and_fetch_emails with filters to find the message.",
  "Invalid adeu_ email ID format.":
    "The adeu_<id> reference is malformed. Expected format: adeu_<integer>.",
};

function lookupErrorHint(detail: string): string | undefined {
  let hint = KNOWN_ERROR_HINTS[detail];
  if (
    !hint &&
    detail.startsWith("Mailbox '") &&
    detail.endsWith("' not found.")
  ) {
    const mailbox = detail.slice("Mailbox '".length, -"' not found.".length);
    hint =
      `The mailbox '${mailbox}' is not connected to your Adeu account. ` +
      "Call list_available_mailboxes to see valid mailbox addresses, then retry " +
      "with one of those as `mailbox_address`.";
  }
  return hint;
}

function formatBackendError(statusCode: number, responseBody: string): string {
  let detail = responseBody;
  try {
    const parsed = JSON.parse(responseBody);
    if (parsed && typeof parsed === "object" && "detail" in parsed) {
      detail = String(parsed.detail);
    }
  } catch {
    // responseBody isn't JSON — use it as-is
  }

  const message = lookupErrorHint(detail) ?? detail;
  return `Cloud search failed (HTTP ${statusCode}): ${message}`;
}
function isTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  return name === "TimeoutError" || name === "AbortError";
}

const CACHE_FILE = join(homedir(), ".adeu", "mcp_id_cache.json");
const MAX_CACHE_SIZE = 1000;

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Cache values are either legacy plain strings (the real provider ID) or
// objects {id, mailbox}. The mailbox matters: provider message IDs are
// mailbox-scoped, so a later fetch/reply must target the same mailbox or the
// backend resolves against the PRIMARY account and 404s with "Email not found."
type CacheEntry = string | { id?: string; mailbox?: string | null };

function cacheEntryParts(entry: CacheEntry | undefined): {
  id: string | null;
  mailbox: string | null;
} {
  if (!entry) return { id: null, mailbox: null };
  if (typeof entry === "string") return { id: entry, mailbox: null };
  return { id: entry.id ?? null, mailbox: entry.mailbox ?? null };
}

function loadIdCache(): Record<string, CacheEntry> {
  if (existsSync(CACHE_FILE)) {
    try {
      return JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
    } catch {
      return {};
    }
  }
  return {};
}

function saveIdCache(cache: Record<string, CacheEntry>): void {
  try {
    mkdirSync(join(homedir(), ".adeu"), { recursive: true });
    const keys = Object.keys(cache);
    if (keys.length > MAX_CACHE_SIZE) {
      const trimmed: Record<string, CacheEntry> = {};
      keys.slice(-MAX_CACHE_SIZE).forEach((k) => (trimmed[k] = cache[k]));
      cache = trimmed;
    }
    writeFileSync(CACHE_FILE, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
}

function minifyEmailId(
  realId: string,
  cache: Record<string, CacheEntry>,
  mailboxAddress?: string | null,
): string {
  if (!realId) return realId;
  const hash = createHash("md5").update(realId).digest("hex").slice(0, 6);
  const shortId = `msg_${hash}`;
  cache[shortId] = { id: realId, mailbox: mailboxAddress ?? null };
  return shortId;
}

class StaleShortIdError extends Error {
  constructor(shortId: string) {
    super(
      `Short ID '${shortId}' is not in the local cache (it may have been evicted, or it came from a different machine/session). ` +
        `Short IDs only persist on the machine where they were generated. ` +
        `Re-run search_and_fetch_emails with filters (sender, subject, days_ago) to fetch fresh IDs, then use the new ID from those results.`,
    );
    this.name = "StaleShortIdError";
  }
}

function resolveEmailId(shortId: string): string {
  if (!shortId) return shortId;
  // adeu_<id> references are resolved server-side, pass through.
  if (shortId.startsWith("adeu_")) return shortId;
  const cache = loadIdCache();
  const { id } = cacheEntryParts(cache[shortId]);
  if (id) return id;
  // If it looks like one of our short IDs but isn't in the cache, fail loudly
  // instead of silently passing a meaningless string to the provider.
  if (shortId.startsWith("msg_")) {
    throw new StaleShortIdError(shortId);
  }
  // Otherwise treat it as a raw provider ID
  return shortId;
}

function resolveCachedMailbox(shortId: string): string | null {
  if (!shortId || !shortId.startsWith("msg_")) return null;
  return cacheEntryParts(loadIdCache()[shortId]).mailbox;
}

const HTML_NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  copy: "\u00A9",
  reg: "\u00AE",
  trade: "\u2122",
  hellip: "\u2026",
  mdash: "\u2014",
  ndash: "\u2013",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201C",
  rdquo: "\u201D",
  laquo: "\u00AB",
  raquo: "\u00BB",
  bull: "\u2022",
  middot: "\u00B7",
  deg: "\u00B0",
  plusmn: "\u00B1",
  times: "\u00D7",
  divide: "\u00F7",
  euro: "\u20AC",
  pound: "\u00A3",
  yen: "\u00A5",
  cent: "\u00A2",
  sect: "\u00A7",
  para: "\u00B6",
  iexcl: "\u00A1",
  iquest: "\u00BF",
};

function decodeHtmlEntities(text: string): string {
  // Numeric: &#1234; (decimal) and &#x1F4A9; (hex)
  text = text.replace(/&#(\d+);/g, (_, dec: string) => {
    const code = parseInt(dec, 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : _;
  });
  text = text.replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex: string) => {
    const code = parseInt(hex, 16);
    return Number.isFinite(code) ? String.fromCodePoint(code) : _;
  });
  // Named: &amp;, &rsquo;, etc.
  text = text.replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (match, name: string) => {
    const replacement = HTML_NAMED_ENTITIES[name.toLowerCase()];
    return replacement !== undefined ? replacement : match;
  });
  return text;
}

function stripTags(html: string): string {
  if (!html) return "";

  // 1. Strip suppressed blocks (style/script/head/title) — loop until stable to
  //    handle nested or malformed blocks. Matches Python MLStripper's structural
  //    suppression rather than relying on a single greedy pass.
  let text = html;
  const suppressPattern =
    /<(style|script|head|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
  let prev: string;
  do {
    prev = text;
    text = text.replace(suppressPattern, "");
  } while (text !== prev);

  // 2. Also strip orphan open tags for suppressed blocks (unclosed <style ...>)
  //    by killing from the open tag to end of document — safer than leaking CSS
  //    into the LLM output.
  text = text.replace(/<(style|script|head|title)\b[^>]*>[\s\S]*$/gi, "");

  // 3. Convert block-level closing tags to newlines so paragraph structure survives
  text = text.replace(
    /<\/?(p|div|br|hr|tr|li|h[1-6]|blockquote)\b[^>]*>/gi,
    "\n",
  );

  // 4. Strip all remaining tags
  text = text.replace(/<[^>]+>/g, "");

  // 5. Decode HTML entities (named + numeric, matches Python's html.unescape).
  text = decodeHtmlEntities(text);

  // 6. Collapse triple-or-more newlines down to a paragraph break
  return text.replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
}

function removeNestedQuotes(text: string): string {
  if (!text) return "";

  // Localized "From:" header tokens from Outlook in major European locales.
  // Order matters only for readability; matching is anchored independently.
  const fromTokens = [
    "From", // English
    "Lähettäjä", // Finnish
    "Från", // Swedish
    "Von", // German
    "De", // French / Spanish / Portuguese
    "Da", // Italian
    "Van", // Dutch
    "Fra", // Norwegian / Danish
    "Mittente", // Italian (alt)
  ];

  // Localized "Sent:" tokens (paired with From: in Outlook quote blocks)
  const sentTokens = [
    "Sent",
    "Lähetetty",
    "Skickat",
    "Gesendet",
    "Envoyé",
    "Enviado",
    "Inviato",
    "Verzonden",
    "Sendt",
  ];

  // Localized "On ... wrote:" / "X wrote on Y:" patterns from Gmail-style clients
  const wrotePatterns = [
    /On .{1,200}? wrote:/, // English
    /Le .{1,200}? a écrit\s*:/i, // French
    /Am .{1,200}? schrieb .{1,100}?:/i, // German
    /El .{1,200}? escribió\s*:/i, // Spanish
    /Il .{1,200}? ha scritto\s*:/i, // Italian
    /Op .{1,200}? schreef .{1,100}?:/i, // Dutch
    /Den .{1,200}? skrev .{1,100}?:/i, // Swedish/Norwegian/Danish
    /Em .{1,200}? escreveu\s*:/i, // Portuguese
    /Em\b.{1,200}?, .{1,200}? escreveu\s*:/i, // Portuguese (date prefix)
    new RegExp(
      `^(${fromTokens.join("|")})\\s*:.*?\\n(?:.*\\n){0,5}?(${sentTokens.join("|")})\\s*:`,
      "m",
    ),
  ];

  // Localized "Forwarded message" markers across the same locale set.
  // Once hit, everything below is a quoted historical message and should be cut.
  const forwardedTokens = [
    "Forwarded message",
    "Välitetty viesti",
    "Vidarebefordrat meddelande",
    "Weitergeleitete Nachricht",
    "Message transféré",
    "Mensaje reenviado",
    "Messaggio inoltrato",
    "Doorgestuurd bericht",
    "Videresendt melding",
    "Videresendt meddelelse",
    "Mensagem encaminhada",
  ].join("|");

  const dividerPatterns = [
    /_{10,}/m,
    /-----\s*(Original Message|Alkuperäinen viesti|Ursprüngliches Nachricht|Message d'origine|Mensaje original|Messaggio originale|Oorspronkelijk bericht|Original meddelande)\s*-----/im,
    /^(Original Message|Alkuperäinen viesti|Ursprüngliches Nachricht|Message d'origine|Mensaje original|Messaggio originale|Oorspronkelijk bericht)$/im,
    // Gmail/Outlook-style "---------- Forwarded message ---------" with localized variants
    new RegExp(`-+\\s*(${forwardedTokens})\\s*-+`, "i"),
    new RegExp(`^(${forwardedTokens})$`, "im"),
  ];

  const allPatterns = [...wrotePatterns, ...dividerPatterns];

  let earliestCut = text.length;
  for (const pattern of allPatterns) {
    const match = pattern.exec(text);
    if (match && match.index < earliestCut) {
      earliestCut = match.index;
    }
  }
  return text.substring(0, earliestCut).trim();
}

function getUniqueFilepath(saveDir: string, filename: string): string {
  // Re-fetches of the same email overwrite the existing file rather than
  // accumulating `_1`, `_2`, `_3` copies. The `<short_id>/` subdirectory
  // already disambiguates across emails, so collisions inside it always
  // mean the same logical attachment.
  return join(saveDir, filename);
}
async function pollEmailTask(taskId: string, apiKey: string): Promise<any> {
  const pollUrl = `${BACKEND_URL}/api/v1/emails/tasks/${taskId}`;

  for (let attempt = 0; attempt < 10; attempt++) {
    let res: Response;
    try {
      res = await fetch(pollUrl, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      if (isTimeoutError(err)) {
        throw new Error("Checking task status timed out.");
      }
      throw err;
    }

    if (res.status === 401) {
      DesktopAuthManager.clearApiKey();
      throw new Error(
        "Authentication expired. Please call `login_to_adeu_cloud` to re-authenticate.",
      );
    }
    if (!res.ok) {
      throw new Error(formatBackendError(res.status, await res.text()));
    }

    const taskData: any = await res.json();
    const status = taskData.status;

    if (status === "COMPLETED") {
      return taskData;
    }

    if (status === "FAILED") {
      const errorMsg = taskData.error || "Unknown internal error";
      // Async failures carry the same recovery hints as sync HTTP errors —
      // otherwise "Email not found." reaches the agent with no guidance and
      // it improvises with fresh (often redundant) searches.
      const hint = lookupErrorHint(errorMsg);
      throw new Error(`Validation task failed on the server: ${hint ?? errorMsg}`);
    }

    // Wait 5 seconds before next poll
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  return null;
}

export async function search_and_fetch_emails(args: any): Promise<ToolResult> {
  const apiKey = await getCloudAuthToken();
  const maxAttachmentSizeMb: number =
    typeof args.max_attachment_size_mb === "number" &&
    args.max_attachment_size_mb > 0
      ? args.max_attachment_size_mb
      : 10;

  // The mailbox this call actually targets. May be upgraded below from the
  // short-ID cache: provider IDs are mailbox-scoped, so a fetch must go to the
  // mailbox the ID was harvested from, not the user's primary.
  let effectiveMailbox: string | undefined = args.mailbox_address;

  let data: any;

  if (args.task_id) {
    // ==========================================
    // PHASE 2: POLL (Wait for completion)
    // ==========================================
    const completedData = await pollEmailTask(args.task_id, apiKey);

    if (!completedData) {
      const msg = `Task ${args.task_id} is still processing. Please call \`search_and_fetch_emails\` again with task_id=${args.task_id}.`;
      return {
        content: [{ type: "text", text: msg }],
        structuredContent: {
          status: "pending",
          task_id: args.task_id,
          message: msg,
        },
      };
    }

    data = completedData;

  } else {
    // ==========================================
    // PHASE 1: INIT / SEARCH (Search/Fetch standard)
    // ==========================================
    let realEmailId: string | undefined;
    try {
      realEmailId = args.email_id ? resolveEmailId(args.email_id) : undefined;
    } catch (err) {
      if (err instanceof StaleShortIdError) {
        return {
          isError: true,
          content: [{ type: "text", text: err.message }],
        };
      }
      throw err;
    }

    if (args.email_id && !effectiveMailbox) {
      const cachedMailbox = resolveCachedMailbox(args.email_id);
      if (cachedMailbox) effectiveMailbox = cachedMailbox;
    }

    const payload = {
      email_id: realEmailId,
      sender: args.sender,
      subject: args.subject,
      has_attachments: args.has_attachments,
      attachment_name: args.attachment_name,
      is_unread: args.is_unread,
      days_ago: args.days_ago,
      folder: args.folder,
      limit: args.limit ?? 10,
      offset: args.offset ?? 0,
      mailbox_address: effectiveMailbox,
    };

    // Remove undefined fields
    Object.keys(payload).forEach(
      (k) => (payload as any)[k] === undefined && delete (payload as any)[k],
    );

    let res: Response;
    try {
      res = await fetch(`${BACKEND_URL}/api/v1/emails/search`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(45_000),
      });
    } catch (err) {
      if (isTimeoutError(err)) {
        throw new Error(
          "Email search timed out after 45s. The mail provider (Outlook/Gmail) may be slow. Try narrowing the search with more filters (sender, subject, days_ago), or retry shortly.",
        );
      }
      throw err;
    }

    if (res.status === 401) {
      DesktopAuthManager.clearApiKey();
      throw new Error(
        "Authentication expired. Please call `login_to_adeu_cloud` to re-authenticate.",
      );
    }
    if (!res.ok)
      throw new Error(formatBackendError(res.status, await res.text()));

    data = await res.json();

    if (res.status === 202 || (data && (data.status === "pending" || data.task_id) && data.type === undefined)) {
      const newTaskId = data.task_id;
      const completedData = await pollEmailTask(String(newTaskId), apiKey);

      if (!completedData) {
        const msg = `Task ${newTaskId} is still processing. Please call \`search_and_fetch_emails\` again immediately with task_id=${newTaskId} to monitor the progress.`;
        return {
          content: [{ type: "text", text: msg }],
          structuredContent: {
            status: "pending",
            task_id: String(newTaskId),
            message: msg,
          },
        };
      }
      data = completedData;
    }
  }

  const cache = loadIdCache();

  if (data.type === "previews") {
    const previews = data.previews || [];
    if (!previews.length)
      return {
        content: [
          {
            type: "text",
            text: "No emails found matching your search criteria.",
          },
        ],
        // Keep the UI channel populated (Python parity) — without it the
        // widget's tool-result handler bails and the skeleton spins forever.
        structuredContent: data,
      };

    const lines = [
      `Found ${previews.length} email(s). Here are the previews:`,
      "",
    ];
    for (const p of previews) {
      const shortId = minifyEmailId(p.id, cache, effectiveMailbox);
      const attFlag = p.has_attachments ? "📎 (Has Attachments)" : "";
      const unreadFlag = p.is_read === false ? "🟢 [UNREAD]" : "";
      lines.push(
        `- **ID**: \`${shortId}\`\n  **Subject**: ${p.subject} ${attFlag} ${unreadFlag}\n  **From**: ${p.sender_name} <${p.sender_email}>\n  **Date**: ${p.received_datetime}\n  **Preview**: ${p.preview_text}\n`,
      );
    }

    saveIdCache(cache);

    const limit: number = typeof args.limit === "number" ? args.limit : 10;
    const offset: number = typeof args.offset === "number" ? args.offset : 0;
    const pageHint =
      previews.length >= limit
        ? `\n*(If you need to see more results, call this tool again with offset=${offset + limit})*`
        : "";

    lines.push(
      "⚠️ **ACTION REQUIRED**: To read the full body of an email and download its attachments, call this tool again and provide the exact `email_id`." +
        pageHint,
    );
    return {
      content: [{ type: "text", text: lines.join("\n") }],
      structuredContent: data,
    };
  }

  if (data.type === "full_email") {
    const full = data.full_email || {};
    const shortTargetId = minifyEmailId(
      full.id || "unknown_id",
      cache,
      effectiveMailbox,
    );

    saveIdCache(cache);

    // Detect auto-escalation: the caller asked for previews (no email_id) but
    // the backend found exactly one match and returned a full email instead.
    // Flag it so the agent doesn't get blindsided by a wall of body text when
    // it asked for a list.
    const autoEscalated =
      !args.email_id &&
      (args.sender !== undefined ||
        args.subject !== undefined ||
        args.has_attachments !== undefined ||
        args.attachment_name !== undefined ||
        args.is_unread !== undefined ||
        args.days_ago !== undefined ||
        args.folder !== undefined);

    // Honor the requested working_directory by creating it (recursively) when
    // missing. Silently falling back to the system temp dir made agents in
    // sandboxed hosts believe the download failed (the reported paths pointed
    // at an inaccessible /tmp), triggering redundant re-search loops.
    let baseDir = tmpdir();
    let usedWorkingDirectory = false;
    let dirFallbackNote: string | null = null;
    if (args.working_directory) {
      try {
        mkdirSync(args.working_directory, { recursive: true });
        baseDir = args.working_directory;
        usedWorkingDirectory = true;
      } catch (e) {
        dirFallbackNote =
          `⚠️ **Attachment location notice**: the requested \`working_directory\` ` +
          `(\`${args.working_directory}\`) did not exist and could not be created ` +
          `(${(e as Error).message}). Any attachments were saved to the system temp ` +
          `directory instead — use the exact paths listed below; do NOT re-run the ` +
          `search expecting a different location.`;
      }
    }
    const saveDir = join(
      baseDir,
      usedWorkingDirectory ? "adeu_attachments" : "adeu_downloads",
      shortTargetId,
    );
    mkdirSync(saveDir, { recursive: true });

    interface SkippedAttachment {
      filename: string;
      size_bytes: number | null;
      reason: string;
    }

    async function processAttachments(
      msg: any,
    ): Promise<{ localFiles: string[]; skipped: SkippedAttachment[] }> {
      const localFiles: string[] = [];
      const skipped: SkippedAttachment[] = [];
      const maxBytes = maxAttachmentSizeMb * 1024 * 1024;

      for (const att of msg.attachments || []) {
        const filename = att.filename || "unnamed_file";
        const size: number | null =
          typeof att.size_bytes === "number" ? att.size_bytes : null;

        // Size cap: skip download but record it so the agent knows the file exists
        if (size != null && size > maxBytes) {
          skipped.push({
            filename,
            size_bytes: size,
            reason: `exceeds ${maxAttachmentSizeMb} MB cap`,
          });
          delete att.base64_data; // Drop payload from structured response too
          continue;
        }

        if (att.base64_data) {
          try {
            const filepath = getUniqueFilepath(saveDir, filename);
            writeFileSync(filepath, Buffer.from(att.base64_data, "base64"));
            localFiles.push(filepath);
            att.local_path = filepath; // For UI rendering (matches Python parity)
            delete att.base64_data; // Free memory
          } catch (e) {
            console.error(`Failed to save attachment ${filename}`, e);
            skipped.push({
              filename,
              size_bytes: size,
              reason: `download failed: ${(e as Error).message}`,
            });
          }
        }
      }
      return { localFiles, skipped };
    }

    const { localFiles: targetFiles, skipped: targetSkipped } =
      await processAttachments(full);
    const lines: string[] = [];
    if (autoEscalated) {
      lines.push(
        "_(Search returned exactly one result; auto-fetched full email below.)_\n",
      );
    }
    if (dirFallbackNote) {
      lines.push(dirFallbackNote + "\n");
    }
    lines.push(
      `# Email Thread: ${full.subject}`,
      "",
      "## Target Message (Newest):",
      `**From**: ${full.sender_name} <${full.sender_email}>`,
      `**Date**: ${full.received_datetime}`,
    );

    if (targetFiles.length) {
      lines.push("**Attachments Saved Locally**:");
      targetFiles.forEach((f) => lines.push(`- 📎 \`${f}\``));
    }

    if (targetSkipped.length) {
      lines.push(
        `**Attachments Skipped (not downloaded)** — pass \`max_attachment_size_mb\` to raise the ${maxAttachmentSizeMb} MB cap:`,
      );
      targetSkipped.forEach((s) =>
        lines.push(
          `- ⚠️ \`${s.filename}\` (${formatBytes(s.size_bytes)}, ${s.reason})`,
        ),
      );
    }

    const cleanBody = removeNestedQuotes(stripTags(full.body_html || ""));
    lines.push(`**Body**:\n\`\`\`\n${cleanBody}\n\`\`\`\n`);

    if (full.is_thread && full.messages?.length) {
      lines.push("## Previous Messages in Thread (Historical Context):");
      for (let i = 0; i < full.messages.length; i++) {
        const histMsg = full.messages[i];
        const { localFiles: histFiles, skipped: histSkipped } =
          await processAttachments(histMsg);
        lines.push(
          `### Message -${i + 1} (Older)\n**From**: ${histMsg.sender_name} <${histMsg.sender_email}>\n**Date**: ${histMsg.received_datetime}`,
        );
        if (histFiles.length) {
          lines.push("**Attachments Saved Locally**:");
          histFiles.forEach((f) => lines.push(`- 📎 \`${f}\``));
        }
        if (histSkipped.length) {
          lines.push(
            `**Attachments Skipped (not downloaded)** — pass \`max_attachment_size_mb\` — raise the cap:`,
          );
          histSkipped.forEach((s) =>
            lines.push(
              `- ⚠️ \`${s.filename}\` (${formatBytes(s.size_bytes)}, ${s.reason})`,
            ),
          );
        }
        lines.push(
          `**Body**:\n\`\`\`\n${removeNestedQuotes(stripTags(histMsg.body_html || ""))}\n\`\`\`\n`,
        );
      }
    }

    // --- Finding #9 downstream tool suggestions parity ---
    const hasAttachments =
      targetFiles.length > 0 ||
      (full.messages &&
        full.messages.some(
          (m: any) => m.attachments && m.attachments.length > 0,
        ));

    if (hasAttachments) {
      lines.push(
        "\n*You can now use tools like `read_docx`, `diff_docx_files`, or `finalize_document` on the local file paths listed under each message. " +
          "These paths are on the user's machine — pass them directly to those tools; your own sandbox/shell may not see them, and that does NOT mean the download failed.*",
      );
    }

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      structuredContent: data,
    };
  }

  return {
    isError: true,
    content: [{ type: "text", text: "Unknown response format from backend." }],
    structuredContent: data,
  };
}

export async function create_email_draft(args: any): Promise<ToolResult> {
  const apiKey = await getCloudAuthToken();
  if (!args.reply_to_email_id && (!args.subject || !args.to_recipients)) {
    throw new Error(
      "You must provide either 'reply_to_email_id' OR both 'subject' and 'to_recipients'.",
    );
  }

  const formData = new FormData();
  formData.append("body_markdown", args.body_markdown);

  if (args.reply_to_email_id) {
    try {
      formData.append(
        "reply_to_email_id",
        resolveEmailId(args.reply_to_email_id),
      );
    } catch (err) {
      if (err instanceof StaleShortIdError) {
        return {
          isError: true,
          content: [{ type: "text", text: err.message }],
        };
      }
      throw err;
    }
  }
  if (args.subject) formData.append("subject", args.subject);

  // Replies inherit the mailbox the original email's short ID was harvested
  // from unless the caller overrides — same mailbox-scoping rule as fetches.
  let draftMailbox: string | undefined = args.mailbox_address;
  if (args.reply_to_email_id && !draftMailbox) {
    const cachedMailbox = resolveCachedMailbox(args.reply_to_email_id);
    if (cachedMailbox) draftMailbox = cachedMailbox;
  }
  if (draftMailbox) {
    formData.append("mailbox_address", draftMailbox);
  }

  if (args.to_recipients) {
    const recips =
      typeof args.to_recipients === "string"
        ? JSON.parse(args.to_recipients)
        : args.to_recipients;
    formData.append("to_recipients", JSON.stringify(recips));
  }

  if (args.attachment_paths) {
    const paths =
      typeof args.attachment_paths === "string"
        ? JSON.parse(args.attachment_paths)
        : args.attachment_paths;
    for (const p of paths) {
      const buf = readFileSync(p);
      const filename = p.split(/[/\\]/).pop();
      formData.append("files", new Blob([buf]), filename);
    }
  }

  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}/api/v1/emails/drafts/new`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      body: formData as any,
      signal: AbortSignal.timeout(90_000),
    });
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new Error(
        "Draft creation timed out after 90s. If the draft includes large attachments, try splitting them across multiple drafts or omitting the largest files.",
      );
    }
    throw err;
  }

  if (res.status === 401) {
    DesktopAuthManager.clearApiKey();
    throw new Error(
      "Authentication expired. Please call `login_to_adeu_cloud`.",
    );
  }
  if (!res.ok)
    throw new Error(formatBackendError(res.status, await res.text()));

  const data: any = await res.json();
  return {
    content: [
      {
        type: "text",
        text: `Successfully created email draft! Draft ID: ${data.id}`,
      },
    ],
  };
}
export async function list_available_mailboxes(): Promise<ToolResult> {
  const apiKey = await getCloudAuthToken();

  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}/api/v1/users/me/shared-mailboxes`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new Error(
        "Listing mailboxes timed out after 15s. The Adeu backend may be temporarily unavailable; retry shortly.",
      );
    }
    throw err;
  }

  if (res.status === 401) {
    DesktopAuthManager.clearApiKey();
    throw new Error(
      "Authentication expired. Please call `login_to_adeu_cloud` to re-authenticate.",
    );
  }
  if (!res.ok) {
    throw new Error(formatBackendError(res.status, await res.text()));
  }

  // FILE: node/packages/mcp-server/src/tools/email.ts

  const mailboxes: any[] = await res.json();
  if (!mailboxes.length) {
    return {
      content: [
        {
          type: "text",
          text: "No configured mailboxes found for your profile.",
        },
      ],
    };
  }

  // Sort alphabetically by email for deterministic ordering across clients.
  mailboxes.sort((a, b) =>
    (a.email_address ?? "")
      .toLowerCase()
      .localeCompare((b.email_address ?? "").toLowerCase()),
  );

  const lines = [
    "### Connected Mailboxes",
    "Below is the list of connected mailboxes you have access to. Use the `email_address` as the `mailbox_address` parameter in other tools to query or draft from a specific mailbox:",
    "",
  ];

  for (const box of mailboxes) {
    lines.push(
      `- **${box.display_name || "Personal Mailbox"}**\n  - **Email Address**: \`${box.email_address}\`\n  - **Auto-Processing**: ${box.auto_process_enabled ? "Enabled" : "Disabled"}\n  - **Write-Back Mode**: \`${box.write_back_preference}\``,
    );
  }

  return {
    content: [{ type: "text", text: lines.join("\n") }],
  };
}
