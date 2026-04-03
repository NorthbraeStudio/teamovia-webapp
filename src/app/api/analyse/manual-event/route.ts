export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error("Supabase URL and service role key are required");
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

function stripUnsupportedColumns(items: Record<string, unknown>[], errorText: string): Record<string, unknown>[] {
  const missingColumns = [...errorText.matchAll(/Could not find the '([^']+)' column/gi)].map((match) => match[1]);
  if (missingColumns.length === 0) {
    return items;
  }

  const keysToRemove = new Set(missingColumns);
  return items.map((item) => {
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item)) {
      if (!keysToRemove.has(key)) {
        next[key] = value;
      }
    }
    return next;
  });
}

async function insertWithSchemaFallback(item: Record<string, unknown>) {
  let candidates: Record<string, unknown>[] = [item];

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { error } = await supabase.from("tactical_events").insert(candidates);
    if (!error) {
      return;
    }

    const stripped = stripUnsupportedColumns(candidates, error.message ?? "");
    if (JSON.stringify(stripped) === JSON.stringify(candidates)) {
      throw error;
    }

    candidates = stripped;
    if (candidates.length === 0) {
      return;
    }
  }

  throw new Error("Unable to insert manual goal event after schema fallback retries.");
}

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
      return NextResponse.json({ error: "Unable to verify user role." }, { status: 500 });
    }

    if (profile?.role !== "admin") {
      return NextResponse.json(
        { error: "Only administrators can mark manual goal events." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const matchId = typeof body?.match_id === "string" ? body.match_id.trim() : "";
    const teamAssignment = body?.team_assignment === "away" ? "away" : "home";
    const timestampSeconds = Number(body?.timestamp_seconds);

    if (!matchId || !isValidUuid(matchId)) {
      return NextResponse.json({ error: "A valid match_id is required." }, { status: 400 });
    }

    if (!Number.isFinite(timestampSeconds) || timestampSeconds < 0) {
      return NextResponse.json(
        { error: "timestamp_seconds must be a positive number." },
        { status: 400 }
      );
    }

    const manualGoalEvent = {
      match_id: matchId,
      timestamp_seconds: Number(timestampSeconds.toFixed(3)),
      player_actor: `${teamAssignment}_coach_marker`,
      x_coord: 0,
      y_coord: 0,
      insight_text: `Manual goal event marked for ${teamAssignment} team at ${timestampSeconds.toFixed(1)}s.`,
      tas_score: 0,
      event_type: "manual_goal_event",
      team_assignment: teamAssignment,
      unit_type: "Context",
      title: "Manual Goal Event",
    };

    try {
      await insertWithSchemaFallback(manualGoalEvent);
    } catch {
      const fallbackManualGoalEvent = {
        ...manualGoalEvent,
        event_type: "summary",
        insight_text: `[manual_goal_event] ${manualGoalEvent.insight_text}`,
      };

      try {
        await insertWithSchemaFallback(fallbackManualGoalEvent);
      } catch (fallbackError) {
        const message =
          fallbackError instanceof Error
            ? fallbackError.message
            : "Failed to save manual goal event.";
        return NextResponse.json(
          { error: message },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ success: true, match_id: matchId });
  } catch (error) {
    return NextResponse.json({ error: "Unexpected server error." }, { status: 500 });
  }
}
