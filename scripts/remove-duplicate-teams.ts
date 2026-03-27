import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const envPath = path.join(process.cwd(), ".env.local");
const envContent = fs.readFileSync(envPath, "utf-8");
envContent.split("\n").forEach((line) => {
  if (!line || line.startsWith("#")) return;
  const [key, ...rest] = line.split("=");
  if (key) {
    const value = rest.join("=").trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function cleanupDuplicates() {
  console.log("🔍 scanning teams for duplicates...");

  const { data: teams, error } = await supabase
    .from("teams")
    .select("id, name, primary_colour");

  if (error) {
    console.error("Error fetching teams:", error);
    process.exit(1);
  }

  if (!teams || teams.length === 0) {
    console.log("No teams found.");
    return;
  }

  const normalize = (name: string) => name.trim().toLowerCase();
  const map = new Map<string, Array<{ id: string; primary_colour: string | null }>>();

  teams.forEach((team: any) => {
    const key = normalize(team.name);
    const group = map.get(key) ?? [];
    group.push({ id: team.id, primary_colour: team.primary_colour });
    map.set(key, group);
  });

  const toDelete: string[] = [];

  map.forEach((group) => {
    if (group.length <= 1) return;

    const nonNull = group.filter((t) => t.primary_colour !== null && t.primary_colour !== "");
    const nulls = group.filter((t) => t.primary_colour === null || t.primary_colour === "");

    if (nonNull.length > 0) {
      // remove all null duplicates, keep record(s) with colours
      nulls.forEach((t) => toDelete.push(t.id));
    } else {
      // if all null, keep one and remove the rest
      nulls.slice(1).forEach((t) => toDelete.push(t.id));
    }
  });

  if (toDelete.length === 0) {
    console.log("No duplicate teams with null primary_colour found.");
    return;
  }

  console.log(`Deleting ${toDelete.length} duplicate team(s) with null primary_colour...`);

  const { error: deleteError } = await supabase
    .from("teams")
    .delete()
    .in("id", toDelete);

  if (deleteError) {
    console.error("Error deleting teams:", deleteError);
    process.exit(1);
  }

  console.log("✅ Cleanup complete.");
}

cleanupDuplicates();