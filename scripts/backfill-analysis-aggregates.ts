import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import { computeAggregateFromTrackingEvents } from "../src/lib/analysisAggregate";

const envPath = path.join(process.cwd(), ".env.local");
const envContent = fs.readFileSync(envPath, "utf-8");
envContent.split("\n").forEach((line) => {
  if (!line || line.startsWith("#")) return;
  const [key, ...rest] = line.split("=");
  if (key) {
    const value = rest.join("=").trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

function getArgValue(name: string): string | null {
  const index = process.argv.findIndex((arg) => arg === `--${name}`);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

async function fetchTrackingEvents(matchId: string) {
  const pageSize = 1000;
  let offset = 0;
  const results: Array<{
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
      throw new Error(`Failed to load tactical events for ${matchId}: ${error.message}`);
    }

    const chunk = (data ?? []) as Array<{
      timestamp_seconds: number;
      tas_score: number;
      x_coord: number;
      y_coord: number;
    }>;

    results.push(...chunk);
    if (chunk.length < pageSize) break;
    offset += pageSize;
  }

  return results;
}

async function getTargetMatchIds(singleMatchId: string | null): Promise<string[]> {
  if (singleMatchId) {
    return [singleMatchId];
  }

  const { data, error } = await supabase.from("matches").select("id");
  if (error) {
    throw new Error(`Failed to list matches: ${error.message}`);
  }

  return (data ?? []).map((row: { id: string }) => row.id);
}

async function run() {
  const matchId = getArgValue("match-id");
  const targetMatchIds = await getTargetMatchIds(matchId);

  if (targetMatchIds.length === 0) {
    console.log("No matches found for aggregate backfill.");
    return;
  }

  console.log(`Starting aggregate backfill for ${targetMatchIds.length} match(es)...`);

  let succeeded = 0;
  let failed = 0;

  for (const id of targetMatchIds) {
    try {
      const events = await fetchTrackingEvents(id);
      const aggregate = computeAggregateFromTrackingEvents(events, 1);

      const payload = {
        match_id: id,
        source_event_count: aggregate.diagnostics.trackingEventCount,
        source_min_timestamp: aggregate.diagnostics.minTimestampSeconds,
        source_max_timestamp: aggregate.diagnostics.maxTimestampSeconds,
        base_bin_seconds: aggregate.diagnostics.binSizeSeconds,
        timeline_windows: aggregate.windows,
        summary_metrics: aggregate.metrics,
        insight_cards: aggregate.insights,
        generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { error: upsertError } = await supabase
        .from("match_analysis_aggregates")
        .upsert(payload, { onConflict: "match_id" });

      if (upsertError) {
        throw new Error(upsertError.message);
      }

      console.log(
        `✔ ${id} | events=${aggregate.diagnostics.trackingEventCount} windows=${aggregate.diagnostics.timelineWindowCount}`
      );
      succeeded += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(`✖ ${id} | ${message}`);
    }
  }

  console.log(`Backfill complete. succeeded=${succeeded}, failed=${failed}`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`Backfill failed: ${message}`);
  process.exit(1);
});
