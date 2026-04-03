export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

const STORAGE_QUOTA_BYTES = 9 * 1024 * 1024 * 1024; // 9 GB

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json({ error: "Invalid session." }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    const { data: rows, error: queryError } = await supabase
      .from("matches")
      .select("file_size_bytes")
      .not("r2_object_key", "is", null);

    if (queryError) {
      console.error("storage-usage query error", queryError);
      return NextResponse.json({ error: "Failed to calculate storage usage." }, { status: 500 });
    }

    const usedBytes = (rows ?? []).reduce(
      (sum, row) => sum + (row.file_size_bytes ?? 0),
      0
    );

    return NextResponse.json({
      used_bytes: usedBytes,
      quota_bytes: STORAGE_QUOTA_BYTES,
      quota_exceeded: usedBytes >= STORAGE_QUOTA_BYTES,
    });
  } catch (error) {
    console.error("storage-usage error", error);
    return NextResponse.json({ error: "Unexpected server error." }, { status: 500 });
  }
}
