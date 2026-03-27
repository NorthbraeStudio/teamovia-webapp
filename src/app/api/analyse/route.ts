import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const modalApiUrl = process.env.MODAL_API_URL;
const modalApiKey = process.env.MODAL_API_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Supabase environment variables are required");
}

if (!modalApiUrl || !modalApiKey) {
  console.warn("Modal API URL or key is missing; worker trigger may fail");
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { youtube_url, home_team_id, away_team_id, league, date } = body;

    if (!youtube_url || !home_team_id || !away_team_id) {
      return NextResponse.json({ error: "youtube_url, home_team_id and away_team_id are required" }, { status: 400 });
    }

    const { data: match, error: insertError } = await supabase
      .from("matches")
      .insert([
        {
          title: body.title ?? "Untitled Match",
          league: league ?? "Friendly",
          date: date ?? new Date().toISOString(),
          video_url: youtube_url,
          home_team_id,
          away_team_id,
          status: "processing",
        },
      ])
      .select()
      .single();

    if (insertError || !match) {
      console.error("match insert error", insertError);
      return NextResponse.json({ error: "Failed to create match" }, { status: 500 });
    }

    if (modalApiUrl && modalApiKey) {
      try {
        await fetch(modalApiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${modalApiKey}`,
          },
          body: JSON.stringify({
            orchestration: "default",
            parameters: {
              youtube_url,
              match_id: match.id,
            },
          }),
        });
      } catch (workerError) {
        console.error("Modal worker trigger failed", workerError);
      }
    }

    return NextResponse.json({ match, message: "analysis started" });
  } catch (error) {
    console.error("analysis POST error", error);
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}
