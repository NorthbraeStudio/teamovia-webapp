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

const SCOTTISH_PREMIERSHIP_TEAMS = [
  { name: "Celtic", logo_url: "https://crests.football-data.org/66.svg", primary_colour: "#98C200" },
  { name: "Rangers", logo_url: "https://crests.football-data.org/76.svg", primary_colour: "#0055B8" },
  { name: "Aberdeen", logo_url: "https://crests.football-data.org/3.svg", primary_colour: "#CC0000" },
  { name: "Hearts", logo_url: "https://crests.football-data.org/25.svg", primary_colour: "#E91E3C" },
  { name: "Hibernian", logo_url: "https://crests.football-data.org/29.svg", primary_colour: "#F7A600" },
  { name: "St Johnstone", logo_url: "https://crests.football-data.org/40.svg", primary_colour: "#1B6CA8" },
  { name: "Kilmarnock", logo_url: "https://crests.football-data.org/34.svg", primary_colour: "#0066CC" },
  { name: "Ross County", logo_url: "https://crests.football-data.org/80.svg", primary_colour: "#003D7A" },
  { name: "Motherwell", logo_url: "https://crests.football-data.org/38.svg", primary_colour: "#E20011" },
  { name: "Dundee United", logo_url: "https://crests.football-data.org/30.svg", primary_colour: "#FF6600" },
  { name: "St Mirren", logo_url: "https://crests.football-data.org/39.svg", primary_colour: "#000000" },
  { name: "Dundee", logo_url: "https://crests.football-data.org/17.svg", primary_colour: "#003366" },
];

async function seedTeams() {
  console.log("🌱 Seeding Scottish Premiership teams...");

  try {
    // Delete existing teams (optional - for clean slate)
    const { error: deleteError } = await supabase
      .from("teams")
      .delete()
      .gte("id", ""); // Delete all records

    if (deleteError) {
      console.warn("⚠️  Warning clearing teams:", deleteError.message);
    }

    // Insert teams
    const { data, error } = await supabase
      .from("teams")
      .insert(SCOTTISH_PREMIERSHIP_TEAMS)
      .select();

    if (error) {
      console.error("❌ Error seeding teams:", error);
      process.exit(1);
    }

    console.log(`✅ Successfully seeded ${data?.length || 0} teams!`);
    console.log("Teams:");
    data?.forEach((team) => console.log(`  - ${team.name} (${team.primary_colour})`));
  } catch (err) {
    console.error("❌ Unexpected error:", err);
    process.exit(1);
  }
}

seedTeams();
