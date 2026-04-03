export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error("Supabase URL and service role key are required");
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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

    if (profile?.role !== "admin") {
      return NextResponse.json(
        { error: "Only administrators can stop running analyses." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const matchId = typeof body?.match_id === "string" ? body.match_id.trim() : "";

    if (!matchId || !isValidUuid(matchId)) {
      return NextResponse.json({ error: "A valid match_id is required." }, { status: 400 });
    }

    // Remove generated events first in case FK constraints do not cascade.
    const { error: eventsDeleteError } = await supabase
      .from("tactical_events")
      .delete()
      .eq("match_id", matchId);

    if (eventsDeleteError) {
      console.error("stop analysis tactical_events delete error", eventsDeleteError);
      return NextResponse.json({ error: "Failed to stop analysis events." }, { status: 500 });
    }

    const { error: matchDeleteError } = await supabase
      .from("matches")
      .delete()
      .eq("id", matchId);

    if (matchDeleteError) {
      console.error("stop analysis match delete error", matchDeleteError);
      return NextResponse.json({ error: "Failed to stop analysis match." }, { status: 500 });
    }

    return NextResponse.json({ success: true, match_id: matchId });
  } catch (error) {
    console.error("stop analysis POST error", error);
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}
