import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TrackRow } from "../lib/types";
import { TrackList } from "./ImportView";

const track: TrackRow = {
  id: 12,
  artist: "Test Artist",
  title: "Test Title",
  mix_version: null,
  source_url: null,
  import_tag: null,
  state: "requested",
  candidate_json: null,
  selected_username: null,
  selected_filename: null,
  downloaded_path: null,
  quality_result: null,
  quality_notes: null,
  archive_path: null,
  dj_path: null,
  search_job_id: null,
  download_job_id: null,
  error: null,
  created_at: "2026-09-16T10:00:00Z",
  updated_at: "2026-09-16T10:00:00Z",
};

describe("Inbox track list", () => {
  it("offers an explicit selection control before handing tracks to Prepare", () => {
    const html = renderToStaticMarkup(<TrackList tracks={[track]} onDelete={() => {}} onGoReview={() => {}} onPrepareSelected={() => {}} />);

    expect(html).toContain('aria-label="Select Test Artist – Test Title"');
    expect(html).toContain("Prepare selected tracks");
  });
});
