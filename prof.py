# FILE: profile_step5.py
import cProfile
import pstats
import sys
from pathlib import Path

# Add src to python path
sys.path.insert(0, str(Path(__file__).parent / "src"))

from docx import Document
from adeu.ingest import _extract_text_from_doc
from adeu.redline.comments import CommentsManager


def main(path):
    print(f"Loading {path}...")
    doc = Document(path)

    # Pre-warm the comments manager so we strictly profile the text projection
    print("Pre-warming comments map...")
    CommentsManager(doc).extract_comments_data()

    print("Starting profile of projection hot loop...")
    profiler = cProfile.Profile()
    profiler.enable()

    # Run the core extraction (simulating a mode='outline' or mode='full' pass)
    _extract_text_from_doc(
        doc, clean_view=False, include_appendix=False, return_paragraph_offsets=True
    )

    profiler.disable()

    print("\n" + "=" * 50)
    print("TOP 25 BY CUMULATIVE TIME (Total time spent in function + children)")
    print("=" * 50)
    stats = pstats.Stats(profiler).sort_stats("cumtime")
    stats.print_stats(25)

    print("\n" + "=" * 50)
    print("TOP 25 BY TOTAL TIME (Time spent ONLY in this function)")
    print("=" * 50)
    stats = pstats.Stats(profiler).sort_stats("tottime")
    stats.print_stats(25)


if __name__ == "__main__":
    main(sys.argv[1])
