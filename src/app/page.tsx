"use client";

import { useState, useEffect } from "react";
import AuthGuard from "@/lib/AuthGuard";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Image from "next/image";
import Link from "next/link";
import TopNavBar from "../lib/TopNavBar";
import SideNavBar from "../lib/SideNavBar";

interface Team {
  id: string;
  name: string;
  logo_url?: string;
  primary_colour?: string;
}

export default function Home() {
  const router = useRouter();
  const [availableTeams, setAvailableTeams] = useState<Team[]>([]);
  const [selectedHomeTeam, setSelectedHomeTeam] = useState("");
  const [selectedAwayTeam, setSelectedAwayTeam] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "success" | "error">("idle");

  useEffect(() => {
    const loadTeams = async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name, logo_url, primary_colour")
        .order("name", { ascending: true });

      if (data) {
        setAvailableTeams(data);
      } else if (error) {
        console.error("Failed to load teams", error);
      }
    };

    loadTeams();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    // Redirect the user back to the login page after signing out
    router.push("/login");
  };

  const handleAnalysisSubmit = async () => {
    if (!youtubeUrl.trim()) {
      setSubmitStatus("error");
      return;
    }

    setIsSubmitting(true);
    setSubmitStatus("idle");

    try {
      const homeTeamName = selectedHomeTeam ? availableTeams.find((t) => t.id === selectedHomeTeam)?.name : null;
      const awayTeamName = selectedAwayTeam ? availableTeams.find((t) => t.id === selectedAwayTeam)?.name : null;

      const payload: any = {
        youtube_url: youtubeUrl,
        league: "Tactical Analysis",
        date: new Date().toISOString(),
      };

      if (selectedHomeTeam) payload.home_team_id = selectedHomeTeam;
      if (selectedAwayTeam) payload.away_team_id = selectedAwayTeam;
      if (homeTeamName && awayTeamName) {
        payload.title = `${homeTeamName} vs ${awayTeamName}`;
      } else if (homeTeamName) {
        payload.title = homeTeamName;
      }

      const res = await fetch("/api/analyse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (res.ok && data.match?.id) {
        setSubmitStatus("success");
        setYoutubeUrl("");
        setTimeout(() => {
          router.push(`/analysis?id=${data.match.id}`);
        }, 1000);
      } else {
        setSubmitStatus("error");
      }
    } catch (error) {
      console.error("Analysis submission error:", error);
      setSubmitStatus("error");
    } finally {
      setIsSubmitting(false);
    }
  };



  return (
    <AuthGuard>
      <>
        <style>{`
          .match-selection-bg {
              background: radial-gradient(circle at 50% -20%, #1f1b3d 0%, #0e0c20 60%, #000000 100%);
              min-height: 100vh;
              color: #e7e2ff;
          }
          .glass-card {
              background: rgba(37, 33, 71, 0.4);
              backdrop-filter: blur(20px);
              border: 1px solid rgba(71, 67, 108, 0.2);
              box-shadow: inset 0 1px 1px rgba(231, 226, 255, 0.05);
          }
        `}</style>
        <div className="match-selection-bg font-body selection:bg-primary selection:text-on-primary-container relative">
          {/* Background Decorative Image */}
          <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none opacity-20">
            <Image
              alt="Background atmosphere"
              src="/vecteezy_close-up-of-many-soccer-players-kicking-a-football-on-a_27829023.webp"
              fill
              className="object-cover"
              priority
            />
          </div>

          <TopNavBar searchValue="" onSearchChange={() => {}} />
          <SideNavBar onLogout={handleLogout} currentPage="dashboard" />

          <main className="lg:ml-64 pt-20 pb-12 px-6 max-w-7xl mx-auto space-y-12 relative z-10">
            {/* Analyse New Match Section */}
            <section className="relative">
              <div className="absolute -top-24 -left-24 w-96 h-96 bg-primary/10 blur-[120px] rounded-full pointer-events-none"></div>
              <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-secondary/10 blur-[120px] rounded-full pointer-events-none"></div>
              <div className="glass-card p-8 md:p-12 rounded-xl relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-8 opacity-10">
                  <span
                    className="material-symbols-outlined text-8xl"
                    style={{ fontVariationSettings: "'FILL' 1" }}
                  >
                    sports_soccer
                  </span>
                </div>
                <div className="max-w-2xl space-y-6 relative z-10">
                  <div>
                    <h1 className="text-4xl md:text-5xl font-black tracking-tight text-on-surface mb-2">
                      Analyse New Match
                    </h1>
                    <p className="text-on-surface-variant text-lg">
                      Input a YouTube URL to initialise elite-level tactical SynIQ
                      analysis.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    <div>
                      <label className="block text-sm font-bold text-on-surface mb-2">Home Team</label>
                      <select
                        value={selectedHomeTeam}
                        onChange={(e) => setSelectedHomeTeam(e.target.value)}
                        disabled={isSubmitting}
                        className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-lg py-2 px-3 text-on-surface focus:ring-2 focus:ring-primary/50 transition-all disabled:opacity-50"
                      >
                        <option value="">Select home team</option>
                        {availableTeams.map((team) => (
                          <option key={team.id} value={team.id}>
                            {team.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-on-surface mb-2">Away Team</label>
                      <select
                        value={selectedAwayTeam}
                        onChange={(e) => setSelectedAwayTeam(e.target.value)}
                        disabled={isSubmitting}
                        className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-lg py-2 px-3 text-on-surface focus:ring-2 focus:ring-primary/50 transition-all disabled:opacity-50"
                      >
                        <option value="">Select away team</option>
                        {availableTeams.map((team) => (
                          <option key={team.id} value={team.id}>
                            {team.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex flex-col md:flex-row gap-4">
                    <div className="flex-grow relative">
                      <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant">
                        link
                      </span>
                      <input
                        className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-full py-4 pl-12 pr-6 focus:ring-2 focus:ring-primary/50 text-on-surface transition-all placeholder:text-on-surface-variant/50 disabled:opacity-50"
                        placeholder="https://www.youtube.com/watch?v=..."
                        type="text"
                        value={youtubeUrl}
                        onChange={(e) => setYoutubeUrl(e.target.value)}
                        disabled={isSubmitting}
                      />
                    </div>
                    <button
                      onClick={handleAnalysisSubmit}
                      disabled={isSubmitting}
                      className="bg-gradient-to-r from-primary to-primary-container text-on-primary-container font-bold px-8 py-4 rounded-full flex items-center justify-center gap-2 hover:shadow-[0_0_30px_rgba(255,112,110,0.4)] transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSubmitting ? "Submitting..." : "Submit for Analysis"}
                      <span className="material-symbols-outlined text-xl">
                        {isSubmitting ? "hourglass_empty" : "rocket_launch"}
                      </span>
                    </button>
                  </div>
                  <div className="flex items-center gap-4 text-xs font-bold tracking-widest uppercase text-on-surface-variant/60">
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm">
                        check_circle
                      </span>{" "}
                      Analysis
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm">
                        check_circle
                      </span>{" "}
                      Player Tracking
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm">
                        check_circle
                      </span>{" "}
                      Heatmap Gen
                    </span>
                  </div>
                  {submitStatus === "success" && (
                    <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400 text-sm font-medium">
                      ✓ Analysis started! Redirecting...
                    </div>
                  )}
                  {submitStatus === "error" && (
                    <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm font-medium">
                      ✗ Please enter a valid YouTube URL.
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* Empty State - Ready for First Analysis */}
            <section className="space-y-6">
              <div className="flex justify-between items-end px-2">
                <div>
                  <h2 className="text-2xl font-bold text-on-surface">
                    Analysis Library
                  </h2>
                  <p className="text-on-surface-variant text-sm">
                    Your tactical insights will appear here
                  </p>
                </div>
              </div>
              <div className="glass-card p-12 md:p-16 rounded-xl text-center">
                <div className="space-y-4 max-w-lg mx-auto">
                  <div className="flex justify-center mb-6">
                    <span
                      className="material-symbols-outlined text-6xl text-primary/60"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      auto_awesome
                    </span>
                  </div>
                  <h3 className="text-2xl font-bold text-on-surface">
                    Ready for your first analysis?
                  </h3>
                  <p className="text-on-surface-variant text-lg leading-relaxed">
                    Upload a match video above to unlock elite-level tactical insights, player tracking, and performance metrics. Your analysis will appear here once complete.
                  </p>
                  <div className="pt-4">
                    <p className="text-sm text-on-surface-variant/70 font-medium">
                      ✨ Powered by AI-driven YOLO11 player tracking and SynIQ analysis
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* Stats Overview Footer */}
            <footer className="pt-8 border-t border-outline-variant/10 flex flex-col md:flex-row justify-between items-center gap-6">
              <div className="flex items-center gap-8">
                <div>
                  <span className="block text-xs font-bold text-on-surface-variant/60 uppercase tracking-widest mb-1">
                    Analyses Completed
                  </span>
                  <span className="text-2xl font-black text-on-surface">
                    0 <small className="text-xs font-normal text-primary">Matches</small>
                  </span>
                </div>
                <div>
                  <span className="block text-xs font-bold text-on-surface-variant/60 uppercase tracking-widest mb-1">
                    Events Generated
                  </span>
                  <span className="text-2xl font-black text-on-surface">
                    0 <small className="text-xs font-normal text-secondary">Events</small>
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <button className="flex items-center gap-2 text-sm font-semibold text-on-surface-variant hover:text-on-surface transition-colors">
                  <span className="material-symbols-outlined">contact_support</span>
                  Support
                </button>
                <div className="h-4 w-px bg-outline-variant/30"></div>
                <p className="text-xs text-on-surface-variant/40">
                  © 2026 Teamovia AI LTD. Elite Tactical Analysis. UK-V1.0.0-Beta
                </p>
              </div>
            </footer>
          </main>
        </div>
      </>
    </AuthGuard>
  );
}