// FILE: node/packages/mcp-server/src/tools/auth.ts
import { DesktopAuthManager } from "../desktop-auth.js";
import { BACKEND_URL } from "../shared.js";
import { ToolResult } from "../response-builders.js";

export async function login_to_adeu_cloud(): Promise<ToolResult> {
  try {
    const apiKey = await DesktopAuthManager.ensureAuthenticated();

    const res = await fetch(`${BACKEND_URL}/api/v1/auth/me`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (res.status === 401) {
      DesktopAuthManager.clearApiKey();
      throw new Error(
        "Your previous session expired. The stale key has been cleared. Please call `login_to_adeu_cloud` ONE MORE TIME to log in fresh.",
      );
    }
    if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);

    const data: any = await res.json();
    const email = data.email || "Unknown Email";
    return {
      content: [
        {
          type: "text",
          text:
            `Login successful. You are now authenticated to Adeu Cloud as the user ` +
            `who owns the provider account \`${email}\` (the account used for SSO).\n\n` +
            `This single login grants access to ALL of this user's linked provider ` +
            `accounts and ALL of their mailboxes for the duration of this session — ` +
            `not just \`${email}\`. Call \`list_available_mailboxes\` to see every mailbox ` +
            `that can be queried or drafted from.`,
        },
      ],
    };
  } catch (err: any) {
    return { isError: true, content: [{ type: "text", text: err.message }] };
  }
}

export async function logout_of_adeu_cloud(): Promise<ToolResult> {
  DesktopAuthManager.clearApiKey();
  return {
    content: [
      {
        type: "text",
        text: "Successfully logged out. The local API key has been removed.",
      },
    ],
  };
}
