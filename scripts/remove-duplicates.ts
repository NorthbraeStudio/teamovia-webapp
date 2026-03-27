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

async function removeDuplicates() {
  console.log("🔍 Finding duplicate teams...");

  try {
    // Get all teams
    const { data: allTeams, error: fetchError } = await supabase
      .from("teams")
      .select("id, name, primary_colour");

    if (fetchError) {
      console.error("❌ Error fetching teams:", fetchError);
      process.exit(1);
    }

    if (!allTeams || allTeams.length === 0) {
      console.log("No teams found.");
      return;
    }

    // Group teams by name
    const teamsByName: { [key: string]: any[] } = {};
    allTeams.forEach((team: any) => {
      if (!teamsByName[team.name]) {
        teamsByName[team.name] = [];
      }
      teamsByName[team.name].push(team);
    });

    // Find duplicates and determine which to delete
    const toDelete: string[] = [];
    let duplicateCount = 0;

    Object.entries(teamsByName).forEach(([name, teams]) => {
      if (teams.length > 1) {
        console.log(`\n📌 Found ${teams.length} duplicate(s) of "${name}"`);
        
        // Separate by colour
        const withColour = teams.filter((t: any) => t.primary_colour);
        const withoutColour = teams.filter((t: any) => !t.primary_colour);

        // If there are teams with colour, remove the ones without
        if (withColour.length > 0 && withoutColour.length > 0) {
          withoutColour.forEach((t: any) => {
            console.log(`  ➖ Removing "${name}" (ID: ${t.id}) - has NULL primary_colour`);
            toDelete.push(t.id);
            duplicateCount++;
          });
        } else {
          // All have colour or all have NULL - keep first, remove rest
          teams.slice(1).forEach((t: any) => {
            console.log(`  ➖ Removing duplicate "${name}" (ID: ${t.id})`);
            toDelete.push(t.id);
            duplicateCount++;
          });
        }
      }
    });

    if (toDelete.length === 0) {
      console.log("\n✅ No duplicates found!");
      return;
    }

    // Delete the duplicate teams
    const { error: deleteError } = await supabase
      .from("teams")
      .delete()
      .in("id", toDelete);

    if (deleteError) {
      console.error("❌ Error deleting duplicates:", deleteError);
      process.exit(1);
    }

    console.log(`\n✅ Successfully removed ${duplicateCount} duplicate team(s)!`);
  } catch (err) {
    console.error("❌ Unexpected error:", err);
    process.exit(1);
  }
}

removeDuplicates();
