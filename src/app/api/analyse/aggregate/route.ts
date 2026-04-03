export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  computeAggregateFromTrackingEvents,
  parseStoredTimelineWindows,
  rebucketStoredTimelineWindows,
  toTimelineWindowView,
} from "@/lib/analysisAggregate";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error("Supabase URL and service role key are required");
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

type AggregateRow = {
  match_id: string;
  source_event_count: number;
  source_min_timestamp: number | null;
  source_max_timestamp: number | null;
  base_bin_seconds: number;
  timeline_windows: unknown;
  summary_metrics: unknown;
  insight_cards: unknown;
  generated_at: string;
};

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function upsertAggregateForMatch(matchId: string) {
  const pageSize = 1000;
  let offset = 0;
  const points: Array<{
    timestamp_seconds: number;
    tas_score: number;
    x_coord: number;
    y_coord: number;
  }> = [];

  while (true) {
    const { data, error } = await supabase
      .from("tactical_events")
      .select("timestamp_seconds, tas_score, x_coord, y_coord")
      .eq("match_id", matchId)
      .eq("event_type", "player_tracking")
      .gte("timestamp_seconds", 0)
      .order("timestamp_seconds", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      throw new Error(`Failed to fetch tracking events: ${error.message}`);
    }

    const chunk = (data ?? []) as Array<{
      timestamp_seconds: number;
      tas_score: number;
      x_coord: number;
      y_coord: number;
    }>;

    points.push(...chunk);

    if (chunk.length < pageSize) {
      break;
    }

    offset += pageSize;
  }

  const computed = computeAggregateFromTrackingEvents(points, 1);

  const payload = {
    match_id: matchId,
    source_event_count: computed.diagnostics.trackingEventCount,
    source_min_timestamp: computed.diagnostics.minTimestampSeconds,
    source_max_timestamp: computed.diagnostics.maxTimestampSeconds,
    base_bin_seconds: computed.diagnostics.binSizeSeconds,
    timeline_windows: computed.windows,
    summary_metrics: computed.metrics,
    insight_cards: computed.insights,
    generated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { error: upsertError } = await supabase
    .from("match_analysis_aggregates")
    .upsert(payload, { onConflict: "match_id" });

  if (upsertError) {
    throw new Error(`Failed to upsert aggregate: ${upsertError.message}`);
  }

  return payload;
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

    if (!token) {
      return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json({ error: "Invalid session." }, { status: 401 });
    }

    const matchId = request.nextUrl.searchParams.get("match_id")?.trim() ?? "";
    const requestedBin = Number(request.nextUrl.searchParams.get("bin_seconds") ?? "5");
    const requestedBinSeconds = Number.isFinite(requestedBin) ? Math.max(0.5, Math.min(60, requestedBin)) : 5;

    if (!matchId || !isValidUuid(matchId)) {
      return NextResponse.json({ error: "A valid match_id is required." }, { status: 400 });
    }

    const { data: aggregateData, error: aggregateError } = await supabase
      .from("match_analysis_aggregates")
      .select("*")
      .eq("match_id", matchId)
      .maybeSingle();

    if (aggregateError) {
      return NextResponse.json({ error: aggregateError.message }, { status: 500 });
    }

    const { count: currentTrackingCount, error: countError } = await supabase
      .from("tactical_events")
      .select("id", { count: "exact", head: true })
      .eq("match_id", matchId)
      .eq("event_type", "player_tracking")
      .gte("timestamp_seconds", 0);

    if (countError) {
      return NextResponse.json({ error: countError.message }, { status: 500 });
    }

    let aggregate = (aggregateData as AggregateRow | null) ?? null;
    if (!aggregate || (currentTrackingCount ?? 0) !== aggregate.source_event_count) {
      aggregate = await upsertAggregateForMatch(matchId);
    }

    const storedWindows = parseStoredTimelineWindows(aggregate.timeline_windows);
    const rebucketedWindows = rebucketStoredTimelineWindows(storedWindows, requestedBinSeconds);
    const timelineWindows = toTimelineWindowView(rebucketedWindows);

    return NextResponse.json({
      match_id: matchId,
      bin_seconds: requestedBinSeconds,
      source_event_count: aggregate.source_event_count,
      source_min_timestamp: aggregate.source_min_timestamp,
      source_max_timestamp: aggregate.source_max_timestamp,
      metrics: aggregate.summary_metrics,
      insights: aggregate.insight_cards,
      timeline_windows: timelineWindows,
      generated_at: aggregate.generated_at,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
