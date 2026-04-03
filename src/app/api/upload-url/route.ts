export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import { getR2Client, getR2Bucket } from "@/lib/r2";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ALLOWED_CONTENT_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/x-m4v",
  "video/webm",
]);

const MAX_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB

export async function POST(request: NextRequest) {
  try {
    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return NextResponse.json(
        { error: "Supabase server configuration missing (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)." },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

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

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("upload-url profile lookup error", profileError);
      return NextResponse.json({ error: "Unable to verify user role." }, { status: 500 });
    }

    if (profile?.role !== "admin") {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 });
    }

    const body = await request.json();
    const { filename, content_type, file_size } = body;

    if (!filename || typeof filename !== "string" || filename.trim().length === 0) {
      return NextResponse.json({ error: "filename is required." }, { status: 400 });
    }

    if (!ALLOWED_CONTENT_TYPES.has(content_type)) {
      return NextResponse.json(
        { error: "Only mp4, mov, m4v and webm video files are accepted." },
        { status: 400 }
      );
    }

    if (typeof file_size !== "number" || file_size <= 0 || file_size > MAX_BYTES) {
      return NextResponse.json(
        { error: "File size must be between 1 byte and 4 GB." },
        { status: 400 }
      );
    }

    // Enforce 9 GB storage quota
    const STORAGE_QUOTA_BYTES = 9 * 1024 * 1024 * 1024;
    const { data: usageRows, error: usageError } = await supabase
      .from("matches")
      .select("file_size_bytes")
      .not("r2_object_key", "is", null);

    if (usageError) {
      // Backward-compatible path for schemas that do not yet include R2 quota columns.
      console.warn("upload-url storage usage query skipped", usageError);
    } else {
      const usedBytes = (usageRows ?? []).reduce(
        (sum: number, row: { file_size_bytes: number | null }) => sum + (row.file_size_bytes ?? 0),
        0
      );
      if (usedBytes + file_size > STORAGE_QUOTA_BYTES) {
        return NextResponse.json(
          { error: "Storage limit reached (9 GB). Please remove existing videos before uploading." },
          { status: 507 }
        );
      }
    }

    // Sanitise filename to prevent path traversal
    const safeName = filename
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/_{2,}/g, "_")
      .replace(/^_+|_+$/g, "");
    const objectKey = `videos/${randomUUID()}/${safeName}`;

    let uploadUrl = "";
    try {
      const command = new PutObjectCommand({
        Bucket: getR2Bucket(),
        Key: objectKey,
        ContentType: content_type,
        ContentLength: file_size,
      });

      uploadUrl = await getSignedUrl(getR2Client(), command, { expiresIn: 300 });
    } catch (signError) {
      console.error("upload-url signing error", signError);
      const details = signError instanceof Error ? signError.message : "unknown R2 signing error";
      return NextResponse.json(
        { error: `Failed to generate upload URL: ${details}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ upload_url: uploadUrl, object_key: objectKey });
  } catch (error) {
    console.error("upload-url error", error);
    const details = error instanceof Error ? error.message : "unexpected error";
    return NextResponse.json(
      { error: `Failed to generate upload URL: ${details}` },
      { status: 500 }
    );
  }
}
