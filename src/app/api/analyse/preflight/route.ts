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

function cleanEnvValue(value: string): string {
  return value.trim().replace(/^['\"]+|['\"]+$/g, "").trim();
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
      return NextResponse.json({ error: "Unable to verify user role." }, { status: 500 });
    }

    if (profile?.role !== "admin") {
      return NextResponse.json(
        { error: "Only administrators can run analysis preflight checks." },
        { status: 403 }
      );
    }

    if (!modalApiUrl || !modalApiKey) {
      return NextResponse.json(
        { error: "Worker not configured (Modal API key/url missing)" },
        { status: 500 }
      );
    }

    const safeSupabaseUrl = supabaseUrl ?? "";
    const safeSupabaseServiceRoleKey = supabaseServiceRoleKey ?? "";

    const body = await request.json();
    const objectKey = typeof body?.object_key === "string" ? body.object_key.trim() : "";
    const directVideoUrl = typeof body?.video_url === "string" ? body.video_url.trim() : "";

    let videoSourceUrl = "";
    if (objectKey) {
      const command = new GetObjectCommand({
        Bucket: getR2Bucket(),
        Key: objectKey,
      });
      videoSourceUrl = await getSignedUrl(getR2Client(), command, { expiresIn: 900 });
    } else if (directVideoUrl && isDirectVideoUrl(directVideoUrl)) {
      videoSourceUrl = directVideoUrl;
    }

    if (!videoSourceUrl) {
      return NextResponse.json(
        { error: "A valid object_key or direct video_url is required for preflight." },
        { status: 400 }
      );
    }

    let modalPayload: {
      preflight_only?: boolean;
      preflight_passed?: boolean;
      sampled_frames?: number;
      frames_with_people?: number;
      avg_person_detections?: number;
      warning?: string | null;
      message?: string;
      detail?: string;
      error?: string;
    } = {};

    const modalResponse = await fetch(modalApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        video_url: videoSourceUrl,
        youtube_url: videoSourceUrl,
        match_id: "preflight-only",
        worker_auth: modalApiKey,
        preflight_only: true,
        supabase_url: cleanEnvValue(safeSupabaseUrl),
        supabase_service_role_key: cleanEnvValue(safeSupabaseServiceRoleKey),
      }),
    });

    const raw = await modalResponse.text();
    if (raw) {
      try {
        modalPayload = JSON.parse(raw);
      } catch {
        modalPayload = { message: raw.slice(0, 500) };
      }
    }

    if (!modalResponse.ok) {
      const detail =
        modalPayload.detail ??
        modalPayload.error ??
        modalPayload.message ??
        `Preflight worker failed with status ${modalResponse.status}.`;
      return NextResponse.json({ error: detail }, { status: 502 });
    }

    return NextResponse.json({
      preflight_passed: modalPayload.preflight_passed === true,
      sampled_frames: modalPayload.sampled_frames ?? 0,
      frames_with_people: modalPayload.frames_with_people ?? 0,
      avg_person_detections: modalPayload.avg_person_detections ?? 0,
      warning: modalPayload.warning ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unexpected preflight error.",
      },
      { status: 500 }
    );
  }
}
