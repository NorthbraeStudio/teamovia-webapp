export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getR2Bucket, getR2Client } from "@/lib/r2";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function GET(request: NextRequest) {
  try {
    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return NextResponse.json({ error: "Supabase server configuration missing." }, { status: 500 });
    }

    const authHeader = request.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json({ error: "Invalid session." }, { status: 401 });
    }

    const matchId = (request.nextUrl.searchParams.get("match_id") ?? "").trim();
    if (!matchId || !isValidUuid(matchId)) {
      return NextResponse.json({ error: "A valid match_id query parameter is required." }, { status: 400 });
    }

    const { data: match, error: matchError } = await supabase
      .from("matches")
      .select("id, video_url, r2_object_key")
      .eq("id", matchId)
      .maybeSingle();

    if (matchError || !match) {
      return NextResponse.json({ error: "Match not found." }, { status: 404 });
    }

    const r2Key =
      typeof match.r2_object_key === "string" && match.r2_object_key.trim().length > 0
        ? match.r2_object_key.trim()
        : typeof match.video_url === "string" && match.video_url.startsWith("r2://")
        ? match.video_url.replace(/^r2:\/\//, "").trim()
        : "";

    if (r2Key) {
      const command = new GetObjectCommand({
        Bucket: getR2Bucket(),
        Key: r2Key,
      });
      const playbackUrl = await getSignedUrl(getR2Client(), command, { expiresIn: 3600 });
      return NextResponse.json({ playback_url: playbackUrl, source: "r2" });
    }

    if (typeof match.video_url === "string" && match.video_url.trim().length > 0) {
      return NextResponse.json({ playback_url: match.video_url.trim(), source: "direct" });
    }

    return NextResponse.json({ error: "No playable video source found for this match." }, { status: 404 });
  } catch (error) {
    console.error("video-url GET error", error);
    return NextResponse.json({ error: "Unexpected server error." }, { status: 500 });
  }
}
