import type { RankedCandidate } from "./types";

export type MatchQuality = {
  label: string;
  color: string;
  detail: string;
};

export function matchQuality(candidates: RankedCandidate[]): MatchQuality | null {
  if (candidates.length === 0) return null;
  const ranked = [...candidates].sort((a, b) => b.score - a.score);
  const top = ranked[0].score;
  const gap = top - (ranked[1]?.score ?? 0);
  if (top >= 130 && gap >= 15) {
    return { label: "Strong signal", color: "#4ade80", detail: "Top candidate is clearly ahead" };
  }
  if (top >= 90 && gap >= 10) {
    return { label: "Good signal", color: "#60a5fa", detail: "Top candidate looks promising" };
  }
  return { label: "Review closely", color: "#fbbf24", detail: "Candidates are weak or closely matched" };
}
