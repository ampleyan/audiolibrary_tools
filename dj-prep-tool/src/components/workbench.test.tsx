import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TrackRow as Track } from "../lib/types";
import ActivityDrawer from "./ActivityDrawer";
import { getWorkflowMeta } from "../lib/workflow";
import TrackInspector from "./TrackInspector";
import TrackRow, { BlockerIndicator } from "./TrackRow";
import TrackStatusBadge from "./TrackStatusBadge";
import { filterAndSortTracks, filterPreparationTracks, prioritizeActionableTracks } from "../views/PrepareView";

const track: Track = {
  id: 17,
  artist: "Night Drive",
  title: "Signal",
  mix_version: "Warehouse Mix",
  source_url: "https://example.com/signal",
  import_tag: "Friday set",
  state: "matched",
  candidate_json: JSON.stringify([
    {
      candidate: {
        username: "selector",
        filename: "Night Drive/Signal.flac",
        bitRate: 1411,
        sampleRate: 44100,
        length: 364,
        extension: "flac",
        size: 42_000_000,
      },
      score: 97,
    },
  ]),
  selected_username: "selector",
  selected_filename: "Night Drive/Signal.flac",
  downloaded_path: "/prep/Signal.flac",
  quality_result: "ok",
  quality_notes: "Lossless spectral range",
  archive_path: "/music/Night Drive/Signal.flac",
  dj_path: "/rekordbox/Night Drive - Signal.flac",
  search_job_id: "search-17",
  download_job_id: null,
  error: "Confirm the correct mix before approval.",
  created_at: "2026-09-14T18:00:00Z",
  updated_at: "2026-09-15T20:30:00Z",
};

describe("TrackStatusBadge", () => {
  it("renders an icon, readable label, and semantic state", () => {
    const html = renderToStaticMarkup(<TrackStatusBadge metadata={getWorkflowMeta(track)} />);

    expect(html).toContain("Candidates found");
    expect(html).toContain('data-semantic-state="attention"');
    expect(html).toContain('aria-hidden="true"');
  });
});

describe("TrackRow", () => {
  it("renders stable queue fields and a track-specific delete action", () => {
    const html = renderToStaticMarkup(
      <TrackRow
        track={track}
        metadata={getWorkflowMeta(track)}
        selected
        checked
        onCheckedChange={() => {}}
        onOpen={() => {}}
        onPrimaryAction={() => {}}
        onMenuAction={() => {}}
      />,
    );

    expect(html).toContain("Night Drive");
    expect(html).toContain("Warehouse Mix");
    expect(html).toContain("Confirm the correct mix before approval.");
    expect(html).toContain("Approve a candidate");
    expect(html).toContain('aria-label="Delete Night Drive – Signal"');
    expect(html).toContain('aria-selected="true"');
  });

  it("uses compact accessible blocker icons", () => {
    const html = renderToStaticMarkup(<BlockerIndicator track={{ ...track, error: "Duplicate import" }} />);
    expect(html).toContain("Duplicate track");
    expect(html).toContain("aria-label");
  });

  it("renders download progress in the queue row", () => {
    const html = renderToStaticMarkup(
      <TrackRow
        track={{ ...track, state: "downloading", error: null }}
        metadata={getWorkflowMeta({ ...track, state: "downloading", error: null })}
        selected={false}
        downloadProgress={{ bytesOnDisk: 5_000_000, bytesTotal: 10_000_000, speed: 2_000_000 }}
        onOpen={() => {}}
        onPrimaryAction={() => {}}
        onMenuAction={() => {}}
      />,
    );

    expect(html).toContain('aria-label="Download progress for Night Drive – Signal"');
    expect(html).toContain('aria-valuetext="50% downloaded"');
    expect(html).toContain('value="50"');
    expect(html).toContain("50%");
    expect(html).toContain("4.8 MB / 9.5 MB");
  });

  it("clamps visible progress to the valid percentage range", () => {
    const html = renderToStaticMarkup(
      <TrackRow
        track={{ ...track, state: "downloading", error: null }}
        metadata={getWorkflowMeta({ ...track, state: "downloading", error: null })}
        selected={false}
        downloadProgress={{ bytesOnDisk: 12_000_000, bytesTotal: 10_000_000, speed: null }}
        onOpen={() => {}}
        onPrimaryAction={() => {}}
        onMenuAction={() => {}}
      />,
    );

    expect(html).toContain('value="100"');
    expect(html).toContain("100%");
  });

  it("shows a waiting state when the downloader has not reported byte counts", () => {
    const html = renderToStaticMarkup(
      <TrackRow
        track={{ ...track, state: "downloading", error: null }}
        metadata={getWorkflowMeta({ ...track, state: "downloading", error: null })}
        selected={false}
        onOpen={() => {}}
        onPrimaryAction={() => {}}
        onMenuAction={() => {}}
      />,
    );

    expect(html).toContain("Waiting for download data");
  });
});

describe("ActivityDrawer", () => {
  it("keeps the log interactive without blocking the workbench", () => {
    const html = renderToStaticMarkup(<ActivityDrawer entries={[]} open onClose={() => {}} />);

    expect(html).toContain('role="dialog"');
    expect(html).not.toContain('aria-modal="true"');
    expect(html).toContain("activity-drawer-layer");
  });
});

describe("TrackInspector", () => {
  it("renders only the available track detail sections", () => {
    const html = renderToStaticMarkup(
      <TrackInspector
        track={track}
        pathMapFrom="/rekordbox"
        pathMapTo="/Volumes/DJ"
        onClose={() => {}}
        onPrimaryAction={() => {}}
        onMenuAction={() => {}}
      />,
    );

    expect(html).toContain("Candidates");
    expect(html).toContain("Selected file");
    expect(html).toContain("Quality result");
    expect(html).toContain("Metadata");
    expect(html).toContain("Rekordbox path");
    expect(html).toContain("/Volumes/DJ/Night Drive - Signal.flac");
    expect(html).toContain("Recent activity");
    expect(html).toContain("Playlists");
  });

  it("renders a useful empty state when no track is selected", () => {
    const html = renderToStaticMarkup(
      <TrackInspector
        track={null}
        onClose={() => {}}
        onPrimaryAction={() => {}}
        onMenuAction={() => {}}
      />,
    );

    expect(html).toContain("Select a track to inspect its next action and available details.");
  });

  it("renders the unified pipeline checklist and Rekordbox handoff actions", () => {
    const html = renderToStaticMarkup(
      <TrackInspector
        track={{ ...track, state: "ready_for_rekordbox", error: null }}
        pathMapFrom="/rekordbox"
        pathMapTo="/Volumes/DJ"
        onClose={() => {}}
        onPrimaryAction={() => {}}
        onMenuAction={() => {}}
      />,
    );

    expect(html).toContain("Preparation checklist");
    expect(html).toContain("Download");
    expect(html).toContain("Convert");
    expect(html).toContain("Quality");
    expect(html).toContain("Tag");
    expect(html).toContain("Rekordbox");
    expect(html).toContain("Copy to Rekordbox");
    expect(html).toContain("Reveal in Finder/Explorer");
    expect(html).toContain("A Rekordbox destination is already recorded");
  });

  it("explains how to remediate a failed quality check", () => {
    const html = renderToStaticMarkup(
      <TrackInspector
        track={{ ...track, state: "quality_failed", quality_result: "fake_flac", quality_notes: "Spectral cutoff at 16 kHz", error: null, dj_path: null }}
        onClose={() => {}}
        onPrimaryAction={() => {}}
        onMenuAction={() => {}}
      />,
    );

    expect(html).toContain("Quality remediation");
    expect(html).toContain("Choose another candidate");
    expect(html).toContain("Retry quality check");
  });

  it("keeps precise search available for a selected track at every stage", () => {
    const html = renderToStaticMarkup(
      <TrackInspector
        track={{ ...track, state: "dj_ready", candidate_json: null, error: null }}
        onClose={() => {}}
        onPrimaryAction={() => {}}
        onMenuAction={() => {}}
      />,
    );

    expect(html).toContain(">Search</button>");
    expect(html).toContain("Edit query");
  });
});

describe("Prepare queue derivation", () => {
  const withState = (id: number, state: Track["state"], overrides: Partial<Track> = {}): Track => ({
    ...track,
    id,
    state,
    search_job_id: null,
    error: null,
    created_at: `2026-09-${String(id).padStart(2, "0")}T10:00:00Z`,
    ...overrides,
  });

  it("defaults to needs-attention tracks and hides completed tracks", () => {
    const tracks = [
      withState(1, "requested"),
      withState(2, "matched"),
      withState(3, "downloading"),
      withState(4, "dj_ready"),
    ];

    expect(filterPreparationTracks(tracks, "needs_attention", "all").map((item) => item.id)).toEqual([1, 2]);
    expect(filterPreparationTracks(tracks, "done", "all").map((item) => item.id)).toEqual([4]);
    expect(filterPreparationTracks(tracks, "all", "all").map((item) => item.id)).toEqual([1, 2, 3, 4]);
  });

  it("prioritizes blocked actionable work before normal stage work", () => {
    const tracks = [
      withState(5, "approved"),
      withState(4, "matched"),
      withState(3, "requested", { search_job_id: "empty-search" }),
      withState(2, "dj_ready"),
      withState(1, "downloading"),
    ];

    expect(prioritizeActionableTracks(tracks).map((item) => item.id)).toEqual([3, 4, 1, 5]);
  });

  it("filters by track details and sorts the result by the requested column", () => {
    const tracks = [
      withState(1, "requested", { artist: "Zulu", title: "Alpha" }),
      withState(2, "matched", { artist: "Alpha", title: "Zulu" }),
      withState(3, "dj_ready", { artist: "Alpha", title: "Beta" }),
    ];

    expect(filterAndSortTracks(tracks, "alpha", "all", "title", "asc").map((item) => item.id)).toEqual([1, 3, 2]);
    expect(filterAndSortTracks(tracks, "", "requested", "artist", "desc").map((item) => item.id)).toEqual([1]);
  });
});
