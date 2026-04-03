"use client";

import AuthGuard from "@/lib/AuthGuard";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import TopNavBar from "../../lib/TopNavBar";
import SideNavBar from "../../lib/SideNavBar";


type TacticalEvent = {
  id: string;
  match_id: string;
  timestamp_seconds: number;
  player_actor: string;
  x_coord: number;
  y_coord: number;
  insight_text: string;
  tas_score: number;
  event_type: string;
};

type SeasonalTrend = {
  match_date: string;
  avg_tas: number;
  avg_syniq: number;
};

type TeamInfo = {
  id: string;
  name: string;
};

type MatchRow = {
  id: string;
  title?: string;
  date?: string;
  created_at?: string;
  match_date?: string;
  league?: string;
  video_url: string;
  home_team_id: string;
  away_team_id: string;
  tas?: number;
  synIq?: number;
  analysis_status?: "queued" | "processing" | "completed" | "failed" | "stopped" | null;
  analysis_error?: string | null;
};

type MetricCard = {
  key: "tas" | "synchrony" | "compactness" | "recovery_latency" | "transition_reaction";
  label: string;
  value: number | null;
  unit: string;
  confidence: number;
  evidenceTimestamp: number | null;
  description: string;
};

type InsightCard = {
  id: string;
  title: string;
  claim: string;
  timestampSeconds: number;
  confidence: number;
  metricKeys: MetricCard["key"][];
};

type AggregateResponse = {
  match_id: string;
  bin_seconds: number;
  source_event_count: number;
  source_min_timestamp: number | null;
  source_max_timestamp: number | null;
  metrics: MetricCard[];
  insights: InsightCard[];
  timeline_windows: Array<{
    startSeconds: number;
    endSeconds: number;
    eventCount: number;
    avgTas: number;
    centroidX: number;
    centroidY: number;
    xSpread: number;
    ySpread: number;
  }>;
  generated_at: string;
};

type AnalysisDerived = {
  metrics: MetricCard[];
  insights: InsightCard[];
  hasStrongEvidence: boolean;
  diagnostics: {
    binSizeSeconds: number;
    minTimestampSeconds: number | null;
    maxTimestampSeconds: number | null;
    trackingEventCount: number;
    timelineWindowCount: number;
    hasSubSecondPrecision: boolean;
  };
};

type CoachingFlashpoint = {
  id: string;
  title: string;
  summary: string;
  timestampSeconds: number;
  confidence: number;
  source: "insight" | "event";
  metricKeys: string[];
  category:
    | "Marking Deviation"
    | "Postural Slump"
    | "Transition Delay"
    | "Cohesion Surge"
    | "Defensive Dislocation"
    | "Recovery Response"
    | "Goal Threat"
    | "Tactical Signal";
};

function formatEventTypeLabel(eventType: string): string {
  return eventType
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function detectFlashpointCategory(title: string, summary: string, metricKeys: string[]): CoachingFlashpoint["category"] {
  const searchable = `${title} ${summary} ${metricKeys.join(" ")}`.toLowerCase();

  if (/marking|deviation|off marker|tracking gap|distance/.test(searchable)) {
    return "Marking Deviation";
  }
  if (/postural|slump|fatigue|body language/.test(searchable)) {
    return "Postural Slump";
  }
  if (/transition|reaction|stabiliz|settle|counter/.test(searchable)) {
    return "Transition Delay";
  }
  if (/cohesion|sync|synchrony|compactness|shape tight|surge|peak/.test(searchable)) {
    return "Cohesion Surge";
  }
  if (/dip|dislocation|widened|stretched|broken line|exposure/.test(searchable)) {
    return "Defensive Dislocation";
  }
  if (/recovery|drawdown|recover/.test(searchable)) {
    return "Recovery Response";
  }
  if (/goal|shot|xg|chance|finish/.test(searchable)) {
    return "Goal Threat";
  }

  return "Tactical Signal";
}

function getCategoryAccent(category: CoachingFlashpoint["category"]): string {
  switch (category) {
    case "Marking Deviation":
      return "border-[#fbbf24]/40 bg-[#fbbf24]/10 text-[#fbbf24]";
    case "Postural Slump":
      return "border-[#f97316]/40 bg-[#f97316]/10 text-[#fdba74]";
    case "Transition Delay":
      return "border-[#38bdf8]/40 bg-[#38bdf8]/10 text-[#7dd3fc]";
    case "Cohesion Surge":
      return "border-[#39ff14]/40 bg-[#39ff14]/10 text-[#86efac]";
    case "Defensive Dislocation":
      return "border-[#ef4444]/40 bg-[#ef4444]/10 text-[#fca5a5]";
    case "Recovery Response":
      return "border-[#a78bfa]/40 bg-[#a78bfa]/10 text-[#c4b5fd]";
    case "Goal Threat":
      return "border-[#fb7185]/40 bg-[#fb7185]/10 text-[#fda4af]";
    default:
      return "border-white/20 bg-white/10 text-[#e7e2ff]/80";
  }
}

function buildCoachingFlashpoints(
  insights: InsightCard[],
  tacticalEvents: TacticalEvent[],
  maxFlashpoints = 4
): CoachingFlashpoint[] {
  const insightPoints: CoachingFlashpoint[] = insights.map((insight) => {
    const category = detectFlashpointCategory(insight.title, insight.claim, insight.metricKeys);
    return {
      id: `insight-${insight.id}`,
      title: category,
      summary: `${insight.title}: ${insight.claim}`,
      timestampSeconds: insight.timestampSeconds,
      confidence: insight.confidence,
      source: "insight",
      metricKeys: insight.metricKeys,
      category,
    };
  });

  const signalEventPattern =
    /\[(sync_snapshot|anomaly_flag|manual_goal_event|unit_dislocation|transition|postural|slump|marking|summary)\]/i;
  const frameLinePattern = /^Frame\s+\d+:/i;

  const signalEvents = tacticalEvents
    .filter((event) => {
      if (event.event_type !== "player_tracking") return true;
      if (signalEventPattern.test(event.insight_text)) return true;
      return !frameLinePattern.test(event.insight_text) && !/colour clustering update/i.test(event.insight_text);
    })
    .slice(0, 80)
    .map((event) => {
      const metricKeys = [event.event_type];
      const genericTitle = formatEventTypeLabel(event.event_type);
      const category = detectFlashpointCategory(genericTitle, event.insight_text, metricKeys);
      return {
        id: `event-${event.id}`,
        title: category,
        summary: event.insight_text,
        timestampSeconds: event.timestamp_seconds,
        confidence: 0.6,
        source: "event" as const,
        metricKeys,
        category,
      };
    });

  const merged = [...insightPoints, ...signalEvents].sort((a, b) => {
    if (a.source !== b.source) {
      return a.source === "insight" ? -1 : 1;
    }
    if (b.confidence !== a.confidence) {
      return b.confidence - a.confidence;
    }
    return b.timestampSeconds - a.timestampSeconds;
  });

  const selected: CoachingFlashpoint[] = [];
  const selectedCategories = new Set<CoachingFlashpoint["category"]>();
  const minimumGapSeconds = 20;

  for (const candidate of merged) {
    const isDistinct = selected.every(
      (picked) => Math.abs(picked.timestampSeconds - candidate.timestampSeconds) >= minimumGapSeconds
    );
    if (!isDistinct) continue;
    if (selectedCategories.has(candidate.category)) continue;

    selected.push(candidate);
    selectedCategories.add(candidate.category);
    if (selected.length >= maxFlashpoints) break;
  }

  return selected.sort((a, b) => a.timestampSeconds - b.timestampSeconds);
}

function getMatchTimestamp(match: MatchRow): string | null {
  return match.date ?? match.match_date ?? match.created_at ?? null;
}

function formatMatchDate(match: MatchRow): string {
  const timestamp = getMatchTimestamp(match);
  if (!timestamp) {
    return "Date unavailable";
  }

  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return "Date unavailable";
  }

  return parsed.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatMatchTitle(match: MatchRow | null): string {
  if (!match) {
    return "No match selected yet";
  }

  return match.title ?? "Match analysis";
}

function getTeamNameById(teams: TeamInfo[], teamId: string | null | undefined): string {
  if (!teamId) return "Unassigned";
  return teams.find((team) => team.id === teamId)?.name ?? teamId;
}

async function getValidAccessToken(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session?.access_token) {
    return session.access_token;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data, error } = await supabase.auth.refreshSession();
  if (error) {
    return null;
  }

  return data.session?.access_token ?? null;
}

async function fetchLatestTeamId(): Promise<string | null> {
  const { data, error } = await supabase
    .from("teams")
    .select("id")
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();

  if (error) {
    console.error("fetchLatestTeamId", error);
    return null;
  }
  return data?.id ?? null;
}

async function fetchMatchesForTeam(teamId: string): Promise<MatchRow[]> {
  const { data, error } = await supabase
    .from("matches")
    .select("*")
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`);

  if (error) {
    console.error("fetchMatchesForTeam", error);
    return [];
  }

  return (data || []).sort((left, right) => {
    const leftTime = getMatchTimestamp(left) ? new Date(getMatchTimestamp(left) as string).getTime() : 0;
    const rightTime = getMatchTimestamp(right) ? new Date(getMatchTimestamp(right) as string).getTime() : 0;
    return rightTime - leftTime;
  });
}

async function fetchTacticalEvents(matchId: string): Promise<TacticalEvent[]> {
  const { data, error } = await supabase
    .from("tactical_events")
    .select("*")
    .eq("match_id", matchId)
    .order("timestamp_seconds", { ascending: true })
    .limit(5000);

  if (error) {
    console.error("fetchTacticalEvents", error);
    return [];
  }
  return data || [];
}

async function fetchMatchAggregate(matchId: string, binSeconds = 5): Promise<AggregateResponse | null> {
  const accessToken = await getValidAccessToken();

  if (!accessToken) {
    return null;
  }

  const response = await fetch(
    `/api/analyse/aggregate?match_id=${encodeURIComponent(matchId)}&bin_seconds=${encodeURIComponent(String(binSeconds))}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as AggregateResponse;
  return payload;
}

async function fetchSeasonalTrends(teamId: string): Promise<SeasonalTrend[]> {
  const { data, error } = await supabase
    .from("seasonal_trends")
    .select("*")
    .eq("team_id", teamId)
    .order("match_date", { ascending: true });

  if (error) {
    console.error("fetchSeasonalTrends", error);
    return [];
  }
  return data || [];
}

async function fetchTeams(): Promise<TeamInfo[]> {
  const { data, error } = await supabase.from("teams").select("id, name").order("name", { ascending: true });
  if (error) {
    console.error("fetchTeams", error);
    return [];
  }
  return data ?? [];
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function fetchMatchById(matchId: string): Promise<MatchRow | null> {
  if (!isValidUuid(matchId)) {
    console.warn("fetchMatchById: invalid UUID provided", matchId);
    return null;
  }

  const { data, error } = await supabase
    .from("matches")
    .select("*")
    .eq("id", matchId)
    .maybeSingle();

  if (error) {
    console.error("fetchMatchById", JSON.stringify(error));
    return null;
  }

  if (!data) {
    console.warn("fetchMatchById: no match found for id", matchId);
    return null;
  }

  return data;
}

function SeasonalProgressChart({ data }: { data: SeasonalTrend[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="glass-panel bg-white/10 backdrop-blur-md border border-white/10 p-4 text-[#e7e2ff]/80">
        <p className="text-sm">No seasonal data available yet.</p>
      </div>
    );
  }

  const chartData = data.map((row) => ({
    date: new Date(row.match_date).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    }),
    TAS: Number(row.avg_tas),
    SynIQ: Number(row.avg_syniq),
  }));

  return (
    <div className="glass-panel bg-white/10 backdrop-blur-md border border-white/10 p-4">
      <h3 className="font-headline text-white text-lg mb-3">Performance Insights</h3>
      <div className="h-72">
        <svg className="w-full h-full text-white">
          {/** Simplified fallback chart if recharts isn't available; using basic lines to avoid import requirements */}
          <text x="10" y="20" fill="white">Chart placeholder for {chartData.length} points</text>
        </svg>
      </div>
    </div>
  );
}

function DynamicPitchVisualiser({
  players,
  eventTitle,
  matchTAS,
  onWatchVideo,
}: {
  players: TacticalEvent[];
  eventTitle: string;
  matchTAS: number;
  onWatchVideo: () => void;
}) {
  return (
    <div className="glass-panel rounded-xl bg-white/10 backdrop-blur-md border border-white/10 p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl text-white font-black uppercase">{eventTitle}</h2>
        <span className="text-xs text-[#e7e2ff] bg-[#ffffff1a] px-2 py-1 rounded">TAS {matchTAS.toFixed(1)}</span>
      </div>
      <div className="border border-white/10 rounded-lg overflow-hidden mb-4">
        <svg viewBox="0 0 100 68" className="w-full h-72">
          <rect width="100" height="68" fill="rgba(31, 41, 55, 0.32)" />
          <line x1="50" y1="0" x2="50" y2="68" stroke="rgba(255,255,255,0.2)" strokeWidth="0.3" />
          {players.map((p) => (
            <g key={p.id}>
              <circle cx={p.x_coord} cy={p.y_coord} r="2.5" fill="#ff706e" stroke="#ffffff" strokeWidth="0.2" />
              <text x={p.x_coord} y={p.y_coord - 3} fontSize="2.5" fill="#ffffff" textAnchor="middle">
                {p.player_actor.split(" ").map((name) => name[0]).join("")}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <button
        onClick={onWatchVideo}
        className="px-4 py-2 bg-[#ff706e] text-[#0e0c20] font-black text-xs tracking-widest uppercase rounded-full hover:opacity-90"
      >
        Watch Video Evidence
      </button>
    </div>
  );
}

const ANALYSIS_COMPARISON_ENABLED = process.env.NEXT_PUBLIC_ENABLE_ANALYSIS_COMPARISON === "true";

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatSeconds(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function deriveAnalysis(events: TacticalEvent[]): AnalysisDerived {
  const trackingEvents = events.filter(
    (event) => event.event_type === "player_tracking" && event.timestamp_seconds >= 0
  );

  if (trackingEvents.length === 0) {
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
      diagnostics: {
        binSizeSeconds: 0.5,
        minTimestampSeconds: null,
        maxTimestampSeconds: null,
        trackingEventCount: 0,
        timelineWindowCount: 0,
        hasSubSecondPrecision: false,
      },
    };
  }

  const minTimestampSeconds = Math.min(...trackingEvents.map((event) => event.timestamp_seconds));
  const maxTimestampSeconds = Math.max(...trackingEvents.map((event) => event.timestamp_seconds));
  const hasSubSecondPrecision = trackingEvents.some(
    (event) => Math.abs(event.timestamp_seconds - Math.round(event.timestamp_seconds)) > 0.0001
  );
  const analysisDurationSeconds = Math.max(0, maxTimestampSeconds - minTimestampSeconds);
  const binSizeSeconds = analysisDurationSeconds > 20 * 60 ? 1 : 0.5;

  const bySecond = new Map<number, TacticalEvent[]>();
  for (const event of trackingEvents) {
    const bucketSecond = Math.floor(event.timestamp_seconds / binSizeSeconds) * binSizeSeconds;
    const secondKey = Number(bucketSecond.toFixed(3));
    const bucket = bySecond.get(secondKey) ?? [];
    bucket.push(event);
    bySecond.set(secondKey, bucket);
  }

  const timeline = Array.from(bySecond.entries())
    .map(([second, secondEvents]) => {
      const tasAvg =
        secondEvents.reduce((sum, item) => sum + (Number.isFinite(item.tas_score) ? item.tas_score : 0), 0) /
        secondEvents.length;
      const xVals = secondEvents.map((item) => item.x_coord);
      const yVals = secondEvents.map((item) => item.y_coord);
      const xMin = Math.min(...xVals);
      const xMax = Math.max(...xVals);
      const yMin = Math.min(...yVals);
      const yMax = Math.max(...yVals);
      const centroidX = xVals.reduce((sum, value) => sum + value, 0) / xVals.length;
      const centroidY = yVals.reduce((sum, value) => sum + value, 0) / yVals.length;

      return {
        second,
        tasAvg,
        xMin,
        xMax,
        yMin,
        yMax,
        centroidX,
        centroidY,
        count: secondEvents.length,
      };
    })
    .sort((left, right) => left.second - right.second);

  const allX = trackingEvents.map((item) => item.x_coord);
  const allY = trackingEvents.map((item) => item.y_coord);
  const totalXRange = Math.max(1, Math.max(...allX) - Math.min(...allX));
  const totalYRange = Math.max(1, Math.max(...allY) - Math.min(...allY));

  const windowSpread = timeline.map((window) => {
    const xSpread = (window.xMax - window.xMin) / totalXRange;
    const ySpread = (window.yMax - window.yMin) / totalYRange;
    return clamp((xSpread + ySpread) / 2, 0, 1);
  });

  const areaSpread = timeline.map((window) => {
    const xSpread = (window.xMax - window.xMin) / totalXRange;
    const ySpread = (window.yMax - window.yMin) / totalYRange;
    return clamp(xSpread * ySpread, 0, 1);
  });

  const average = (values: number[]) =>
    values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

  const tasSeries = timeline.map((window) => ({ second: window.second, value: window.tasAvg }));
  const maxTasPoint = tasSeries.reduce((best, point) => (point.value > best.value ? point : best), tasSeries[0]);
  const minTasPoint = tasSeries.reduce((best, point) => (point.value < best.value ? point : best), tasSeries[0]);

  let runningMax = tasSeries[0].value;
  let drawdownPeak = tasSeries[0].second;
  let largestDrawdown = 0;
  let drawdownTroughSecond = tasSeries[0].second;

  for (const point of tasSeries) {
    if (point.value > runningMax) {
      runningMax = point.value;
      drawdownPeak = point.second;
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
  for (let i = 1; i < timeline.length; i += 1) {
    const prev = timeline[i - 1];
    const curr = timeline[i];
    const shift = Math.hypot(curr.centroidX - prev.centroidX, curr.centroidY - prev.centroidY);
    centroidShift.push({ second: curr.second, shift });
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

  const tasValue = average(tasSeries.map((point) => point.value));
  const synchronyValue = 100 * (1 - average(windowSpread));
  const compactnessValue = 100 * (1 - average(areaSpread));

  // Use logarithmic scaling to avoid confidence pinning at 100% for large samples.
  const sampleConfidence = clamp(Math.log10(trackingEvents.length + 1) / 5, 0, 1);
  const windowConfidence = clamp(Math.log10(timeline.length + 1) / 3, 0, 1);
  const precisionConfidence = hasSubSecondPrecision ? 1 : 0.7;
  const confidenceBase = clamp(
    sampleConfidence * 0.45 + windowConfidence * 0.35 + precisionConfidence * 0.2,
    0.2,
    0.96
  );

  const metrics: MetricCard[] = [
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
      value: recoveryLatency,
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
  const insights: InsightCard[] = [];

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
      claim: `It took ${recoveryLatency}s to recover from the largest TAS drawdown after ${formatSeconds(drawdownTroughSecond)}.`,
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
    diagnostics: {
      binSizeSeconds,
      minTimestampSeconds,
      maxTimestampSeconds,
      trackingEventCount: trackingEvents.length,
      timelineWindowCount: timeline.length,
      hasSubSecondPrecision,
    },
  };
}

function deriveAnalysisFromAggregate(aggregate: AggregateResponse): AnalysisDerived {
  // Aggregate windows are intentionally rebucketed and may start on whole seconds.
  // Treat precision as non-diagnostic here to avoid false warnings in normal dashboard mode.
  const hasSubSecondPrecision = true;

  return {
    metrics: aggregate.metrics,
    insights: aggregate.insights,
    hasStrongEvidence: aggregate.insights.length > 0,
    diagnostics: {
      binSizeSeconds: aggregate.bin_seconds,
      minTimestampSeconds: aggregate.source_min_timestamp,
      maxTimestampSeconds: aggregate.source_max_timestamp,
      trackingEventCount: aggregate.source_event_count,
      timelineWindowCount: aggregate.timeline_windows.length,
      hasSubSecondPrecision,
    },
  };
}

type ReplayEvent = {
  id: string;
  title: string;
  timeLabel: string;
  timestampSeconds: number;
  eventType: string;
  eventTypeLabel: string;
  sourceEventId: string;
  playerInvolved: string;
  detail: string;
  insight: string;
  zoneLabel: string;
  players: Array<{
    id: string;
    label: string;
    currentX: number;
    currentY: number;
    previousX: number;
    previousY: number;
  }>;
};

function inferPlayerFromSummary(summary: string): string {
  const tagged = summary.match(/\b([A-Za-z]+(?:_[A-Za-z0-9]+){1,3})\b/);
  if (!tagged?.[1]) {
    return "UNIT CONTEXT";
  }

  return tagged[1]
    .split("_")
    .map((part) => part.toUpperCase())
    .join(" ");
}

function normalizePitchX(x: number): number {
  if (!Number.isFinite(x)) return 50;
  if (x <= 1 && x >= 0) return clamp(x * 100, 0, 100);
  if (x >= 0 && x <= 100) return x;
  if (x > 100 && x <= 1920) return clamp((x / 1920) * 100, 0, 100);
  return clamp(x, 0, 100);
}

function normalizePitchY(y: number): number {
  if (!Number.isFinite(y)) return 34;
  if (y <= 1 && y >= 0) return clamp(y * 68, 0, 68);
  if (y >= 0 && y <= 68) return y;
  if (y > 68 && y <= 1080) return clamp((y / 1080) * 68, 0, 68);
  return clamp(y, 0, 68);
}

function getZoneFromCoordinates(x: number, y: number): string {
  if (x > 66 && y < 24) return "Right Attacking Channel";
  if (x > 66 && y > 44) return "Right Recovery Channel";
  if (x < 34 && y < 24) return "Left Attacking Channel";
  if (x < 34 && y > 44) return "Left Recovery Channel";
  if (x > 66) return "Final Third";
  if (x < 34) return "Defensive Third";
  return "Central Corridor";
}

function initialsFromActor(actor: string): string {
  const clean = actor.trim();
  if (!clean) return "UN";
  const parts = clean.split(/[_\s-]+/).filter(Boolean);
  if (parts.length === 0) return "UN";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function toCoachFriendlyPlayerLabel(player: string): string {
  return player
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getReplayEventTypeLabel(eventType: string): string {
  switch (eventType) {
    case "tracking_snapshot":
      return "Auto-detected shape moment";
    case "sync_snapshot":
      return "Shape snapshot";
    case "anomaly_flag":
      return "Structure drop";
    case "unit_dislocation":
      return "Unit out of shape";
    case "manual_goal_event":
      return "Coach-marked goal moment";
    case "summary":
      return "Key match moment";
    default:
      return formatEventTypeLabel(eventType);
  }
}

function buildCoachFriendlyReplayCopy(
  event: TacticalEvent,
  isFallbackTrackingAnchor: boolean,
  playerInvolved: string,
  zoneLabel: string
): { detail: string; insight: string; eventTypeLabel: string } {
  const playerLabel = toCoachFriendlyPlayerLabel(playerInvolved);

  if (isFallbackTrackingAnchor) {
    return {
      detail: `This moment was picked automatically because player positions are clear here and the team shape is easy to review in the ${zoneLabel.toLowerCase()}.`,
      insight: `${playerLabel} is the main reference point in this clip. Use it to assess spacing around the ball side and whether nearby support is close enough.`,
      eventTypeLabel: getReplayEventTypeLabel("tracking_snapshot"),
    };
  }

  const rawDetail = event.insight_text?.trim();
  return {
    detail:
      rawDetail && rawDetail.length > 0
        ? rawDetail
        : `Review this moment in the ${zoneLabel.toLowerCase()} to see how the unit shape changed.`,
    insight: `Focus on ${playerLabel} and the surrounding unit to judge whether the team stays compact, connected, and in balance.`,
    eventTypeLabel: getReplayEventTypeLabel(event.event_type),
  };
}

function isDedicatedReplayEvent(event: TacticalEvent): boolean {
  if (event.timestamp_seconds < 0) return false;
  if (event.event_type !== "player_tracking" && event.event_type !== "summary") {
    return true;
  }
  return /\[(sync_snapshot|anomaly_flag|manual_goal_event|unit_dislocation|transition|postural|slump|marking|goal)\]/i.test(
    event.insight_text
  );
}

function getSnapshotByTimestamp(
  trackingEvents: TacticalEvent[],
  targetTimestamp: number,
  rangeSeconds: number,
  maxPlayers = 10
): Map<string, TacticalEvent> {
  const nearestByActor = new Map<string, TacticalEvent>();

  for (const event of trackingEvents) {
    const delta = Math.abs(event.timestamp_seconds - targetTimestamp);
    if (delta > rangeSeconds) continue;
    const actor = event.player_actor?.trim();
    if (!actor) continue;

    const existing = nearestByActor.get(actor);
    if (!existing) {
      nearestByActor.set(actor, event);
      continue;
    }

    const existingDelta = Math.abs(existing.timestamp_seconds - targetTimestamp);
    if (delta < existingDelta) {
      nearestByActor.set(actor, event);
    }
  }

  return new Map(
    [...nearestByActor.entries()]
      .sort((left, right) => {
        const leftDelta = Math.abs(left[1].timestamp_seconds - targetTimestamp);
        const rightDelta = Math.abs(right[1].timestamp_seconds - targetTimestamp);
        if (leftDelta !== rightDelta) return leftDelta - rightDelta;
        return left[0].localeCompare(right[0]);
      })
      .slice(0, maxPlayers)
  );
}

function buildFallbackReplayAnchors(trackingEvents: TacticalEvent[], maxEvents = 6): TacticalEvent[] {
  if (trackingEvents.length === 0) return [];

  const sortedBySignal = [...trackingEvents].sort((left, right) => {
    if (right.tas_score !== left.tas_score) {
      return right.tas_score - left.tas_score;
    }
    return left.timestamp_seconds - right.timestamp_seconds;
  });

  const selected: TacticalEvent[] = [];
  const minimumGapSeconds = 12;

  for (const event of sortedBySignal) {
    if (event.timestamp_seconds < 0) continue;
    if (
      selected.some(
        (candidate) => Math.abs(candidate.timestamp_seconds - event.timestamp_seconds) < minimumGapSeconds
      )
    ) {
      continue;
    }

    selected.push(event);
    if (selected.length >= maxEvents) {
      break;
    }
  }

  return selected.sort((left, right) => left.timestamp_seconds - right.timestamp_seconds);
}

function buildReplayEventsFromTacticalEvents(tacticalEvents: TacticalEvent[]): ReplayEvent[] {
  if (tacticalEvents.length === 0) return [];

  const sorted = [...tacticalEvents].sort((a, b) => a.timestamp_seconds - b.timestamp_seconds);
  const trackingEvents = sorted.filter((event) => event.event_type === "player_tracking" && event.timestamp_seconds >= 0);
  const dedicatedEvents = sorted.filter(isDedicatedReplayEvent);
  const selectedDedicated = dedicatedEvents.length > 0
    ? dedicatedEvents.slice(-6)
    : buildFallbackReplayAnchors(trackingEvents);

  return selectedDedicated.map((event, index) => {
    const currentSnapshot = getSnapshotByTimestamp(trackingEvents, event.timestamp_seconds, 1.5, 10);
    const previousSnapshot = getSnapshotByTimestamp(trackingEvents, Math.max(0, event.timestamp_seconds - 2), 1.5, 10);

    const players = [...currentSnapshot.entries()].map(([actor, current]) => {
      const previous = previousSnapshot.get(actor) ?? current;
      return {
        id: actor,
        label: initialsFromActor(actor),
        currentX: normalizePitchX(current.x_coord),
        currentY: normalizePitchY(current.y_coord),
        previousX: normalizePitchX(previous.x_coord),
        previousY: normalizePitchY(previous.y_coord),
      };
    });

    const centroidX =
      players.length > 0
        ? players.reduce((sum, player) => sum + player.currentX, 0) / players.length
        : normalizePitchX(event.x_coord);
    const centroidY =
      players.length > 0
        ? players.reduce((sum, player) => sum + player.currentY, 0) / players.length
        : normalizePitchY(event.y_coord);

    const isFallbackTrackingAnchor = event.event_type === "player_tracking" && !isDedicatedReplayEvent(event);
    const title = isFallbackTrackingAnchor ? "Tracking Snapshot" : formatEventTypeLabel(event.event_type);
    const playerInvolved = event.player_actor
      ? inferPlayerFromSummary(event.player_actor)
      : inferPlayerFromSummary(event.insight_text?.trim() || title);
    const copy = buildCoachFriendlyReplayCopy(event, isFallbackTrackingAnchor, playerInvolved, getZoneFromCoordinates(centroidX, centroidY));

    return {
      id: `replay-${event.id}-${index}`,
      title,
      timeLabel: formatSeconds(event.timestamp_seconds),
      timestampSeconds: event.timestamp_seconds,
      eventType: isFallbackTrackingAnchor ? "tracking_snapshot" : event.event_type,
      eventTypeLabel: copy.eventTypeLabel,
      sourceEventId: event.id,
      playerInvolved,
      detail: copy.detail,
      insight: copy.insight,
      zoneLabel: getZoneFromCoordinates(centroidX, centroidY),
      players,
    };
  });
}

function ReplaySceneGraphic({ event }: { event: ReplayEvent }) {
  return (
    <svg key={event.id} viewBox="0 0 100 68" className="w-full h-full">
      <rect x="0" y="0" width="100" height="68" fill="#0f3a2c" />
      <rect x="1" y="1" width="98" height="66" fill="none" stroke="rgba(255,255,255,0.24)" strokeWidth="0.45" />
      <line x1="50" y1="1" x2="50" y2="67" stroke="rgba(255,255,255,0.22)" strokeWidth="0.35" />
      <circle cx="50" cy="34" r="9" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="0.35" />
      <rect x="1" y="22" width="12" height="24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="0.35" />
      <rect x="87" y="22" width="12" height="24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="0.35" />

      {event.players.map((player) => (
        <g key={player.id}>
          <line
            x1={player.previousX}
            y1={player.previousY}
            x2={player.currentX}
            y2={player.currentY}
            stroke="rgba(255,112,110,0.35)"
            strokeWidth="0.35"
            strokeDasharray="0.8 0.8"
          />
          <circle cx={player.previousX} cy={player.previousY} r="0.9" fill="rgba(255,255,255,0.25)" />
          <circle cx={player.currentX} cy={player.currentY} r="1.3" fill="#ff706e" stroke="#ffffff" strokeWidth="0.2">
            <animate attributeName="cx" from={String(player.previousX)} to={String(player.currentX)} dur="0.9s" fill="freeze" />
            <animate attributeName="cy" from={String(player.previousY)} to={String(player.currentY)} dur="0.9s" fill="freeze" />
          </circle>
          <text x={player.currentX} y={player.currentY - 1.8} fill="#ffffff" fontSize="1.3" textAnchor="middle" fontWeight="700">
            {player.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

function TacticalReplayHub({
  matchName,
  matchDate,
  events,
  onSyncToSecond,
}: {
  matchName: string;
  matchDate: string;
  events: ReplayEvent[];
  onSyncToSecond: (seconds: number) => void;
}) {
  const [activeEventIndex, setActiveEventIndex] = useState(0);

  const safeEventIndex = Math.max(0, Math.min(activeEventIndex, Math.max(0, events.length - 1)));
  const activeEvent = events[safeEventIndex] ?? events[0];

  const handleSyncWithVideo = (event: ReplayEvent) => {
    onSyncToSecond(event.timestampSeconds);
  };

  if (events.length === 0 || !activeEvent) {
    return (
      <div className="h-full flex items-center justify-center rounded-xl border border-white/10 bg-[#0e0c20]/40 p-6">
        <div className="text-center space-y-2">
          <p className="text-sm font-black text-white uppercase tracking-wide">Tactical Replay Hub</p>
          <p className="text-xs text-[#e7e2ff]/70">No dedicated replay events are logged for this match yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-[#e7e2ff]/55 font-bold">Tactical Replay Hub</p>
          <p className="text-sm text-[#e7e2ff]/80 font-semibold">Dedicated Event Feed + Timestamped Video Evidence</p>
        </div>
        <div className="px-3 py-2 bg-[#0e0c20]/70 border border-white/10 rounded-xl">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[#e7e2ff]/65 font-bold">{matchDate}</p>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#0b1b16] min-h-[280px] overflow-hidden relative">
        <ReplaySceneGraphic event={activeEvent} />
        <div className="absolute top-3 left-3 flex items-center gap-2">
          <span className="px-3 py-1 rounded-full bg-black/50 border border-white/10 text-[10px] tracking-widest font-bold">
            LIVE EVENT SNAPSHOT
          </span>
          <span className="px-3 py-1 rounded-full bg-[#ff706e]/20 text-[#ffb1af] border border-[#ff706e]/30 text-[10px] tracking-widest font-bold">
            {activeEvent.zoneLabel}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-xl border border-white/10 bg-[#0e0c20]/60 p-4">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[#38bdf8] font-bold">What Happened</p>
          <p className="mt-2 text-sm text-white font-semibold">{activeEvent.detail}</p>
          <p className="mt-2 text-xs text-[#e7e2ff]/70 uppercase tracking-widest">Key Player: {toCoachFriendlyPlayerLabel(activeEvent.playerInvolved)}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#0e0c20]/60 p-4">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[#fbbf24] font-bold">What To Look For</p>
          <p className="mt-2 text-sm text-[#e7e2ff]/90 italic">&quot;{activeEvent.insight}&quot;</p>
          <p className="mt-2 text-[10px] text-[#e7e2ff]/55 uppercase tracking-[0.16em]">
            Moment Type: {activeEvent.eventTypeLabel}
          </p>
          <button
            onClick={() => handleSyncWithVideo(activeEvent)}
            className="mt-3 px-4 py-2 rounded-lg bg-white text-[#0e0c20] hover:bg-[#ff706e] hover:text-[#0e0c20] font-black text-[10px] tracking-widest uppercase transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Sync In Player ({activeEvent.timeLabel})
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#0e0c20]/45 p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[#e7e2ff]/60 font-bold">Event Timeline</p>
          <p className="text-[10px] uppercase tracking-[0.2em] text-[#e7e2ff]/45">{matchName}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {events.map((event, index) => (
            <button
              key={event.id}
              onClick={() => setActiveEventIndex(index)}
              className={`text-left rounded-lg border px-3 py-2 transition-all ${
                activeEvent.id === event.id
                  ? "border-[#ff706e]/60 bg-[#ff706e]/12"
                  : "border-white/10 bg-white/5 hover:border-white/25"
              }`}
            >
              <p className="text-[11px] font-black uppercase tracking-wide text-white">{event.title}</p>
              <p className="text-[10px] text-[#e7e2ff]/65 mt-1">{event.timeLabel} • {toCoachFriendlyPlayerLabel(event.playerInvolved)}</p>
              <p className="text-[10px] text-[#e7e2ff]/55 mt-1 uppercase tracking-wider">{event.eventTypeLabel}</p>
              <p className="text-[10px] text-[#93c5fd] mt-2 font-bold uppercase">Sync with Video</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AnalysisDashboard() {
  const router = useRouter();
  const [teamId, setTeamId] = useState<string | null>(null);
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [tacticalEvents, setTacticalEvents] = useState<TacticalEvent[]>([]);
  const [seasonalTrends, setSeasonalTrends] = useState<SeasonalTrend[]>([]);
  const [aggregateData, setAggregateData] = useState<AggregateResponse | null>(null);
  const [selectedMatch, setSelectedMatch] = useState<MatchRow | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [isResolvingPlayback, setIsResolvingPlayback] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [pendingSeekSeconds, setPendingSeekSeconds] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  useEffect(() => {
    const initTeams = async () => {
      const teamList = await fetchTeams();
      if (teamList && teamList.length > 0) {
        setTeams(teamList);
        if (!teamId) {
          setTeamId(teamList[0].id);
        }
      }
    };
    initTeams();
  }, [teamId]);

  useEffect(() => {
    const queryParams = new URLSearchParams(window.location.search);
    const queryMatchId = queryParams.get("id");
    const queryTimestampSeconds = Number(queryParams.get("ts"));

    if (queryMatchId && isValidUuid(queryMatchId)) {
      setSelectedMatchId(queryMatchId);
    } else if (queryMatchId) {
      console.warn("analysis page ignored invalid id query param", queryMatchId);
    }

    if (Number.isFinite(queryTimestampSeconds) && queryTimestampSeconds >= 0) {
      setPendingSeekSeconds(Math.floor(queryTimestampSeconds));
    }
  }, []);

  useEffect(() => {
    const loadMatches = async () => {
      if (!teamId) return;
      setLoading(true);
      try {
        const allMatches = await fetchMatchesForTeam(teamId);
        setMatches(allMatches);

        const params = new URLSearchParams(window.location.search);
        const queryMatchId = params.get("id");
        const safeMatchId = queryMatchId && isValidUuid(queryMatchId) ? queryMatchId : null;

        if (safeMatchId && allMatches.some((match) => match.id === safeMatchId)) {
          setSelectedMatchId(safeMatchId);
        } else if (allMatches.length > 0) {
          setSelectedMatchId(allMatches[0].id);
          router.replace(`/analysis?id=${allMatches[0].id}`);
        } else {
          setSelectedMatchId(null);
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    };
    loadMatches();
  }, [teamId, router]);

  useEffect(() => {
    const loadSelectedMatch = async () => {
      if (!selectedMatchId) return;
      setLoading(true);
      try {
        const match = await fetchMatchById(selectedMatchId);
        setSelectedMatch(match);
        const events = await fetchTacticalEvents(selectedMatchId);
        setTacticalEvents(events);
        const aggregate = await fetchMatchAggregate(selectedMatchId);
        setAggregateData(aggregate);
        if (teamId) {
          const trends = await fetchSeasonalTrends(teamId);
          setSeasonalTrends(trends);
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    };
    loadSelectedMatch();
  }, [selectedMatchId, teamId]);

  useEffect(() => {
    if (!selectedMatchId) return;

    const channel = supabase
      .channel(`tactical_events_match_${selectedMatchId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tactical_events",
          filter: `match_id=eq.${selectedMatchId}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT" && payload.new) {
            setTacticalEvents((prev) => [...prev, payload.new as TacticalEvent].slice(-5000));
            return;
          }

          if (payload.eventType === "DELETE" && payload.old && "id" in payload.old) {
            const deletedId = String((payload.old as { id: string }).id);
            setTacticalEvents((prev) => prev.filter((event) => event.id !== deletedId));
          }
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("Realtime tactical_events subscription ready");
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedMatchId]);

  useEffect(() => {
    const resolvePlaybackUrl = async () => {
      const activeMatch = selectedMatch || matches.find((match) => match.id === selectedMatchId) || null;

      if (!selectedMatchId || !activeMatch?.video_url) {
        setPlaybackUrl(null);
        setPlaybackError(null);
        return;
      }

      // Direct URLs can play without signing.
      if (/^https?:\/\//i.test(activeMatch.video_url)) {
        setPlaybackUrl(activeMatch.video_url);
        setPlaybackError(null);
        return;
      }

      setIsResolvingPlayback(true);
      setPlaybackError(null);
      try {
        const accessToken = await getValidAccessToken();

        if (!accessToken) {
          setPlaybackError("Session expired. Please log in again.");
          setPlaybackUrl(null);
          return;
        }

        const response = await fetch(`/api/video-url?match_id=${selectedMatchId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const payload = await response.json();

        if (!response.ok || !payload?.playback_url) {
          setPlaybackError(payload?.error ?? "Unable to prepare video playback.");
          setPlaybackUrl(null);
          return;
        }

        setPlaybackUrl(payload.playback_url);
      } catch (resolveError) {
        console.error("resolvePlaybackUrl", resolveError);
        setPlaybackError("Unable to load match video.");
        setPlaybackUrl(null);
      } finally {
        setIsResolvingPlayback(false);
      }
    };

    resolvePlaybackUrl();
  }, [selectedMatchId, selectedMatch, matches]);

  const selectedMatches = useMemo(() => {
    if (!matches) return [];
    return matches;
  }, [matches]);

  const finalMatch = selectedMatch || selectedMatches.find((m) => m.id === selectedMatchId) || null;
  const analysis = useMemo(() => {
    if (aggregateData && aggregateData.source_event_count > 0) {
      return deriveAnalysisFromAggregate(aggregateData);
    }
    return deriveAnalysis(tacticalEvents);
  }, [aggregateData, tacticalEvents]);
  const coachingFlashpoints = useMemo(
    () => buildCoachingFlashpoints(analysis.insights, tacticalEvents),
    [analysis.insights, tacticalEvents]
  );
  const replayEvents = useMemo(() => buildReplayEventsFromTacticalEvents(tacticalEvents), [tacticalEvents]);
  const replayMatchDate = useMemo(() => {
    if (finalMatch) return formatMatchDate(finalMatch);
    if (selectedMatch) return formatMatchDate(selectedMatch);
    return "Date unavailable";
  }, [finalMatch, selectedMatch]);
  const finalMatchLabel = useMemo(() => {
    if (!finalMatch) return "No match selected yet";
    if (finalMatch.title?.trim()) return finalMatch.title;

    const homeTeamName = getTeamNameById(teams, finalMatch.home_team_id);
    const awayTeamName = getTeamNameById(teams, finalMatch.away_team_id);
    return `${homeTeamName} vs ${awayTeamName}`;
  }, [finalMatch, teams]);
  const finalMatchTeamsLabel = useMemo(() => {
    if (!finalMatch) return null;
    const homeTeamName = getTeamNameById(teams, finalMatch.home_team_id);
    const awayTeamName = getTeamNameById(teams, finalMatch.away_team_id);
    return `${homeTeamName} vs ${awayTeamName}`;
  }, [finalMatch, teams]);
  const primaryTas = analysis.metrics.find((metric) => metric.key === "tas")?.value;
  const hasSummaryEvent = tacticalEvents.some(
    (event) => event.event_type === "summary" && Number(event.timestamp_seconds) === -1
  );
  const matchStatus = finalMatch?.analysis_status ?? null;

  const runStatus = useMemo(() => {
    if (!selectedMatchId) return { label: "idle", textColor: "text-[#e7e2ff]/70", bgColor: "bg-white/10" };
    if (matchStatus === "failed") return { label: "failed", textColor: "text-[#f87171]", bgColor: "bg-[#f87171]/10" };
    if (matchStatus === "stopped") return { label: "stopped", textColor: "text-[#f97316]", bgColor: "bg-[#f97316]/10" };
    if (matchStatus === "completed") return { label: "complete", textColor: "text-[#39ff14]", bgColor: "bg-[#39ff14]/10" };
    if (matchStatus === "processing") return { label: "processing", textColor: "text-[#fbbf24]", bgColor: "bg-[#fbbf24]/10" };
    if (matchStatus === "queued") return { label: "queued", textColor: "text-[#93c5fd]", bgColor: "bg-[#93c5fd]/10" };
    if (hasSummaryEvent) return { label: "complete", textColor: "text-[#39ff14]", bgColor: "bg-[#39ff14]/10" };
    if (tacticalEvents.length > 0) return { label: "processing", textColor: "text-[#fbbf24]", bgColor: "bg-[#fbbf24]/10" };
    return { label: "queued", textColor: "text-[#93c5fd]", bgColor: "bg-[#93c5fd]/10" };
  }, [hasSummaryEvent, matchStatus, selectedMatchId, tacticalEvents.length]);

  const precisionWarning = useMemo(() => {
    // Precision warning is only relevant in raw-event fallback mode.
    if (aggregateData) {
      return null;
    }

    if (analysis.diagnostics.trackingEventCount < 200) {
      return null;
    }

    if (analysis.diagnostics.maxTimestampSeconds !== null && analysis.diagnostics.maxTimestampSeconds < 15) {
      return `Timestamp coverage is unusually short (${analysis.diagnostics.maxTimestampSeconds.toFixed(1)}s) for ${analysis.diagnostics.trackingEventCount.toLocaleString()} events. Data may be compressed or truncated.`;
    }

    if (!analysis.diagnostics.hasSubSecondPrecision) {
      return "All tracking timestamps are integral seconds. Sub-second precision appears missing, which can flatten early timeline metrics.";
    }

    return null;
  }, [aggregateData, analysis.diagnostics]);

  const handleWatchVideo = () => {
    if (!finalMatch || tacticalEvents.length === 0 || !playbackUrl) return;
    const firstEvent = tacticalEvents[0];
    if (!firstEvent) return;
    const seconds = Math.max(0, Math.floor(firstEvent.timestamp_seconds));
    const video = videoRef.current;
    if (!video) return;

    setPendingSeekSeconds(seconds);
    if (video.readyState >= 1) {
      video.currentTime = seconds;
      setPendingSeekSeconds(null);
    }
    void video.play().catch(() => {
      // Autoplay can be blocked until user interacts further.
    });
  };

  const handleWatchVideoAt = (seconds: number) => {
    if (!playbackUrl) return;
    const safeSeconds = Math.max(0, Math.floor(seconds));
    const video = videoRef.current;
    if (!video) return;

    setPendingSeekSeconds(safeSeconds);
    if (video.readyState >= 1) {
      video.currentTime = safeSeconds;
      setPendingSeekSeconds(null);
    }
    void video.play().catch(() => {
      // Autoplay can be blocked until user interacts further.
    });
  };

  return (
    <AuthGuard>
      <>
        <style>{`
          .analysis-bg {
              font-family: 'Inter', sans-serif;
              background: radial-gradient(circle at 20% 30%, rgba(139, 92, 246, 0.15), transparent 40%),
                          radial-gradient(circle at 80% 70%, rgba(255, 112, 110, 0.1), transparent 40%),
                          linear-gradient(135deg, #1a0b2e 0%, #0e0c20 100%);
              color: #e7e2ff;
              min-height: 100vh;
          }
          .font-headline { font-family: 'Montserrat', sans-serif; }
          .glass-panel {
              background: rgba(37, 33, 71, 0.4);
              backdrop-filter: blur(24px);
              border: 1px solid rgba(231, 226, 255, 0.1);
              border-top: 1px solid rgba(255, 255, 255, 0.15);
              border-left: 1px solid rgba(255, 255, 255, 0.15);
              box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.4);
          }
          .radar-grid {
              background-image: radial-gradient(circle, rgba(139, 92, 246, 0.1) 1px, transparent 1px);
              background-size: 30px 30px;
          }
        `}</style>
        <div className="analysis-bg overflow-x-hidden">
          <TopNavBar
            hideSearch={true}
            teams={teams}
            selectedTeamId={teamId}
            tasScore={finalMatch?.tas ?? primaryTas ?? null}
            onToggleMenu={() => setIsMobileMenuOpen((prev) => !prev)}
            isMenuOpen={isMobileMenuOpen}
            onTeamChange={(newTeamId) => {
              setTeamId(newTeamId);
              setSelectedMatchId(null);
              setMatches([]);
              setSelectedMatch(null);
              router.replace(`/analysis?id=`);
            }}
          />
          <SideNavBar
            onLogout={handleLogout}
            currentPage="analysis"
            isMobileMenuOpen={isMobileMenuOpen}
            onCloseMobileMenu={() => setIsMobileMenuOpen(false)}
          />

          {/* Main Content Canvas */}
          <main className="lg:ml-64 pt-20 min-h-screen relative">
            {/* Large Scale Player Cutout */}
            <div className="fixed top-0 right-0 w-3/4 h-full pointer-events-none z-0 opacity-40 overflow-hidden">
              <img
                alt="Player Cutout"
                className="object-cover h-full w-full object-right mix-blend-screen grayscale contrast-125 brightness-75"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuDsGZIk0KmeYlonRwYFmt7GWggifbjs6nmgkPC6jaoy5HLs_0-R_iu21Yp_0DEpyZL7nXQJAqE3U9wpsqmQNRO52QqYmAqUZLGN7brYI7yPtzJxoLxszFdZIMmyLTjLpjFtdkxbgfr76WtiSpRjtRRTqlpZhe0sQvtGlJgxQe6Y7LIipcV_HGxjG083GxXS77wDEvC4r6SU-n6O_egmkixC-q7P4f0B5KmwfvvcFtlJeeW8IArzVGewW0nJchAmo-IsxaIVCXgTSIw"
              />
            </div>

            <section className="px-8 py-6 relative z-10 flex flex-col md:flex-row justify-between items-stretch gap-6">
              <div className="glass-panel w-full md:flex-1 rounded-[2rem] px-8 py-5 md:px-10 md:py-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <p className="text-[10px] uppercase tracking-widest text-[#e7e2ff]/40">
                    {finalMatch ? "Match analysis loaded from dashboard" : "Select a match to begin analysis"}
                  </p>
                  <span className={`text-[10px] font-bold uppercase tracking-widest rounded-full px-2 py-1 ${runStatus.textColor} ${runStatus.bgColor}`}>
                    {runStatus.label}
                  </span>
                </div>

                <h1 className="text-2xl md:text-3xl font-black text-white">
                  {finalMatchLabel}
                </h1>

                <div className="mt-3 text-sm text-[#e7e2ff]/70 space-y-2">
                  {finalMatch ? (
                    <>
                      <p>Match: {finalMatchTeamsLabel}</p>
                      <p>Date: {formatMatchDate(finalMatch)}</p>
                      <p>Category: {finalMatch?.league ?? "Tactical scan"}</p>
                    </>
                  ) : (
                    <p>Pick a match on the home dashboard to stream metadata here.</p>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-4 glass-panel rounded-[2rem] px-6 py-4 md:px-7 md:py-5 self-start md:self-auto">
                <div className="text-right">
                  <p className="text-[9px] text-[#e7e2ff]/40 tracking-[0.2em] uppercase font-bold">Team Aptitude Score</p>
                  <p className="text-2xl font-black font-headline text-[#ff706e]">
                    {finalMatch?.tas?.toFixed(1) ?? (primaryTas !== null && primaryTas !== undefined ? primaryTas.toFixed(1) : "—")} <span className="text-[10px] text-[#e7e2ff]/40 ml-1">TAS</span>
                  </p>
                </div>
                <div className="relative w-14 h-14 flex items-center justify-center">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle className="text-[#252147]/40" cx="28" cy="28" fill="transparent" r="24" stroke="currentColor" strokeWidth="4"></circle>
                    <circle className="text-[#ff706e]" cx="28" cy="28" fill="transparent" r="24" stroke="currentColor" strokeDasharray="151" strokeDashoffset="17" strokeLinecap="round" strokeWidth="4"></circle>
                  </svg>
                  <span className="absolute material-symbols-outlined text-[#ff706e] text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>bolt</span>
                </div>
              </div>
            </section>

            <div className="px-8 grid grid-cols-12 gap-6 relative z-10 pb-12">
              {/* Main Performance Card */}
              <div className="col-span-12 lg:col-span-8 glass-panel rounded-xl p-8 min-h-[500px] flex flex-col justify-between overflow-hidden relative">
                <div className="flex justify-between items-start relative z-10">
                  <div>
                    <h2 className="text-4xl font-headline font-black tracking-tighter text-white uppercase">
                      SynIQ Index <span className="text-[#ff706e]">v2.4</span>
                    </h2>
                    <p className="text-[#e7e2ff]/60 text-xs font-medium mt-2 tracking-wide uppercase">Collective Synchronisation Analytics • Real-time Pulse</p>
                  </div>
                  <div className="flex space-x-3">
                    <span className="px-4 py-1.5 bg-[#39ff14]/10 text-[#39ff14] border border-[#39ff14]/20 rounded-full text-[9px] font-bold tracking-widest">LIVE DATA</span>
                    <span className="px-4 py-1.5 bg-[#252147]/40 text-white rounded-full text-[9px] font-bold tracking-widest">99.2% ACCURACY</span>
                  </div>
                </div>

                {/* Empty State or Data Container */}
                {selectedMatch && tacticalEvents.length === 0 ? (
                  <div className="flex-grow flex items-center justify-center py-12 relative">
                    <div className="text-center space-y-6 w-full max-w-md px-4">
                      {/* Pulsing Processing Badge */}
                      <div className="flex justify-center">
                        <span className="inline-flex items-center space-x-2 px-4 py-2 bg-[#fbbf24]/10 border border-[#fbbf24]/30 rounded-full">
                          <span className="w-2 h-2 bg-[#fbbf24] rounded-full animate-pulse"></span>
                          <span className="text-xs text-[#fbbf24] font-bold tracking-wide uppercase">Processing</span>
                        </span>
                      </div>

                      <h3 className="text-2xl font-headline font-black text-white">Video Analysis in Progress</h3>
                      <p className="text-sm text-[#e7e2ff]/60">Scanning footage for tactical insights and player positions...</p>

                      {/* Progress Bar */}
                      <div className="space-y-3 w-full">
                        <div className="w-full h-2 bg-[#1a0f2e] rounded-full overflow-hidden border border-[#ff706e]/20">
                          <div
                            className="h-full bg-gradient-to-r from-[#ff706e] to-[#fbbf24] rounded-full transition-all duration-500 ease-out"
                            style={{
                              width: `${Math.min((tacticalEvents.length / 120) * 100, 95)}%`,
                              animation: tacticalEvents.length === 0 ? 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' : 'none'
                            }}
                          ></div>
                        </div>
                        <div className="flex justify-between items-center px-1 text-xs">
                          <span className="text-[#e7e2ff]/60">
                            <span className="font-bold text-white">{tacticalEvents.length}</span> events detected
                          </span>
                          <span className="text-[#e7e2ff]/60">
                            ~<span className="font-bold text-[#ff706e]">{Math.min(Math.round((tacticalEvents.length / 120) * 100), 95)}%</span> complete
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : !selectedMatch ? (
                  <div className="flex-grow flex items-center justify-center py-12 relative">
                    <div className="text-center space-y-4">
                      <span className="material-symbols-outlined text-6xl text-[#ff706e]/50" style={{ fontVariationSettings: "'FILL' 1" }}>play_circle</span>
                      <h3 className="text-2xl font-headline font-black text-white">Analysis Pending</h3>
                      <p className="text-sm text-[#e7e2ff]/60 max-w-sm">Submit a match video and we&apos;ll stream real-time tactical insights, player positions, and SynIQ metrics here.</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex-grow py-4 relative z-10">
                    <TacticalReplayHub
                      matchName={formatMatchTitle(finalMatch)}
                      matchDate={replayMatchDate}
                      events={replayEvents}
                      onSyncToSecond={handleWatchVideoAt}
                    />
                  </div>
                )}

                <div className="flex justify-between items-end relative z-10">
                  {tacticalEvents.length > 0 && (
                    <div className="flex space-x-12">
                      <div>
                        <p className="text-[9px] text-[#e7e2ff]/40 uppercase tracking-[0.2em] font-bold">Events Tracked</p>
                        <p className="text-2xl font-headline font-black text-white">{tacticalEvents.length}</p>
                      </div>
                    </div>
                  )}
                  <button onClick={handleWatchVideo} disabled={tacticalEvents.length === 0} className="px-8 py-4 bg-[#ff706e] text-[#0e0c20] font-black text-[10px] tracking-[0.2em] uppercase rounded-full hover:shadow-[0_0_25px_rgba(255,112,110,0.5)] transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed">
                    WATCH VIDEO EVIDENCE
                  </button>
                </div>

                {tacticalEvents.length > 0 && (
                  <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-[#e7e2ff]/75">
                      Timeline bins: <span className="font-bold text-white">{analysis.diagnostics.timelineWindowCount}</span>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-[#e7e2ff]/75">
                      Bin size: <span className="font-bold text-white">{analysis.diagnostics.binSizeSeconds.toFixed(1)}s</span>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-[#e7e2ff]/75">
                      Time span: <span className="font-bold text-white">{analysis.diagnostics.minTimestampSeconds?.toFixed(1) ?? "0.0"}s - {analysis.diagnostics.maxTimestampSeconds?.toFixed(1) ?? "0.0"}s</span>
                    </div>
                  </div>
                )}

                {precisionWarning && (
                  <div className="mt-4 rounded-lg border border-[#fbbf24]/30 bg-[#fbbf24]/10 px-4 py-3 text-sm text-[#fbbf24]">
                    {precisionWarning}
                  </div>
                )}

                <div className="mt-6 rounded-xl border border-white/10 bg-black/30 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-[10px] uppercase tracking-widest text-[#e7e2ff]/60">Match Video</p>
                    {pendingSeekSeconds !== null && (
                      <p className="text-[10px] uppercase tracking-widest text-[#ff706e]">
                        Seeking to {formatSeconds(pendingSeekSeconds)}
                      </p>
                    )}
                  </div>
                  {isResolvingPlayback ? (
                    <div className="h-44 flex items-center justify-center text-sm text-[#e7e2ff]/70">
                      Preparing secure video stream...
                    </div>
                  ) : playbackUrl ? (
                    <video
                      ref={videoRef}
                      src={playbackUrl}
                      controls
                      preload="metadata"
                      className="w-full rounded-lg border border-white/10"
                      onLoadedMetadata={() => {
                        if (pendingSeekSeconds !== null && videoRef.current) {
                          videoRef.current.currentTime = pendingSeekSeconds;
                          setPendingSeekSeconds(null);
                        }
                      }}
                    />
                  ) : (
                    <div className="h-44 flex items-center justify-center text-sm text-[#fbbf24]">
                      {playbackError ?? "No video playback source available for this match."}
                    </div>
                  )}
                </div>
              </div>

              {/* Individual Metric Grid - Empty State */}
              {tacticalEvents.length === 0 ? (
                <div className="col-span-12 lg:col-span-4 glass-panel p-8 rounded-xl flex flex-col items-center justify-center text-center">
                  <span className="material-symbols-outlined text-5xl text-[#ff706e]/40 mb-4" style={{ fontVariationSettings: "'FILL' 1" }}>analytics</span>
                  <h3 className="text-lg font-headline font-black text-white mb-2">Metrics Ready</h3>
                  <p className="text-sm text-[#e7e2ff]/60">Tactical metrics, cohesion stats, and safety flags will populate here once video analysis completes.</p>
                </div>
              ) : (
                <div className="col-span-12 lg:col-span-4 grid grid-cols-1 gap-4">
                  {analysis.metrics.map((metric) => (
                    <div key={metric.key} className="glass-panel rounded-xl p-4 border border-white/10">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] uppercase tracking-widest text-[#e7e2ff]/50 font-bold">{metric.label}</p>
                        <span className="text-[10px] px-2 py-1 rounded-full bg-white/10 text-[#e7e2ff]/70">
                          Confidence {(metric.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                      <p className="mt-2 text-2xl font-black text-white">
                        {metric.value === null ? "—" : metric.value.toFixed(metric.unit === "pts" ? 1 : 1)}
                        <span className="ml-1 text-xs text-[#e7e2ff]/50">{metric.unit}</span>
                      </p>
                      <p className="mt-1 text-xs text-[#e7e2ff]/60">{metric.description}</p>
                      {metric.evidenceTimestamp !== null && (
                        <button
                          onClick={() => handleWatchVideoAt(metric.evidenceTimestamp as number)}
                          className="mt-3 text-xs text-[#ff706e] hover:text-[#fbbf24] font-bold tracking-wide uppercase"
                        >
                          Evidence at {formatSeconds(metric.evidenceTimestamp)}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Key Moment Analysis - Empty State or Data */}
              {tacticalEvents.length === 0 ? (
                <div className="col-span-12 lg:col-span-7 glass-panel rounded-xl p-8 flex items-center justify-center">
                  <div className="text-center space-y-4">
                    <span className="material-symbols-outlined text-5xl text-[#ff706e]/40 mx-auto block" style={{ fontVariationSettings: "'FILL' 1" }}>insight</span>
                    <h3 className="text-lg font-headline font-black text-white">Key Moments Loading</h3>
                    <p className="text-sm text-[#e7e2ff]/60 max-w-md">When your analysis processes, frame-by-frame tactical insights and critical moments will be displayed here.</p>
                  </div>
                </div>
              ) : (
                <div className="col-span-12 lg:col-span-7 glass-panel rounded-xl overflow-hidden">
                  <div className="px-8 py-6 border-b border-[#47436c]/20 bg-[#252147]/20">
                    <h3 className="font-headline font-black text-white uppercase tracking-tight">Evidence Insights ({analysis.insights.length})</h3>
                  </div>
                  <div className="p-6 space-y-4">
                    {!analysis.hasStrongEvidence && (
                      <div className="rounded-lg border border-[#fbbf24]/30 bg-[#fbbf24]/10 p-4 text-[#fbbf24] text-sm">
                        Evidence quality is still low. Narrative cards are withheld until confidence thresholds are met.
                      </div>
                    )}
                    {analysis.insights.map((insight) => (
                      <div key={insight.id} className="rounded-lg border border-white/10 bg-white/5 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-black uppercase tracking-wide text-white">{insight.title}</p>
                          <span className="text-[10px] px-2 py-1 rounded-full bg-[#39ff14]/10 text-[#39ff14]">
                            {(insight.confidence * 100).toFixed(0)}% confidence
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-[#e7e2ff]/80">{insight.claim}</p>
                        <div className="mt-3 flex items-center justify-between">
                          <p className="text-[11px] text-[#e7e2ff]/50 uppercase tracking-widest">
                            Metrics: {insight.metricKeys.join(", ")}
                          </p>
                          <button
                            onClick={() => handleWatchVideoAt(insight.timestampSeconds)}
                            className="text-xs text-[#ff706e] hover:text-[#fbbf24] font-bold uppercase"
                          >
                            Open {formatSeconds(insight.timestampSeconds)}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Coaching Flashpoints - Empty State or Data */}
              {tacticalEvents.length === 0 ? (
                <div className="col-span-12 lg:col-span-5 glass-panel rounded-xl p-8 flex items-center justify-center">
                  <div className="text-center space-y-4">
                    <span className="material-symbols-outlined text-5xl text-[#ff706e]/40 mx-auto block" style={{ fontVariationSettings: "'FILL' 1" }}>feed</span>
                    <h3 className="text-lg font-headline font-black text-white">Coaching Flashpoints Ready</h3>
                    <p className="text-sm text-[#e7e2ff]/60 max-w-md">Curated, timestamped moments will appear here once strong evidence is available.</p>
                  </div>
                </div>
              ) : (
                <div className="col-span-12 lg:col-span-5 glass-panel rounded-xl flex flex-col">
                  <div className="px-8 py-6 border-b border-[#47436c]/20 bg-[#252147]/20">
                    <h3 className="font-headline font-black text-white uppercase tracking-tight">
                      Coaching Flashpoints ({coachingFlashpoints.length})
                    </h3>
                    <p className="mt-2 text-xs text-[#e7e2ff]/60">
                      Direct, timestamped video evidence for key behavioral moments.
                    </p>
                  </div>
                  <div className="p-8 space-y-6 flex-grow overflow-y-auto">
                    {coachingFlashpoints.length === 0 ? (
                      <div className="rounded-lg border border-[#fbbf24]/30 bg-[#fbbf24]/10 p-4 text-sm text-[#fbbf24]">
                        No distinct flashpoints yet. Moments will appear once tactical events diversify beyond raw tracking frames.
                      </div>
                    ) : (
                      coachingFlashpoints.map((flashpoint) => (
                        <div key={flashpoint.id} className="border border-white/10 bg-white/5 rounded-lg p-4">
                          <div className="flex items-center justify-between gap-3">
                            <span className={`text-[10px] px-2 py-1 rounded-full border uppercase tracking-widest ${getCategoryAccent(flashpoint.category)}`}>
                              {flashpoint.category}
                            </span>
                            <span className="text-[10px] px-2 py-1 rounded-full bg-[#39ff14]/10 text-[#39ff14]">
                              {(flashpoint.confidence * 100).toFixed(0)}% confidence
                            </span>
                          </div>
                          <p className="mt-2 text-[10px] uppercase tracking-widest text-[#e7e2ff]/50">
                            {flashpoint.source === "insight" ? "Model Insight" : "Signal Event"}
                          </p>
                          <p className="mt-2 text-sm font-bold text-white uppercase tracking-wide">{flashpoint.title}</p>
                          <p className="mt-2 text-sm text-[#e7e2ff]/80">{flashpoint.summary}</p>
                          <div className="mt-3 flex items-center justify-between gap-3">
                            <p className="text-[11px] text-[#e7e2ff]/50 uppercase tracking-widest">
                              {flashpoint.metricKeys.join(", ")}
                            </p>
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => handleWatchVideoAt(flashpoint.timestampSeconds)}
                                className="text-[11px] text-[#ff706e] hover:text-[#fbbf24] font-bold uppercase"
                              >
                                Jump {formatSeconds(flashpoint.timestampSeconds)}
                              </button>
                              {selectedMatchId && (
                                <a
                                  href={`/analysis?id=${encodeURIComponent(selectedMatchId)}&ts=${Math.floor(flashpoint.timestampSeconds)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[11px] text-[#93c5fd] hover:text-[#bfdbfe] font-bold uppercase"
                                >
                                  Open Link
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {ANALYSIS_COMPARISON_ENABLED && (
                <div className="col-span-12 glass-panel rounded-xl p-6 border border-white/10">
                  <h3 className="font-headline font-black text-white uppercase tracking-tight">Comparison Mode</h3>
                  <p className="mt-2 text-sm text-[#e7e2ff]/70">
                    Benchmark vs anomaly comparison is enabled. UI scaffolding is ready for paired-match deltas.
                  </p>
                </div>
              )}
            </div>
          </main>

          <section className="px-8 pb-8 lg:pb-16">
            <SeasonalProgressChart data={seasonalTrends} />
          </section>

          {/* Contextual FAB */}
          <button className="fixed bottom-10 right-10 w-16 h-16 bg-[#ff706e] text-[#0e0c20] rounded-full shadow-[0_0_40px_rgba(255,112,110,0.4)] flex items-center justify-center z-50 hover:scale-110 transition-transform active:scale-90">
            <span className="material-symbols-outlined text-3xl font-black">query_stats</span>
          </button>
        </div>
      </>
    </AuthGuard>
  );
}