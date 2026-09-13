import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { SimilarPanel } from "./ReviewView";
import type { TrackRow } from "../lib/types";

export default function DiscoveryView() {
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listTracks().then(setTracks).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <div className="view discovery-view" style={{ padding: 24, color: "#f9fafb" }}>
      <div className="view-heading" style={{ marginBottom: 20 }}>
        <h2>Discover</h2>
        <p>Find related tracks without interrupting your Pipeline.</p>
      </div>
      {loading ? <p style={{ color: "#4b5563", fontSize: 14 }}>Loading…</p> : tracks.length === 0 ? <p style={{ color: "#4b5563", fontSize: 14 }}>Add tracks to the Pipeline before exploring related music.</p> : <SimilarPanel tracks={tracks} />}
    </div>
  );
}
