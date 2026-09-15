import { AlertTriangle, Check, CircleDot, LoaderCircle } from "lucide-react";
import type { WorkflowMetadata } from "../lib/types";

type SemanticState = "neutral" | "attention" | "running" | "success";

const PRESENTATION = {
  inbox: { semantic: "neutral", Icon: CircleDot },
  needs_attention: { semantic: "attention", Icon: AlertTriangle },
  running: { semantic: "running", Icon: LoaderCircle },
  ready_to_dj: { semantic: "success", Icon: Check },
} satisfies Record<WorkflowMetadata["bucket"], { semantic: SemanticState; Icon: typeof CircleDot }>;

export default function TrackStatusBadge({ metadata }: { metadata: WorkflowMetadata }) {
  const { semantic, Icon } = PRESENTATION[metadata.bucket];

  return (
    <span className="track-status-badge" data-semantic-state={semantic}>
      <Icon aria-hidden="true" size={12} strokeWidth={2.25} />
      <span>{metadata.statusLabel}</span>
    </span>
  );
}
