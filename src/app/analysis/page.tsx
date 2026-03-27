"use client";

import AuthGuard from "@/lib/AuthGuard";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import TopNavBar from "../../lib/TopNavBar";
import SideNavBar from "../../lib/SideNavBar";


type TacticalEvent = {
  id: string;
  match_id: string;
  timestamp_seconds: number;
  player_actor: string;
  x_coord: number;
  y_coord: number;
  insight_text: string;
  tas_score: number;
  event_type: string;
};

type SeasonalTrend = {
  match_date: string;
  avg_tas: number;
  avg_syniq: number;
};

type TeamInfo = {
  id: string;
  name: string;
};

type MatchRow = {
  id: string;
  title: string;
  date: string;
  league?: string;
  video_url: string;
  home_team_id: string;
  away_team_id: string;
  tas?: number;
  synIq?: number;
};

async function fetchLatestTeamId(): Promise<string | null> {
  const { data, error } = await supabase
    .from("teams")
    .select("id")
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();

  if (error) {
    console.error("fetchLatestTeamId", error);
    return null;
  }
  return data?.id ?? null;
}

async function fetchMatchesForTeam(teamId: string): Promise<MatchRow[]> {
  const { data, error } = await supabase
    .from("matches")
    .select("*")
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .order("date", { ascending: false });

  if (error) {
    console.error("fetchMatchesForTeam", error);
    return [];
  }
  return data || [];
}

async function fetchTacticalEvents(matchId: string): Promise<TacticalEvent[]> {
  const { data, error } = await supabase
    .from("tactical_events")
    .select("*")
    .eq("match_id", matchId)
    .order("timestamp_seconds", { ascending: true });

  if (error) {
    console.error("fetchTacticalEvents", error);
    return [];
  }
  return data || [];
}

async function fetchSeasonalTrends(teamId: string): Promise<SeasonalTrend[]> {
  const { data, error } = await supabase
    .from("seasonal_trends")
    .select("*")
    .eq("team_id", teamId)
    .order("match_date", { ascending: true });

  if (error) {
    console.error("fetchSeasonalTrends", error);
    return [];
  }
  return data || [];
}

async function fetchTeams(): Promise<TeamInfo[]> {
  const { data, error } = await supabase.from("teams").select("id, name").order("name", { ascending: true });
  if (error) {
    console.error("fetchTeams", error);
    return [];
  }
  return data ?? [];
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function fetchMatchById(matchId: string): Promise<MatchRow | null> {
  if (!isValidUuid(matchId)) {
    console.warn("fetchMatchById: invalid UUID provided", matchId);
    return null;
  }

  const { data, error } = await supabase
    .from("matches")
    .select("*")
    .eq("id", matchId)
    .maybeSingle();

  if (error) {
    console.error("fetchMatchById", JSON.stringify(error));
    return null;
  }

  if (!data) {
    console.warn("fetchMatchById: no match found for id", matchId);
    return null;
  }

  return data;
}

function SeasonalProgressChart({ data }: { data: SeasonalTrend[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="glass-panel bg-white/10 backdrop-blur-md border border-white/10 p-4 text-[#e7e2ff]/80">
        <p className="text-sm">No seasonal data available yet.</p>
      </div>
    );
  }

  const chartData = data.map((row) => ({
    date: new Date(row.match_date).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    }),
    TAS: Number(row.avg_tas),
    SynIQ: Number(row.avg_syniq),
  }));

  return (
    <div className="glass-panel bg-white/10 backdrop-blur-md border border-white/10 p-4">
      <h3 className="font-headline text-white text-lg mb-3">Performance Insights</h3>
      <div className="h-72">
        <svg className="w-full h-full text-white">
          {/** Simplified fallback chart if recharts isn't available; using basic lines to avoid import requirements */}
          <text x="10" y="20" fill="white">Chart placeholder for {chartData.length} points</text>
        </svg>
      </div>
    </div>
  );
}

function DynamicPitchVisualiser({
  players,
  eventTitle,
  matchTAS,
  onWatchVideo,
}: {
  players: TacticalEvent[];
  eventTitle: string;
  matchTAS: number;
  onWatchVideo: () => void;
}) {
  return (
    <div className="glass-panel rounded-xl bg-white/10 backdrop-blur-md border border-white/10 p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl text-white font-black uppercase">{eventTitle}</h2>
        <span className="text-xs text-[#e7e2ff] bg-[#ffffff1a] px-2 py-1 rounded">TAS {matchTAS.toFixed(1)}</span>
      </div>
      <div className="border border-white/10 rounded-lg overflow-hidden mb-4">
        <svg viewBox="0 0 100 68" className="w-full h-72">
          <rect width="100" height="68" fill="rgba(31, 41, 55, 0.32)" />
          <line x1="50" y1="0" x2="50" y2="68" stroke="rgba(255,255,255,0.2)" strokeWidth="0.3" />
          {players.map((p) => (
            <g key={p.id}>
              <circle cx={p.x_coord} cy={p.y_coord} r="2.5" fill="#ff706e" stroke="#ffffff" strokeWidth="0.2" />
              <text x={p.x_coord} y={p.y_coord - 3} fontSize="2.5" fill="#ffffff" textAnchor="middle">
                {p.player_actor.split(" ").map((name) => name[0]).join("")}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <button
        onClick={onWatchVideo}
        className="px-4 py-2 bg-[#ff706e] text-[#0e0c20] font-black text-xs tracking-widest uppercase rounded-full hover:opacity-90"
      >
        Watch Video Evidence
      </button>
    </div>
  );
}

export default function AnalysisDashboard() {
  const router = useRouter();
  const [teamId, setTeamId] = useState<string | null>(null);
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [tacticalEvents, setTacticalEvents] = useState<TacticalEvent[]>([]);
  const [seasonalTrends, setSeasonalTrends] = useState<SeasonalTrend[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<MatchRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  useEffect(() => {
    const initTeams = async () => {
      const teamList = await fetchTeams();
      if (teamList && teamList.length > 0) {
        setTeams(teamList);
        if (!teamId) {
          setTeamId(teamList[0].id);
        }
      }
    };
    initTeams();
  }, [teamId]);

  useEffect(() => {
    const queryParams = new URLSearchParams(window.location.search);
    const queryMatchId = queryParams.get("id");
    if (queryMatchId && isValidUuid(queryMatchId)) {
      setSelectedMatchId(queryMatchId);
    } else if (queryMatchId) {
      console.warn("analysis page ignored invalid id query param", queryMatchId);
    }
  }, []);

  useEffect(() => {
    const loadMatches = async () => {
      if (!teamId) return;
      setLoading(true);
      try {
        const allMatches = await fetchMatchesForTeam(teamId);
        setMatches(allMatches);

        const params = new URLSearchParams(window.location.search);
        const queryMatchId = params.get("id");
        const safeMatchId = queryMatchId && isValidUuid(queryMatchId) ? queryMatchId : null;

        if (safeMatchId && allMatches.some((match) => match.id === safeMatchId)) {
          setSelectedMatchId(safeMatchId);
        } else if (allMatches.length > 0) {
          setSelectedMatchId(allMatches[0].id);
          router.replace(`/analysis?id=${allMatches[0].id}`);
        } else {
          setSelectedMatchId(null);
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    };
    loadMatches();
  }, [teamId, router]);

  useEffect(() => {
    const loadSelectedMatch = async () => {
      if (!selectedMatchId) return;
      setLoading(true);
      try {
        const match = await fetchMatchById(selectedMatchId);
        setSelectedMatch(match);
        const events = await fetchTacticalEvents(selectedMatchId);
        setTacticalEvents(events);
        if (teamId) {
          const trends = await fetchSeasonalTrends(teamId);
          setSeasonalTrends(trends);
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    };
    loadSelectedMatch();
  }, [selectedMatchId, teamId]);

  useEffect(() => {
    if (!selectedMatchId) return;

    const channel = supabase
      .channel(`tactical_events_match_${selectedMatchId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "tactical_events",
          filter: `match_id=eq.${selectedMatchId}`,
        },
        (payload) => {
          if (payload.new) {
            setTacticalEvents((prev) => [...prev, payload.new as TacticalEvent]);
          }
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("Realtime tactical_events subscription ready");
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedMatchId]);

  const selectedMatches = useMemo(() => {
    if (!matches) return [];
    return matches;
  }, [matches]);

  const finalMatch = selectedMatch || selectedMatches.find((m) => m.id === selectedMatchId) || null;

  const handleWatchVideo = () => {
    if (!finalMatch || tacticalEvents.length === 0) return;
    const firstEvent = tacticalEvents[0];
    if (!firstEvent) return;
    if (!finalMatch.video_url) return;
    const sep = finalMatch.video_url.includes("?") ? "&" : "?";
    window.open(`${finalMatch.video_url}${sep}t=${firstEvent.timestamp_seconds}s`, "_blank");
  };

  return (
    <AuthGuard>
      <>
        <style>{`
          .analysis-bg {
              font-family: 'Inter', sans-serif;
              background: radial-gradient(circle at 20% 30%, rgba(139, 92, 246, 0.15), transparent 40%),
                          radial-gradient(circle at 80% 70%, rgba(255, 112, 110, 0.1), transparent 40%),
                          linear-gradient(135deg, #1a0b2e 0%, #0e0c20 100%);
              color: #e7e2ff;
              min-height: 100vh;
          }
          .font-headline { font-family: 'Montserrat', sans-serif; }
          .glass-panel {
              background: rgba(37, 33, 71, 0.4);
              backdrop-filter: blur(24px);
              border: 1px solid rgba(231, 226, 255, 0.1);
              border-top: 1px solid rgba(255, 255, 255, 0.15);
              border-left: 1px solid rgba(255, 255, 255, 0.15);
              box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.4);
          }
          .radar-grid {
              background-image: radial-gradient(circle, rgba(139, 92, 246, 0.1) 1px, transparent 1px);
              background-size: 30px 30px;
          }
        `}</style>
        <div className="analysis-bg overflow-x-hidden">
          <TopNavBar
            hideSearch={true}
            teams={teams}
            selectedTeamId={teamId}
            tasScore={finalMatch?.tas ?? null}
            onTeamChange={(newTeamId) => {
              setTeamId(newTeamId);
              setSelectedMatchId(null);
              setMatches([]);
              setSelectedMatch(null);
              router.replace(`/analysis?id=`);
            }}
          />
          <SideNavBar onLogout={handleLogout} currentPage="analysis" />

          {/* Main Content Canvas */}
          <main className="lg:ml-64 pt-20 min-h-screen relative">
            {/* Large Scale Player Cutout */}
            <div className="fixed top-0 right-0 w-3/4 h-full pointer-events-none z-0 opacity-40 overflow-hidden">
              <img
                alt="Player Cutout"
                className="object-cover h-full w-full object-right mix-blend-screen grayscale contrast-125 brightness-75"
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuDsGZIk0KmeYlonRwYFmt7GWggifbjs6nmgkPC6jaoy5HLs_0-R_iu21Yp_0DEpyZL7nXQJAqE3U9wpsqmQNRO52QqYmAqUZLGN7brYI7yPtzJxoLxszFdZIMmyLTjLpjFtdkxbgfr76WtiSpRjtRRTqlpZhe0sQvtGlJgxQe6Y7LIipcV_HGxjG083GxXS77wDEvC4r6SU-n6O_egmkixC-q7P4f0B5KmwfvvcFtlJeeW8IArzVGewW0nJchAmo-IsxaIVCXgTSIw"
              />
            </div>

            <section className="px-8 py-6 relative z-10 flex flex-col md:flex-row justify-between items-center gap-6">
              <div className="glass-panel rounded-full px-8 py-3">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-[10px] uppercase tracking-widest text-[#e7e2ff]/40">
                    {finalMatch ? "Match analysis loaded from dashboard" : "Select a match to begin analysis"}
                  </p>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#39ff14] bg-[#39ff14]/10 rounded-full px-2 py-1">
                    Live sync
                  </span>
                </div>

                <h1 className="text-2xl md:text-3xl font-black text-white">
                  {finalMatch?.title ?? "No match selected yet"}
                </h1>

                <div className="mt-2 text-sm text-[#e7e2ff]/70 space-y-1">
                  {finalMatch ? (
                    <>
                      <p>Match: {finalMatch.home_team_id} vs {finalMatch.away_team_id}</p>
                      <p>Date: {new Date(finalMatch.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</p>
                      <p>Category: {finalMatch?.league ?? "Tactical scan"}</p>
                    </>
                  ) : (
                    <p>Pick a match on the home dashboard to stream metadata here.</p>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-4 glass-panel rounded-full px-6 py-3">
                <div className="text-right">
                  <p className="text-[9px] text-[#e7e2ff]/40 tracking-[0.2em] uppercase font-bold">Team Aptitude Score</p>
                  <p className="text-2xl font-black font-headline text-[#ff706e]">
                    {finalMatch?.tas?.toFixed(1) ?? "—"} <span className="text-[10px] text-[#e7e2ff]/40 ml-1">TAS</span>
                  </p>
                </div>
                <div className="relative w-14 h-14 flex items-center justify-center">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle className="text-[#252147]/40" cx="28" cy="28" fill="transparent" r="24" stroke="currentColor" strokeWidth="4"></circle>
                    <circle className="text-[#ff706e]" cx="28" cy="28" fill="transparent" r="24" stroke="currentColor" strokeDasharray="151" strokeDashoffset="17" strokeLinecap="round" strokeWidth="4"></circle>
                  </svg>
                  <span className="absolute material-symbols-outlined text-[#ff706e] text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>bolt</span>
                </div>
              </div>
            </section>

            <div className="px-8 grid grid-cols-12 gap-6 relative z-10 pb-12">
              {/* Main Performance Card */}
              <div className="col-span-12 lg:col-span-8 glass-panel rounded-xl p-8 min-h-[500px] flex flex-col justify-between overflow-hidden relative">
                <div className="flex justify-between items-start relative z-10">
                  <div>
                    <h2 className="text-4xl font-headline font-black tracking-tighter text-white uppercase">
                      SynIQ Index <span className="text-[#ff706e]">v2.4</span>
                    </h2>
                    <p className="text-[#e7e2ff]/60 text-xs font-medium mt-2 tracking-wide uppercase">Collective Synchronisation Analytics • Real-time Pulse</p>
                  </div>
                  <div className="flex space-x-3">
                    <span className="px-4 py-1.5 bg-[#39ff14]/10 text-[#39ff14] border border-[#39ff14]/20 rounded-full text-[9px] font-bold tracking-widest">LIVE DATA</span>
                    <span className="px-4 py-1.5 bg-[#252147]/40 text-white rounded-full text-[9px] font-bold tracking-widest">99.2% ACCURACY</span>
                  </div>
                </div>

                {/* Empty State or Data Container */}
                {tacticalEvents.length === 0 ? (
                  <div className="flex-grow flex items-center justify-center py-12 relative">
                    <div className="text-center space-y-4">
                      <span className="material-symbols-outlined text-6xl text-[#ff706e]/50" style={{ fontVariationSettings: "'FILL' 1" }}>play_circle</span>
                      <h3 className="text-2xl font-headline font-black text-white">Analysis Pending</h3>
                      <p className="text-sm text-[#e7e2ff]/60 max-w-sm">Submit a match video and we'll stream real-time tactical insights, player positions, and SynIQ metrics here.</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex-grow flex items-center justify-center py-12 radar-grid relative">
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0e0c20] via-transparent to-transparent opacity-40"></div>
                    <div className="relative w-80 h-80 rounded-full border border-[#ff706e]/10 flex items-center justify-center">
                      <div className="absolute w-64 h-64 rounded-full border border-[#ff706e]/20"></div>
                      <div className="absolute w-48 h-48 rounded-full border border-[#ff706e]/30"></div>
                    </div>
                  </div>
                )}

                <div className="flex justify-between items-end relative z-10">
                  {tacticalEvents.length > 0 && (
                    <div className="flex space-x-12">
                      <div>
                        <p className="text-[9px] text-[#e7e2ff]/40 uppercase tracking-[0.2em] font-bold">Events Tracked</p>
                        <p className="text-2xl font-headline font-black text-white">{tacticalEvents.length}</p>
                      </div>
                    </div>
                  )}
                  <button onClick={handleWatchVideo} disabled={tacticalEvents.length === 0} className="px-8 py-4 bg-[#ff706e] text-[#0e0c20] font-black text-[10px] tracking-[0.2em] uppercase rounded-full hover:shadow-[0_0_25px_rgba(255,112,110,0.5)] transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed">
                    WATCH VIDEO EVIDENCE
                  </button>
                </div>
              </div>

              {/* Individual Metric Grid - Empty State */}
              {tacticalEvents.length === 0 ? (
                <div className="col-span-12 lg:col-span-4 glass-panel p-8 rounded-xl flex flex-col items-center justify-center text-center">
                  <span className="material-symbols-outlined text-5xl text-[#ff706e]/40 mb-4" style={{ fontVariationSettings: "'FILL' 1" }}>analytics</span>
                  <h3 className="text-lg font-headline font-black text-white mb-2">Metrics Ready</h3>
                  <p className="text-sm text-[#e7e2ff]/60">Tactical metrics, cohesion stats, and safety flags will populate here once video analysis completes.</p>
                </div>
              ) : (
                <div className="col-span-12 lg:col-span-4 grid grid-cols-2 gap-4">
                  {/* Metric cards will render here when data arrives */}
                </div>
              )}

              {/* Key Moment Analysis - Empty State or Data */}
              {tacticalEvents.length === 0 ? (
                <div className="col-span-12 lg:col-span-7 glass-panel rounded-xl p-8 flex items-center justify-center">
                  <div className="text-center space-y-4">
                    <span className="material-symbols-outlined text-5xl text-[#ff706e]/40 mx-auto block" style={{ fontVariationSettings: "'FILL' 1" }}>insight</span>
                    <h3 className="text-lg font-headline font-black text-white">Key Moments Loading</h3>
                    <p className="text-sm text-[#e7e2ff]/60 max-w-md">When your analysis processes, frame-by-frame tactical insights and critical moments will be displayed here.</p>
                  </div>
                </div>
              ) : (
                <div className="col-span-12 lg:col-span-7 glass-panel rounded-xl overflow-hidden">
                  <div className="px-8 py-6 border-b border-[#47436c]/20 bg-[#252147]/20">
                    <h3 className="font-headline font-black text-white uppercase tracking-tight">Tactical Events ({tacticalEvents.length})</h3>
                  </div>
                  <div className="overflow-x-auto">
                    {/* Event list will render here */}
                  </div>
                </div>
              )}

              {/* Live Event Stream - Empty State or Data */}
              {tacticalEvents.length === 0 ? (
                <div className="col-span-12 lg:col-span-5 glass-panel rounded-xl p-8 flex items-center justify-center">
                  <div className="text-center space-y-4">
                    <span className="material-symbols-outlined text-5xl text-[#ff706e]/40 mx-auto block" style={{ fontVariationSettings: "'FILL' 1" }}>feed</span>
                    <h3 className="text-lg font-headline font-black text-white">Real-time Stream Ready</h3>
                    <p className="text-sm text-[#e7e2ff]/60 max-w-md">Live tactical events will stream here as your video processes. Watch frame-by-frame player movements in real time.</p>
                  </div>
                </div>
              ) : (
                <div className="col-span-12 lg:col-span-5 glass-panel rounded-xl flex flex-col">
                  <div className="px-8 py-6 border-b border-[#47436c]/20 bg-[#252147]/20">
                    <h3 className="font-headline font-black text-white uppercase tracking-tight">Live Event Stream ({tacticalEvents.length})</h3>
                  </div>
                  <div className="p-8 space-y-6 flex-grow overflow-y-auto">
                    {/* Events will render here */}
                  </div>
                </div>
              )}
            </div>
          </main>

          <section className="px-8 pb-8 lg:pb-16">
            <SeasonalProgressChart data={seasonalTrends} />
          </section>

          {/* Contextual FAB */}
          <button className="fixed bottom-10 right-10 w-16 h-16 bg-[#ff706e] text-[#0e0c20] rounded-full shadow-[0_0_40px_rgba(255,112,110,0.4)] flex items-center justify-center z-50 hover:scale-110 transition-transform active:scale-90">
            <span className="material-symbols-outlined text-3xl font-black">query_stats</span>
          </button>
        </div>
      </>
    </AuthGuard>
  );
}