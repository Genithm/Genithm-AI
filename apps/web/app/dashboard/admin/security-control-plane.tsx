import { SecurityOperationsCard } from "./security-operations-card";
import { SecurityDetectionCard } from "./security-detection-card";
import { SecurityEventTimeline } from "./security-event-timeline";

export function SecurityControlPlane({
  summary,
  detections,
  events,
}: {
  summary: {
    last_24_hours?: Record<string, number>;
    critical_events?: number;
    detection_signals?: number;
  } | null;
  detections: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
}) {
  return (
    <>
      <SecurityOperationsCard summary={summary} />
      <SecurityDetectionCard detections={detections} />
      <SecurityEventTimeline events={events} />
    </>
  );
}
