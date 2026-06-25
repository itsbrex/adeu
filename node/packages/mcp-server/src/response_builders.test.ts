// FILE: packages/mcp-server/src/response_builders.test.ts
import { describe, it, expect } from "vitest";
import { build_search_response } from "./response-builders.js";

describe("build_search_response — pagination clamp (BUG-FIX)", () => {
  // Construct a body small enough that 12 matches fit in a single pagination
  // page of the body itself, but produce 2 result pages (10 matches per result
  // page). This isolates the result-pagination logic from body pagination.
  function makeBodyWithMatches(count: number): string {
    const lines: string[] = ["# Section One"];
    for (let i = 0; i < count; i++) {
      lines.push(`Paragraph ${i} mentions the TARGET_PHRASE here.`);
    }
    return lines.join("\n\n");
  }

  it("does NOT throw when requested page exceeds total result pages — clamps to page 1 with warning", () => {
    // 12 matches → 2 result pages (10 + 2). Ask for page 5.
    const body = makeBodyWithMatches(12);

    let res: any;
    expect(() => {
      res = build_search_response(
        body,
        "TARGET_PHRASE",
        false,
        true,
        5,
        "dummy.docx",
      );
    }).not.toThrow();

    const text = res.content[0].text;

    // Warning must mention the requested page, the actual page count, and explain
    // the search-pagination semantics so the LLM can re-orient.
    expect(text).toContain(
      "Requested page 5 exceeds available result pages (2)",
    );
    expect(text).toContain("paginates the SEARCH RESULTS");
    expect(text).toContain("Showing page 1 of 2");

    // The header line still appears.
    expect(text).toContain("Search Results");
    expect(text).toContain("Found 12 matches");

    // We clamped to page 1, so matches 1-10 are shown.
    expect(text).toContain("Showing page 1 of 2 (matches 1-10)");

    // Page 1 has a next-page hint pointing at page 2.
    expect(text).toContain("page=2");
  });

  it("normal in-range page request still works correctly", () => {
    const body = makeBodyWithMatches(12);
    const res = build_search_response(
      body,
      "TARGET_PHRASE",
      false,
      true,
      1,
      "dummy.docx",
    );
    const text = res.content[0].text;

    // No clamp warning.
    expect(text).not.toContain("exceeds available result pages");
    expect(text).toContain("Showing page 1 of 2 (matches 1-10)");
    expect(text).toContain("page=2");
  });

  it("last in-range page no longer suggests a non-existent next page", () => {
    // 12 matches → 2 result pages. Request page 2 (the last one).
    const body = makeBodyWithMatches(12);
    const res = build_search_response(
      body,
      "TARGET_PHRASE",
      false,
      true,
      2,
      "dummy.docx",
    );
    const text = res.content[0].text;

    expect(text).toContain("Showing page 2 of 2 (matches 11-12)");
    expect(text).toContain("This is the last page of search results.");
    // Critical: must NOT suggest a non-existent page=3.
    expect(text).not.toContain("page=3");
  });

  it("invalid page values (NaN, <1) still throw — only out-of-range clamps", () => {
    const body = makeBodyWithMatches(12);
    expect(() =>
      build_search_response(
        body,
        "TARGET_PHRASE",
        false,
        true,
        0,
        "dummy.docx",
      ),
    ).toThrow(/out of range/);
    expect(() =>
      build_search_response(
        body,
        "TARGET_PHRASE",
        false,
        true,
        "garbage",
        "dummy.docx",
      ),
    ).toThrow(/out of range/);
  });

  it("page='all' is unaffected", () => {
    const body = makeBodyWithMatches(12);
    const res = build_search_response(
      body,
      "TARGET_PHRASE",
      false,
      true,
      "all",
      "dummy.docx",
    );
    const text = res.content[0].text;
    expect(text).toContain("Found 12 matches");
    expect(text).not.toContain("exceeds available result pages");
    // 'all' mode shouldn't have a Showing page X of Y line.
    expect(text).not.toMatch(/Showing page \d+ of \d+/);
  });

  it("single result page with an out-of-range request still clamps gracefully", () => {
    // Matches exactly the bug report's scenario: 1 result page, LLM asks for page 3.
    const body = makeBodyWithMatches(3); // 3 matches → 1 result page
    const res = build_search_response(
      body,
      "TARGET_PHRASE",
      false,
      true,
      3,
      "dummy.docx",
    );
    const text = res.content[0].text;

    expect(text).toContain(
      "Requested page 3 exceeds available result pages (1)",
    );
    expect(text).toContain("Showing page 1 of 1");
    expect(text).toContain("Found 3 matches");
    // Single result page → no pagination hint at all (total_pages === 1).
    expect(text).not.toMatch(/page=\d+/);
  });
});
