# FILE: smoke_step4_correctness.py
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from unittest.mock import AsyncMock
from adeu.mcp_components.tools.document import _read_docx_disk


async def main(path):
    ctx = AsyncMock()
    ctx.info = AsyncMock()
    ctx.debug = AsyncMock()
    ctx.error = AsyncMock()
    ctx.warning = AsyncMock()

    # Run outline at default depth, then verbose, then deep
    for kwargs in [
        {"outline_max_level": 2, "outline_verbose": False},
        {"outline_max_level": 2, "outline_verbose": True},
        {"outline_max_level": 6, "outline_verbose": False},
    ]:
        res = await _read_docx_disk(
            path, ctx, clean_view=True, mode="outline", **kwargs
        )
        text = res.content[0].text
        print(f"\n=== outline {kwargs} ===")
        print(f"len: {len(text):,} chars")
        # Print first 5 heading lines so we can eyeball correctness
        lines = [ln for ln in text.split("\n") if ln.startswith("#")]
        print("First 5 heading lines:")
        for line in lines[:5]:
            print(f"  {line}")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
