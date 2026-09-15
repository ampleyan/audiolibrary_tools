import { describe, expect, it } from "vitest";
import { buildImportPreview } from "./ImportPreview";

describe("buildImportPreview", () => {
  it("normalizes duplicate artist-title pairs and records malformed lines as warnings", () => {
    const preview = buildImportPreview("  Blawan – Why They Hide Their Bodies Under My Garage\nBlawan - Why They Hide Their Bodies Under My Garage\nUnsplit title");

    expect(preview.counts).toEqual({ new: 1, duplicate: 1, skipped: 1, warning: 1 });
    expect(preview.rows[0]).toMatchObject({ artist: "Blawan", title: "Why They Hide Their Bodies Under My Garage", duplicate: false });
    expect(preview.rows[1]).toMatchObject({ duplicate: true });
    expect(preview.rows[2]).toMatchObject({ warning: "Add an artist and title separated by a dash." });
  });

  it("preserves an editable mix label separately from the title", () => {
    const preview = buildImportPreview("Surgeon - Magneze (Original Mix)");

    expect(preview.rows[0]).toMatchObject({ artist: "Surgeon", title: "Magneze", mixVersion: "Original Mix" });
  });
});
