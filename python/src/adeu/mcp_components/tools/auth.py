import json
import urllib.error
import urllib.request
from typing import Annotated

from fastmcp import Context
from fastmcp.exceptions import ToolError
from fastmcp.tools import tool

from adeu.mcp_components.desktop_auth import DesktopAuthManager
from adeu.mcp_components.shared import BACKEND_URL


@tool(
    description=(
        "Logs the user into Adeu Cloud. Opens a browser window for SSO authentication.\n\n"
        "IMPORTANT — login is user-level, not account-level:\n"
        "- An Adeu user can have multiple linked provider accounts (Microsoft, Google) and "
        "multiple mailboxes (personal + shared/delegated). One linked account is marked primary.\n"
        "- Signing in through ANY of the user's linked accounts authenticates the same Adeu user. "
        "Once logged in, the session can read from and draft in ALL of that user's linked accounts "
        "and ALL of their mailboxes — not just the one used to sign in.\n"
        "- The choice of which provider account to sign in through is purely an SSO mechanism; it "
        "does not select a 'current account' for the session.\n\n"
        "When the user asks which accounts or mailboxes are available, call `list_available_mailboxes` "
        "rather than naming a single account from the login response."
    ),
    tags={"cloud"},
    annotations={"openWorldHint": True},
)
async def login_to_adeu_cloud(
    reasoning: Annotated[
        str,
        "Why do I need to log in to Adeu Cloud? State this reason before any other parameter.",
    ],
    ctx: Context,
) -> str:
    del reasoning
    await ctx.info("Initiating cloud authentication workflow")
    try:
        await ctx.debug("Checking DesktopAuthManager for API key")
        api_key = DesktopAuthManager.ensure_authenticated()
        if not api_key:
            await ctx.error("Failed to obtain API key from login flow")
            raise ToolError("Error: Could not obtain API key from the login flow.")

        url = f"{BACKEND_URL}/api/v1/auth/me"
        req = urllib.request.Request(
            url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Accept": "application/json",
            },
        )

        try:
            await ctx.debug("Verifying token with backend", extra={"url": url})
            with urllib.request.urlopen(req) as response:
                data = json.loads(response.read().decode("utf-8"))
                email = data.get("email", "Unknown Email")

                await ctx.info(
                    "Login successful",
                    extra={"email": email},
                )
                return (
                    f"Login successful. You are now authenticated to Adeu Cloud as the user "
                    f"who owns the provider account `{email}` (the account used for SSO).\n\n"
                    f"This single login grants access to ALL of this user's linked provider "
                    f"accounts and ALL of their mailboxes for the duration of this session — "
                    f"not just `{email}`. Call `list_available_mailboxes` to see every mailbox "
                    f"that can be queried or drafted from."
                )

        except urllib.error.HTTPError as e:
            if e.code == 401:
                await ctx.warning("Session expired or invalid token. Clearing API key.")
                DesktopAuthManager.clear_api_key()
                raise ToolError(
                    "Your previous session expired. The stale key has been cleared. "
                    "Please call the `login_to_adeu_cloud` tool ONE MORE TIME to log in fresh."
                ) from e
            await ctx.error(
                "HTTP Error verifying login",
                extra={"status_code": e.code, "reason": e.reason},
            )
            raise ToolError(f"HTTP Error verifying login: {e.code} - {e.reason}") from e

    except Exception as e:
        await ctx.error("Exception during login process", extra={"error": str(e)})
        raise ToolError(f"Error during login process: {str(e)}") from e


@tool(
    description="Logs out of the Adeu Cloud backend by clearing the local API key from the OS Keychain.",
    tags={"cloud"},
    annotations={"openWorldHint": True},
)
async def logout_of_adeu_cloud(
    reasoning: Annotated[
        str,
        "Why do I need to log out of Adeu Cloud? State this reason before any other parameter.",
    ],
    ctx: Context,
) -> str:
    del reasoning  # reason-first UX; not used by the tool.
    await ctx.info("Initiating cloud session logout")
    try:
        DesktopAuthManager.clear_api_key()
        await ctx.debug("API key cleared from OS Keychain successfully")
        return "Successfully logged out. The local API key has been removed from the Keychain."
    except Exception as e:
        await ctx.error("Failed to clear API key during logout", extra={"error": str(e)})
        raise ToolError(f"Error during logout: {str(e)}") from e
