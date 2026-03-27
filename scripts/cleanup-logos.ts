import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// Load .env.local
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
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function cleanupLogos() {
  console.log("🗑️  Removing all team logos...");

  try {
    // First get all team IDs, then update each one
    const { data: teams, error: fetchError } = await supabase
      .from("teams")
      .select("id");

    if (fetchError) {
      console.error("❌ Error fetching teams:", fetchError);
      process.exit(1);
    }

    if (!teams || teams.length === 0) {
      console.log("No teams found.");
      return;
    }

    const { error } = await supabase
      .from("teams")
      .update({ logo_url: null })
      .in("id", teams.map((t: any) => t.id));

    if (error) {
      console.error("❌ Error removing logos:", error);
      process.exit(1);
    }

    console.log(`✅ Successfully removed logos from ${teams.length} teams!`);
  } catch (err) {
    console.error("❌ Unexpected error:", err);
    process.exit(1);
  }
}

cleanupLogos();
