import type { ChangeEvent } from "react";
import type { ImportPreviewModel, ImportPreviewRow } from "../lib/types";

export function normalizeImportKey(artist: string, title: string) {
  return `${artist} ${title}`.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function buildImportPreview(text: string): ImportPreviewModel {
  const seen = new Set<string>();
  const rows = text.split(/\r?\n/).map((raw, index): ImportPreviewRow | null => {
    const value = raw.trim().replace(/^\s*(?:\d+[.)]|[-•])\s*/, "");
    if (!value || value.startsWith("#")) return null;
    const match = value.match(/^(.+?)\s*[-–—]\s*(.+)$/);
    if (!match) return { id: `${index}`, artist: "", title: value, mixVersion: "", duplicate: false, skipped: false, warning: "Add an artist and title separated by a dash." };
    const [, artist, rawTitle] = match;
    const mixMatch = rawTitle.match(/\s*\(([^()]+(?:mix|edit|version|remix)[^()]*)\)\s*$/i);
    const title = rawTitle.replace(/\s*\(([^()]+(?:mix|edit|version|remix)[^()]*)\)\s*$/i, "").trim();
    const key = normalizeImportKey(artist, title);
    const duplicate = Boolean(key && seen.has(key));
    if (key) seen.add(key);
    return { id: `${index}`, artist: artist.trim(), title, mixVersion: mixMatch?.[1]?.trim() ?? "", duplicate, skipped: duplicate, warning: title ? null : "Add a track title." };
  }).filter((row): row is ImportPreviewRow => row !== null);

  return {
    rows,
    counts: {
      new: rows.filter((row) => !row.duplicate && !row.skipped && !row.warning).length,
      duplicate: rows.filter((row) => row.duplicate).length,
      skipped: rows.filter((row) => row.skipped).length,
      warning: rows.filter((row) => Boolean(row.warning) && !row.skipped).length,
    },
  };
}

function updateRow(rows: ImportPreviewRow[], id: string, field: "artist" | "title" | "mixVersion", event: ChangeEvent<HTMLInputElement>) {
  return rows.map((row) => row.id === id ? { ...row, [field]: event.target.value } : row);
}

export default function ImportPreview({ model, onChange }: { model: ImportPreviewModel; onChange: (rows: ImportPreviewRow[]) => void }) {
  const { counts, rows } = model;
  return <section className="import-preview" aria-label="Import preview">
    <div className="import-preview-summary" aria-live="polite">
      <strong>Preview before import</strong>
      <span>{counts.new} new</span><span>{counts.duplicate} duplicate</span><span>{counts.skipped} skipped</span><span>{counts.warning} warning{counts.warning === 1 ? "" : "s"}</span>
    </div>
    <p>Review entries before adding them. Duplicate entries are skipped by default; edit a row to keep both versions.</p>
    <div className="import-preview-rows">
      {rows.map((row) => <div className={`import-preview-row${row.duplicate ? " is-duplicate" : ""}${row.warning ? " has-warning" : ""}`} key={row.id}>
        <input type="checkbox" checked={!row.skipped} onChange={() => onChange(rows.map((item) => item.id === row.id ? { ...item, skipped: !item.skipped } : item))} aria-label={`Include ${row.artist || "unknown artist"} ${row.title}`} />
        <input value={row.artist} onChange={(event) => onChange(updateRow(rows, row.id, "artist", event))} placeholder="Artist" aria-label={`Artist for ${row.title}`} />
        <input value={row.title} onChange={(event) => onChange(updateRow(rows, row.id, "title", event))} placeholder="Title" aria-label={`Title for ${row.artist || "track"}`} />
        <input value={row.mixVersion} onChange={(event) => onChange(updateRow(rows, row.id, "mixVersion", event))} placeholder="Mix (optional)" aria-label={`Mix for ${row.title}`} />
        <span>{row.skipped ? "Skipped" : row.warning ?? (row.duplicate ? "Duplicate" : "New")}</span>
      </div>)}
    </div>
  </section>;
}
