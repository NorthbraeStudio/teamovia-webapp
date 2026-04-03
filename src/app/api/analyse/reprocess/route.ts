export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getR2Bucket, getR2Client } from "@/lib/r2";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const modalApiUrl = process.env.MODAL_API_URL;
const modalApiKey = process.env.MODAL_API_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error("Supabase URL and service role key are required");
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

function isMissingStatusColumnError(message: string): boolean {
  return /Could not find the 'analysis_status' column|analysis_started_at|analysis_completed_at|analysis_error/i.test(
    message
  );
}

async function safeUpdateMatchStatus(
  matchId: string,
  payload: {
    analysis_status: "queued" | "processing" | "completed" | "failed" | "stopped";
    analysis_started_at?: string | null;
    analysis_completed_at?: string | null;
    analysis_error?: string | null;
  }
): Promise<void> {
  const { error } = await supabase.from("matches").update(payload).eq("id", matchId);
  if (!error) return;

  if (isMissingStatusColumnError(error.message ?? "")) {
    return;
  }

  throw error;
}

function cleanEnvValue(value: string): string {
  return value.trim().replace(/^['\"]+|['\"]+$/g, "").trim();
}

function extractWorkerMessage(rawBody: string): string {
  if (!rawBody) return "No response body";
  try {
    const parsed = JSON.parse(rawBody) as { detail?: unknown; error?: unknown };
    if (typeof parsed.detail === "string" && parsed.detail.trim()) return parsed.detail;
    if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error;
  } catch {
    // Keep raw text when worker did not return JSON.
  }
  return rawBody;
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isDirectVideoUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return /\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(parsed.pathname + parsed.search + parsed.hash);
  } catch {
    return false;
  }
}

function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return /^#[0-9a-fA-F]{6}$/.test(withHash) ? withHash.toUpperCase() : fallback;
}

export async function POST(request: NextRequest) {
  try {
    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return NextResponse.json(
        { error: "Supabase server configuration missing." },
        { status: 500 }
      );
    }
    const safeSupabaseUrl = supabaseUrl;
    const safeSupabaseServiceRoleKey = supabaseServiceRoleKey;

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

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileError) {
      return NextResponse.json({ error: "Unable to verify user role." }, { status: 500 });
    }

    if (profile?.role !== "admin") {
      return NextResponse.json(
        { error: "Only administrators can reprocess analyses." },
        { status: 403 }
      );
    }

    if (!modalApiUrl || !modalApiKey) {
      return NextResponse.json(
        { error: "Worker not configured (Modal API key/url missing)" },
        { status: 500 }
      );
    }

    const body = await request.json();
    const matchId = typeof body?.match_id === "string" ? body.match_id.trim() : "";

    if (!matchId || !isValidUuid(matchId)) {
      return NextResponse.json({ error: "A valid match_id is required." }, { status: 400 });
    }

    const { data: match, error: matchError } = await supabase
      .from("matches")
      .select("id, video_url, r2_object_key, home_team_id, away_team_id")
      .eq("id", matchId)
      .maybeSingle();

    if (matchError || !match) {
      return NextResponse.json({ error: "Match not found." }, { status: 404 });
    }

    let videoSourceUrl = "";
    const keyFromVideoUrl =
      typeof match.video_url === "string" && match.video_url.startsWith("r2://")
        ? match.video_url.replace(/^r2:\/\//, "").trim()
        : "";

    const resolvedObjectKey =
      typeof match.r2_object_key === "string" && match.r2_object_key.trim().length > 0
        ? match.r2_object_key.trim()
        : keyFromVideoUrl;

    if (resolvedObjectKey) {
      const command = new GetObjectCommand({
        Bucket: getR2Bucket(),
        Key: resolvedObjectKey,
      });
      videoSourceUrl = await getSignedUrl(getR2Client(), command, { expiresIn: 1800 });
    } else if (typeof match.video_url === "string" && isDirectVideoUrl(match.video_url)) {
      videoSourceUrl = match.video_url;
    }

    if (!videoSourceUrl) {
      return NextResponse.json(
        { error: "No playable source found for this match. Re-upload may be required." },
        { status: 400 }
      );
    }

    let homeTeamColor = "#E11D48";
    let awayTeamColor = "#2563EB";

    if (match.home_team_id && match.away_team_id) {
      const [{ data: homeTeam }, { data: awayTeam }] = await Promise.all([
        supabase.from("teams").select("*").eq("id", match.home_team_id).maybeSingle(),
        supabase.from("teams").select("*").eq("id", match.away_team_id).maybeSingle(),
      ]);

      homeTeamColor = normalizeHexColor(
        (homeTeam as { primary_color?: unknown; primary_colour?: unknown } | null)?.primary_color ??
          (homeTeam as { primary_color?: unknown; primary_colour?: unknown } | null)?.primary_colour,
        homeTeamColor
      );
      awayTeamColor = normalizeHexColor(
        (awayTeam as { primary_color?: unknown; primary_colour?: unknown } | null)?.primary_color ??
          (awayTeam as { primary_color?: unknown; primary_colour?: unknown } | null)?.primary_colour,
        awayTeamColor
      );
    }

    const { error: deleteError } = await supabase
      .from("tactical_events")
      .delete()
      .eq("match_id", match.id);

    if (deleteError) {
      return NextResponse.json(
        { error: deleteError.message ?? "Failed to clear existing tactical events." },
        { status: 500 }
      );
    }

    await safeUpdateMatchStatus(match.id, {
      analysis_status: "processing",
      analysis_started_at: new Date().toISOString(),
      analysis_completed_at: null,
      analysis_error: null,
    });

    let modalResponseBody = "";
    try {
      const modalResponse = await fetch(modalApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_url: videoSourceUrl,
          youtube_url: videoSourceUrl,
          match_id: match.id,
          worker_auth: modalApiKey,
          supabase_url: cleanEnvValue(safeSupabaseUrl),
          supabase_service_role_key: cleanEnvValue(safeSupabaseServiceRoleKey),
          home_team_color: homeTeamColor,
          away_team_color: awayTeamColor,
        }),
      });

      modalResponseBody = await modalResponse.text();
      if (!modalResponse.ok) {
        const workerMessage = extractWorkerMessage(modalResponseBody);
        const status =
          modalResponse.status >= 400 && modalResponse.status < 500
            ? modalResponse.status
            : 502;

        return NextResponse.json(
          {
            error: `Modal trigger failed (${modalResponse.status}): ${workerMessage}`,
          },
          { status }
        );
      }
    } catch {
      return NextResponse.json(
        { error: "Unable to reach Modal worker. Please try again." },
        { status: 502 }
      );
    }

    return NextResponse.json({
      match_id: match.id,
      message: "reprocess started",
      events_overwritten: true,
    });
  } catch {
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}
