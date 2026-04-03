export type AnalysisMetricKey =
  | "tas"
  | "synchrony"
  | "compactness"
  | "recovery_latency"
  | "transition_reaction";

export type AggregateMetricCard = {
  key: AnalysisMetricKey;
  label: string;
  value: number | null;
  unit: string;
  confidence: number;
  evidenceTimestamp: number | null;
  description: string;
};

export type AggregateInsightCard = {
  id: string;
  title: string;
  claim: string;
  timestampSeconds: number;
  confidence: number;
  metricKeys: AnalysisMetricKey[];
};

export type AggregateDiagnostics = {
  binSizeSeconds: number;
  minTimestampSeconds: number | null;
  maxTimestampSeconds: number | null;
  trackingEventCount: number;
  timelineWindowCount: number;
  hasSubSecondPrecision: boolean;
};

export type AggregateTimelineWindow = {
  startSeconds: number;
  endSeconds: number;
  eventCount: number;
  avgTas: number;
  centroidX: number;
  centroidY: number;
  xSpread: number;
  ySpread: number;
};

export type StoredTimelineWindow = {
  start_seconds: number;
  end_seconds: number;
  event_count: number;
  tas_sum: number;
  x_sum: number;
  y_sum: number;
  x_min: number;
  x_max: number;
  y_min: number;
  y_max: number;
};

export type TrackingEventPoint = {
  timestamp_seconds: number;
  tas_score: number;
  x_coord: number;
  y_coord: number;
};

export type AnalysisAggregateComputation = {
  windows: StoredTimelineWindow[];
  metrics: AggregateMetricCard[];
  insights: AggregateInsightCard[];
  diagnostics: AggregateDiagnostics;
  hasStrongEvidence: boolean;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function formatSeconds(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function toSafeNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildStoredTimelineWindows(
  events: TrackingEventPoint[],
  binSizeSeconds: number
): StoredTimelineWindow[] {
  const safeBin = Math.max(0.1, binSizeSeconds);
  const grouped = new Map<number, StoredTimelineWindow>();

  for (const point of events) {
    const timestamp = toSafeNumber(point.timestamp_seconds);
    if (timestamp < 0) continue;

    const startSeconds = Math.floor(timestamp / safeBin) * safeBin;
    const startKey = Number(startSeconds.toFixed(3));
    const existing = grouped.get(startKey);

    const tas = toSafeNumber(point.tas_score);
    const x = toSafeNumber(point.x_coord);
    const y = toSafeNumber(point.y_coord);

    if (!existing) {
      grouped.set(startKey, {
        start_seconds: startKey,
        end_seconds: Number((startKey + safeBin).toFixed(3)),
        event_count: 1,
        tas_sum: tas,
        x_sum: x,
        y_sum: y,
        x_min: x,
        x_max: x,
        y_min: y,
        y_max: y,
      });
      continue;
    }

    existing.event_count += 1;
    existing.tas_sum += tas;
    existing.x_sum += x;
    existing.y_sum += y;
    existing.x_min = Math.min(existing.x_min, x);
    existing.x_max = Math.max(existing.x_max, x);
    existing.y_min = Math.min(existing.y_min, y);
    existing.y_max = Math.max(existing.y_max, y);
  }

  return Array.from(grouped.values()).sort((a, b) => a.start_seconds - b.start_seconds);
}

export function rebucketStoredTimelineWindows(
  windows: StoredTimelineWindow[],
  targetBinSeconds: number
): StoredTimelineWindow[] {
  if (windows.length === 0) return [];

  const safeBin = Math.max(0.1, targetBinSeconds);
  const grouped = new Map<number, StoredTimelineWindow>();

  for (const window of windows) {
    const startSeconds = Math.floor(window.start_seconds / safeBin) * safeBin;
    const startKey = Number(startSeconds.toFixed(3));
    const existing = grouped.get(startKey);

    if (!existing) {
      grouped.set(startKey, {
        start_seconds: startKey,
        end_seconds: Number((startKey + safeBin).toFixed(3)),
        event_count: window.event_count,
        tas_sum: window.tas_sum,
        x_sum: window.x_sum,
        y_sum: window.y_sum,
        x_min: window.x_min,
        x_max: window.x_max,
        y_min: window.y_min,
        y_max: window.y_max,
      });
      continue;
    }

    existing.event_count += window.event_count;
    existing.tas_sum += window.tas_sum;
    existing.x_sum += window.x_sum;
    existing.y_sum += window.y_sum;
    existing.x_min = Math.min(existing.x_min, window.x_min);
    existing.x_max = Math.max(existing.x_max, window.x_max);
    existing.y_min = Math.min(existing.y_min, window.y_min);
    existing.y_max = Math.max(existing.y_max, window.y_max);
  }

  return Array.from(grouped.values()).sort((a, b) => a.start_seconds - b.start_seconds);
}

function computeDiagnostics(
  windows: StoredTimelineWindow[],
  trackingEventCount: number,
  binSizeSeconds: number,
  hasSubSecondPrecision: boolean
): AggregateDiagnostics {
  const minTimestampSeconds = windows.length > 0 ? windows[0].start_seconds : null;
  const maxTimestampSeconds = windows.length > 0 ? windows[windows.length - 1].end_seconds : null;

  return {
    binSizeSeconds,
    minTimestampSeconds,
    maxTimestampSeconds,
    trackingEventCount,
    timelineWindowCount: windows.length,
    hasSubSecondPrecision,
  };
}

function computeMetricsAndInsights(
  windows: StoredTimelineWindow[],
  diagnostics: AggregateDiagnostics
): { metrics: AggregateMetricCard[]; insights: AggregateInsightCard[]; hasStrongEvidence: boolean } {
  if (windows.length === 0 || diagnostics.trackingEventCount === 0) {
    return {
      metrics: [
        {
          key: "tas",
          label: "TAS v1",
          value: null,
          unit: "pts",
          confidence: 0,
          evidenceTimestamp: null,
          description: "Composite confidence score from tracked events.",
        },
        {
          key: "synchrony",
          label: "Synchrony",
          value: null,
          unit: "%",
          confidence: 0,
          evidenceTimestamp: null,
          description: "How consistently collective spacing shifts over time.",
        },
        {
          key: "compactness",
          label: "Compactness",
          value: null,
          unit: "%",
          confidence: 0,
          evidenceTimestamp: null,
          description: "Shape tightness proxy from occupied area over windows.",
        },
        {
          key: "recovery_latency",
          label: "Recovery Latency",
          value: null,
          unit: "s",
          confidence: 0,
          evidenceTimestamp: null,
          description: "Seconds needed to recover after the largest TAS dip.",
        },
        {
          key: "transition_reaction",
          label: "Transition Reaction",
          value: null,
          unit: "s",
          confidence: 0,
          evidenceTimestamp: null,
          description: "Seconds to settle after abrupt formation movement.",
        },
      ],
      insights: [],
      hasStrongEvidence: false,
    };
  }

  const globalXMin = Math.min(...windows.map((window) => window.x_min));
  const globalXMax = Math.max(...windows.map((window) => window.x_max));
  const globalYMin = Math.min(...windows.map((window) => window.y_min));
  const globalYMax = Math.max(...windows.map((window) => window.y_max));

  const totalXRange = Math.max(1, globalXMax - globalXMin);
  const totalYRange = Math.max(1, globalYMax - globalYMin);

  const timeline = windows.map((window) => {
    const avgTas = window.event_count > 0 ? window.tas_sum / window.event_count : 0;
    const centroidX = window.event_count > 0 ? window.x_sum / window.event_count : 0;
    const centroidY = window.event_count > 0 ? window.y_sum / window.event_count : 0;
    const xSpread = clamp((window.x_max - window.x_min) / totalXRange, 0, 1);
    const ySpread = clamp((window.y_max - window.y_min) / totalYRange, 0, 1);
    const areaSpread = clamp(xSpread * ySpread, 0, 1);

    return {
      second: window.start_seconds,
      avgTas,
      centroidX,
      centroidY,
      xSpread,
      ySpread,
      areaSpread,
    };
  });

  const tasSeries = timeline.map((point) => ({ second: point.second, value: point.avgTas }));
  const maxTasPoint = tasSeries.reduce((best, point) => (point.value > best.value ? point : best), tasSeries[0]);
  const minTasPoint = tasSeries.reduce((best, point) => (point.value < best.value ? point : best), tasSeries[0]);

  let runningMax = tasSeries[0].value;
  let largestDrawdown = 0;
  let drawdownTroughSecond = tasSeries[0].second;

  for (const point of tasSeries) {
    if (point.value > runningMax) {
      runningMax = point.value;
    }
    const drawdown = runningMax - point.value;
    if (drawdown > largestDrawdown) {
      largestDrawdown = drawdown;
      drawdownTroughSecond = point.second;
    }
  }

  const recoveryTarget = runningMax - largestDrawdown * 0.2;
  const recoveryPoint = tasSeries.find(
    (point) => point.second > drawdownTroughSecond && point.value >= recoveryTarget
  );
  const recoveryLatency = recoveryPoint ? recoveryPoint.second - drawdownTroughSecond : null;

  const centroidShift: Array<{ second: number; shift: number }> = [];
  for (let index = 1; index < timeline.length; index += 1) {
    const prev = timeline[index - 1];
    const current = timeline[index];
    centroidShift.push({
      second: current.second,
      shift: Math.hypot(current.centroidX - prev.centroidX, current.centroidY - prev.centroidY),
    });
  }

  const sortedShifts = centroidShift.map((item) => item.shift).sort((a, b) => a - b);
  const highShiftThreshold = sortedShifts.length > 0 ? sortedShifts[Math.floor(sortedShifts.length * 0.75)] : 0;
  const lowShiftThreshold = sortedShifts.length > 0 ? sortedShifts[Math.floor(sortedShifts.length * 0.35)] : 0;

  const transitionDelays: number[] = [];
  for (let i = 0; i < centroidShift.length; i += 1) {
    if (centroidShift[i].shift < highShiftThreshold || highShiftThreshold <= 0) continue;
    const triggerSecond = centroidShift[i].second;
    for (let j = i + 1; j < centroidShift.length; j += 1) {
      if (centroidShift[j].shift <= lowShiftThreshold) {
        transitionDelays.push(centroidShift[j].second - triggerSecond);
        break;
      }
    }
  }

  const transitionReaction = transitionDelays.length > 0 ? average(transitionDelays) : null;

  const tasValue = average(timeline.map((point) => point.avgTas));
  const synchronyValue = 100 * (1 - average(timeline.map((point) => (point.xSpread + point.ySpread) / 2)));
  const compactnessValue = 100 * (1 - average(timeline.map((point) => point.areaSpread)));

  // Use logarithmic scaling to avoid confidence pinning at 100% for large samples.
  const sampleConfidence = clamp(Math.log10(diagnostics.trackingEventCount + 1) / 5, 0, 1);
  const windowConfidence = clamp(Math.log10(diagnostics.timelineWindowCount + 1) / 3, 0, 1);
  const precisionConfidence = diagnostics.hasSubSecondPrecision ? 1 : 0.7;
  const confidenceBase = clamp(
    sampleConfidence * 0.45 + windowConfidence * 0.35 + precisionConfidence * 0.2,
    0.2,
    0.96
  );

  const metrics: AggregateMetricCard[] = [
    {
      key: "tas",
      label: "TAS v1",
      value: Number(tasValue.toFixed(1)),
      unit: "pts",
      confidence: confidenceBase,
      evidenceTimestamp: maxTasPoint.second,
      description: "Composite confidence score from tracked events.",
    },
    {
      key: "synchrony",
      label: "Synchrony",
      value: Number(clamp(synchronyValue, 0, 100).toFixed(1)),
      unit: "%",
      confidence: confidenceBase,
      evidenceTimestamp: maxTasPoint.second,
      description: "How consistently collective spacing shifts over time.",
    },
    {
      key: "compactness",
      label: "Compactness",
      value: Number(clamp(compactnessValue, 0, 100).toFixed(1)),
      unit: "%",
      confidence: confidenceBase,
      evidenceTimestamp: minTasPoint.second,
      description: "Shape tightness proxy from occupied area over windows.",
    },
    {
      key: "recovery_latency",
      label: "Recovery Latency",
      value: recoveryLatency === null ? null : Number(recoveryLatency.toFixed(1)),
      unit: "s",
      confidence: recoveryLatency === null ? confidenceBase * 0.5 : confidenceBase,
      evidenceTimestamp: drawdownTroughSecond,
      description: "Seconds needed to recover after the largest TAS dip.",
    },
    {
      key: "transition_reaction",
      label: "Transition Reaction",
      value: transitionReaction === null ? null : Number(transitionReaction.toFixed(1)),
      unit: "s",
      confidence: transitionReaction === null ? confidenceBase * 0.5 : confidenceBase,
      evidenceTimestamp: centroidShift[0]?.second ?? null,
      description: "Seconds to settle after abrupt formation movement.",
    },
  ];

  const strictEvidenceThreshold = 0.55;
  const insights: AggregateInsightCard[] = [];

  if (confidenceBase >= strictEvidenceThreshold) {
    insights.push({
      id: `peak-${maxTasPoint.second}`,
      title: "Cohesion peak detected",
      claim: `TAS peaked at ${maxTasPoint.value.toFixed(1)} around ${formatSeconds(maxTasPoint.second)}, indicating the strongest collective stability window in this run.`,
      timestampSeconds: maxTasPoint.second,
      confidence: confidenceBase,
      metricKeys: ["tas", "synchrony"],
    });

    insights.push({
      id: `dip-${minTasPoint.second}`,
      title: "Stability dip flagged",
      claim: `TAS dipped to ${minTasPoint.value.toFixed(1)} around ${formatSeconds(minTasPoint.second)}, where shape spread widened versus the match average.`,
      timestampSeconds: minTasPoint.second,
      confidence: confidenceBase,
      metricKeys: ["tas", "compactness"],
    });
  }

  if (recoveryLatency !== null && confidenceBase >= strictEvidenceThreshold) {
    insights.push({
      id: `recovery-${drawdownTroughSecond}`,
      title: "Recovery latency measured",
      claim: `It took ${Number(recoveryLatency.toFixed(1))}s to recover from the largest TAS drawdown after ${formatSeconds(drawdownTroughSecond)}.`,
      timestampSeconds: drawdownTroughSecond,
      confidence: confidenceBase,
      metricKeys: ["recovery_latency", "tas"],
    });
  }

  if (transitionReaction !== null && confidenceBase >= strictEvidenceThreshold) {
    const triggerSecond = centroidShift.find((item) => item.shift >= highShiftThreshold)?.second;
    if (triggerSecond !== undefined) {
      insights.push({
        id: `transition-${triggerSecond}`,
        title: "Transition reaction measured",
        claim: `After abrupt movement shifts, average stabilization time was ${transitionReaction.toFixed(1)}s, anchored by a trigger near ${formatSeconds(triggerSecond)}.`,
        timestampSeconds: triggerSecond,
        confidence: confidenceBase,
        metricKeys: ["transition_reaction", "synchrony"],
      });
    }
  }

  return {
    metrics,
    insights,
    hasStrongEvidence: insights.length > 0,
  };
}

export function computeAggregateFromTrackingEvents(
  events: TrackingEventPoint[],
  baseBinSeconds = 1
): AnalysisAggregateComputation {
  const hasSubSecondPrecision = events.some(
    (event) => Math.abs(toSafeNumber(event.timestamp_seconds) - Math.round(toSafeNumber(event.timestamp_seconds))) > 0.0001
  );

  const windows = buildStoredTimelineWindows(events, baseBinSeconds);
  const diagnostics = computeDiagnostics(windows, events.length, baseBinSeconds, hasSubSecondPrecision);
  const summary = computeMetricsAndInsights(windows, diagnostics);

  return {
    windows,
    metrics: summary.metrics,
    insights: summary.insights,
    diagnostics,
    hasStrongEvidence: summary.hasStrongEvidence,
  };
}

export function toTimelineWindowView(windows: StoredTimelineWindow[]): AggregateTimelineWindow[] {
  if (windows.length === 0) return [];

  const globalXMin = Math.min(...windows.map((window) => window.x_min));
  const globalXMax = Math.max(...windows.map((window) => window.x_max));
  const globalYMin = Math.min(...windows.map((window) => window.y_min));
  const globalYMax = Math.max(...windows.map((window) => window.y_max));

  const totalXRange = Math.max(1, globalXMax - globalXMin);
  const totalYRange = Math.max(1, globalYMax - globalYMin);

  return windows.map((window) => ({
    startSeconds: window.start_seconds,
    endSeconds: window.end_seconds,
    eventCount: window.event_count,
    avgTas: window.event_count > 0 ? Number((window.tas_sum / window.event_count).toFixed(2)) : 0,
    centroidX: window.event_count > 0 ? Number((window.x_sum / window.event_count).toFixed(2)) : 0,
    centroidY: window.event_count > 0 ? Number((window.y_sum / window.event_count).toFixed(2)) : 0,
    xSpread: Number((((window.x_max - window.x_min) / totalXRange) * 100).toFixed(2)),
    ySpread: Number((((window.y_max - window.y_min) / totalYRange) * 100).toFixed(2)),
  }));
}

export function parseStoredTimelineWindows(input: unknown): StoredTimelineWindow[] {
  if (!Array.isArray(input)) return [];

  return input
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const candidate = item as Record<string, unknown>;
      return {
        start_seconds: toSafeNumber(candidate.start_seconds),
        end_seconds: toSafeNumber(candidate.end_seconds),
        event_count: Math.max(0, Math.floor(toSafeNumber(candidate.event_count))),
        tas_sum: toSafeNumber(candidate.tas_sum),
        x_sum: toSafeNumber(candidate.x_sum),
        y_sum: toSafeNumber(candidate.y_sum),
        x_min: toSafeNumber(candidate.x_min),
        x_max: toSafeNumber(candidate.x_max),
        y_min: toSafeNumber(candidate.y_min),
        y_max: toSafeNumber(candidate.y_max),
      };
    })
    .filter((item): item is StoredTimelineWindow => item !== null)
    .sort((a, b) => a.start_seconds - b.start_seconds);
}
