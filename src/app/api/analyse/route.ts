export const dynamic = 'force-dynamic';
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getR2Client, getR2Bucket } from "@/lib/r2";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const modalApiUrl = process.env.MODAL_API_URL;
const modalApiKey = process.env.MODAL_API_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error("Supabase URL and service role key are required");
}

const safeSupabaseUrl: string = supabaseUrl;
const safeSupabaseServiceRoleKey: string = supabaseServiceRoleKey;

const supabase = createClient(safeSupabaseUrl, safeSupabaseServiceRoleKey);

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

function isDirectVideoUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return /\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(parsed.pathname + parsed.search + parsed.hash);
  } catch {
    return false;
  }
}

function normalizeVideoSourceUrl(value: string, request: NextRequest): string {
  const trimmed = value.trim();
  if (/^\/videos\//i.test(trimmed)) {
    return `${request.nextUrl.origin}${trimmed}`;
  }
  if (/^videos\//i.test(trimmed)) {
    return `${request.nextUrl.origin}/${trimmed}`;
  }
  return trimmed;
}

function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return /^#[0-9a-fA-F]{6}$/.test(withHash) ? withHash.toUpperCase() : fallback;
}

export async function POST(request: NextRequest) {
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

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("profile lookup error", profileError);
      return NextResponse.json({ error: "Unable to verify user role." }, { status: 500 });
    }

    const isAdmin = profile?.role === "admin";

    const body = await request.json();
    const { video_url, object_key, home_team_id, away_team_id, match_date, file_size } = body;

    const resolvedMatchDate =
      typeof match_date === "string" && match_date.trim().length > 0
        ? match_date
        : new Date().toISOString().split("T")[0];

    let videoSourceUrl: string;
    let r2ObjectKey: string | null = null;

    if (typeof object_key === "string" && object_key.trim().length > 0) {
      // R2 upload path — generate a short-lived signed GET URL for the worker
      r2ObjectKey = object_key.trim();
      try {
        const command = new GetObjectCommand({
          Bucket: getR2Bucket(),
          Key: r2ObjectKey,
        });
        videoSourceUrl = await getSignedUrl(getR2Client(), command, { expiresIn: 1800 });
      } catch (r2Error) {
        console.error("R2 signed URL error", r2Error);
        return NextResponse.json(
          { error: "Failed to prepare video for analysis. Please try again." },
          { status: 500 }
        );
      }
    } else {
      // Legacy direct-URL path
      videoSourceUrl = normalizeVideoSourceUrl(
        typeof video_url === "string" ? video_url : "",
        request
      );

      if (!videoSourceUrl) {
        return NextResponse.json({ error: "A video URL or uploaded file is required." }, { status: 400 });
      }

      if (!isDirectVideoUrl(videoSourceUrl)) {
        return NextResponse.json(
          { error: "Provide a direct video URL (.mp4/.mov/.m4v/.webm) or upload a file." },
          { status: 400 }
        );
      }
    }

    if (!isAdmin && (home_team_id || away_team_id)) {
      return NextResponse.json(
        { error: "Only administrators can assign home and away teams." },
        { status: 403 }
      );
    }

    if (isAdmin && (!home_team_id || !away_team_id)) {
      return NextResponse.json({ error: "Please select both home and away teams." }, { status: 400 });
    }

    if (isAdmin && home_team_id === away_team_id) {
      return NextResponse.json({ error: "Home and away teams must be different." }, { status: 400 });
    }

    if (!modalApiUrl || !modalApiKey) {
      return NextResponse.json(
        { error: "Worker not configured (Modal API key/url missing)" },
        { status: 500 }
      );
    }

    const insertPayload = {
      video_url: r2ObjectKey ? `r2://${r2ObjectKey}` : videoSourceUrl,
      r2_object_key: r2ObjectKey,
      file_size_bytes: typeof file_size === "number" && file_size > 0 ? file_size : null,
      home_team_id: isAdmin ? home_team_id : null,
      away_team_id: isAdmin ? away_team_id : null,
      match_date: resolvedMatchDate,
    };

    let { data: match, error: insertError } = await supabase
      .from("matches")
      .insert([insertPayload])
      .select()
      .single();

    if (insertError && /r2_object_key|file_size_bytes/i.test(insertError.message ?? "")) {
      console.warn("matches insert retry without R2 metadata columns", insertError.message);
      ({ data: match, error: insertError } = await supabase
        .from("matches")
        .insert([
          {
            video_url: insertPayload.video_url,
            home_team_id: insertPayload.home_team_id,
            away_team_id: insertPayload.away_team_id,
            match_date: insertPayload.match_date,
          },
        ])
        .select()
        .single());
    }

    if (insertError || !match) {
      console.error("match insert error", insertError);
      return NextResponse.json(
        { error: insertError?.message ?? "Failed to create match" },
        { status: 500 }
      );
    }

    await safeUpdateMatchStatus(match.id, {
      analysis_status: "queued",
      analysis_started_at: new Date().toISOString(),
      analysis_completed_at: null,
      analysis_error: null,
    });

    let modalResponseBody = "";
    let homeTeamColor = "#E11D48";
    let awayTeamColor = "#2563EB";

    if (isAdmin && home_team_id && away_team_id) {
      const [{ data: homeTeam }, { data: awayTeam }] = await Promise.all([
        supabase.from("teams").select("*").eq("id", home_team_id).maybeSingle(),
        supabase.from("teams").select("*").eq("id", away_team_id).maybeSingle(),
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
      console.log("Modal trigger response", {
        status: modalResponse.status,
        body: modalResponseBody,
      });

      if (!modalResponse.ok) {
        await supabase.from("matches").delete().eq("id", match.id);

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
    } catch (workerError) {
      console.error("Modal worker trigger failed", workerError);
      await supabase.from("matches").delete().eq("id", match.id);
      return NextResponse.json(
        { error: "Unable to reach Modal worker. Please try again." },
        { status: 502 }
      );
    }

    await safeUpdateMatchStatus(match.id, {
      analysis_status: "processing",
      analysis_started_at: new Date().toISOString(),
      analysis_completed_at: null,
      analysis_error: null,
    });

    return NextResponse.json({ match, message: "analysis started" });
  } catch (error) {
    console.error("analysis POST error", error);
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}
