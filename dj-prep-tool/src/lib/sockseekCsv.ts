import type { TrackRow } from "./types";

type ExportTrack = Pick<TrackRow, "artist" | "title" | "mix_version">;

export function buildSockseekCsv(tracks: readonly ExportTrack[]) {
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const rows = tracks.map((track) => {
    const mix = track.mix_version?.trim();
    let title = track.title;
    if (mix) {
      const normalized = title.trimEnd().toLowerCase();
      const alreadyIncluded = [`(${mix})`, `[${mix}]`].some((suffix) => normalized.endsWith(suffix.toLowerCase()));
      if (!alreadyIncluded) title = `${title} (${mix})`;
    }
    return [track.artist, title].map(quote).join(",");
  });
  return ["artist,title", ...rows].join("\r\n") + "\r\n";
}

export function downloadSockseekCsv(tracks: readonly ExportTrack[], name = "tracklist") {
  if (!tracks.length) return;
  const blob = new Blob(["\uFEFF", buildSockseekCsv(tracks)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 120) || "tracklist"}-sockseek.csv`;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
