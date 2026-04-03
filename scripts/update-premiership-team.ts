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
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const OLD_TEAM_NAMES = ["St Johnstone", "St Johston"];
const NEW_TEAM_NAME = "Falkirk";
const FALKIRK_PRIMARY_COLOUR = "#1A2B6D";

async function updatePremiershipTeams() {
  console.log("Updating relegated/promoted teams in Supabase...");

  const { data: oldTeams, error: oldTeamsError } = await supabase
    .from("teams")
    .select("id, name")
    .in("name", OLD_TEAM_NAMES);

  if (oldTeamsError) {
    console.error("Failed to fetch old team rows:", oldTeamsError);
    process.exit(1);
  }

  if (oldTeams && oldTeams.length > 0) {
    const idsToUpdate = oldTeams.map((team) => team.id);
    const { error: updateError } = await supabase
      .from("teams")
      .update({
        name: NEW_TEAM_NAME,
        primary_colour: FALKIRK_PRIMARY_COLOUR,
      })
      .in("id", idsToUpdate);

    if (updateError) {
      console.error("Failed to update St Johnstone/St Johston rows:", updateError);
      process.exit(1);
    }

    console.log(`Updated ${idsToUpdate.length} row(s) to ${NEW_TEAM_NAME}.`);
  } else {
    const { data: existingFalkirk, error: falkirkError } = await supabase
      .from("teams")
      .select("id")
      .eq("name", NEW_TEAM_NAME)
      .limit(1);

    if (falkirkError) {
      console.error("Failed to check existing Falkirk row:", falkirkError);
      process.exit(1);
    }

    if (existingFalkirk && existingFalkirk.length > 0) {
      const { error: colourError } = await supabase
        .from("teams")
        .update({ primary_colour: FALKIRK_PRIMARY_COLOUR })
        .eq("name", NEW_TEAM_NAME);

      if (colourError) {
        console.error("Failed to update Falkirk primary colour:", colourError);
        process.exit(1);
      }

      console.log("Falkirk already present. Primary colour updated.");
    } else {
      const { error: insertError } = await supabase
        .from("teams")
        .insert([{ name: NEW_TEAM_NAME, primary_colour: FALKIRK_PRIMARY_COLOUR }]);

      if (insertError) {
        console.error("Failed to insert Falkirk row:", insertError);
        process.exit(1);
      }

      console.log("Inserted Falkirk row with primary colour.");
    }
  }

  const { data: verification, error: verifyError } = await supabase
    .from("teams")
    .select("id, name, primary_colour")
    .in("name", [NEW_TEAM_NAME, ...OLD_TEAM_NAMES])
    .order("name", { ascending: true });

  if (verifyError) {
    console.error("Verification query failed:", verifyError);
    process.exit(1);
  }

  console.log("Verification rows:");
  console.table(verification ?? []);
}

updatePremiershipTeams().catch((error) => {
  console.error("Unexpected error during team update:", error);
  process.exit(1);
});
