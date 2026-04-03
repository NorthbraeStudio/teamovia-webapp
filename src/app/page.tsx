"use client";

import { useState, useEffect, useMemo, type ReactNode } from "react";
import AuthGuard from "@/lib/AuthGuard";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Image from "next/image";
import TopNavBar from "../lib/TopNavBar";
import SideNavBar from "../lib/SideNavBar";

interface Team {
  id: string;
  name: string;
  logo_url?: string;
  primary_colour?: string;
}

interface RecentMatch {
  id: string;
  title?: string;
  video_url: string;
  home_team_id: string | null;
  away_team_id: string | null;
  created_at?: string;
  match_date?: string;
  tas?: number | null;
  syniq?: number | null;
  synIq?: number | null;
  event_count?: number;
  has_summary?: boolean;
  analysis_status?: "queued" | "processing" | "completed" | "failed" | "stopped" | null;
}

type MatchRecord = {
  id: string;
  title?: string;
  video_url: string;
  home_team_id: string | null;
  away_team_id: string | null;
  created_at?: string;
  match_date?: string;
  tas?: number | null;
  syniq?: number | null;
  synIq?: number | null;
  analysis_status?: unknown;
};

type AggregateMetricRecord = {
  key?: string;
  value?: number | null;
};

type MatchAggregateRecord = {
  match_id: string;
  summary_metrics: AggregateMetricRecord[] | null;
};

function extractAggregateMetricValue(
  summaryMetrics: AggregateMetricRecord[] | null | undefined,
  metricKey: string
): number | null {
  if (!Array.isArray(summaryMetrics)) return null;
  const metric = summaryMetrics.find((item) => item?.key === metricKey);
  if (!metric || typeof metric.value !== "number" || !Number.isFinite(metric.value)) {
    return null;
  }
  return metric.value;
}

function ScoreRing({
  value,
  label,
  accentClass,
}: {
  value: number | null | undefined;
  label: string;
  accentClass: string;
}) {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const safeValue = typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
  const dashOffset = safeValue === null ? circumference : circumference * (1 - safeValue / 100);

  return (
    <div className="text-center">
      <div className="relative w-10 h-10 flex items-center justify-center">
        <svg className="absolute inset-0 w-full h-full -rotate-90" aria-hidden="true">
          <circle
            className="text-surface-container-highest"
            cx="20"
            cy="20"
            fill="none"
            r={radius}
            stroke="currentColor"
            strokeWidth="2.5"
          />
          <circle
            className={accentClass}
            cx="20"
            cy="20"
            fill="none"
            r={radius}
            stroke="currentColor"
            strokeWidth="2.5"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
          />
        </svg>
        <span className="text-[10px] font-black">{safeValue === null ? "-" : Math.round(safeValue)}</span>
      </div>
      <span className="text-[8px] uppercase font-bold text-on-surface-variant mt-1 block">{label}</span>
    </div>
  );
}

function normalizeAnalysisStatus(
  value: unknown
): "queued" | "processing" | "completed" | "failed" | "stopped" | null {
  if (
    value === "queued" ||
    value === "processing" ||
    value === "completed" ||
    value === "failed" ||
    value === "stopped"
  ) {
    return value;
  }
  return null;
}

const EXPECTED_EVENT_COUNT = 120;
const MAX_PROCESSING_MINUTES = 240;

function getMatchStartTimestamp(match: RecentMatch): number | null {
  const referenceTime = match.created_at ?? match.match_date;
  if (!referenceTime) return null;
  const timestamp = new Date(referenceTime).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function isAnalysisProcessing(match: RecentMatch): boolean {
  if (match.analysis_status === "queued" || match.analysis_status === "processing") {
    return true;
  }
  if (
    match.analysis_status === "completed" ||
    match.analysis_status === "failed" ||
    match.analysis_status === "stopped"
  ) {
    return false;
  }

  if (match.has_summary === true) {
    return false;
  }

  const createdTime = getMatchStartTimestamp(match);
  if (!createdTime) return (match.event_count ?? 0) > 0;
  const now = new Date().getTime();
  const ageMinutes = (now - createdTime) / (1000 * 60);
  return ageMinutes < MAX_PROCESSING_MINUTES;
}

function getElapsedTimeLabel(match: RecentMatch, nowMs: number): string {
  const start = getMatchStartTimestamp(match);
  if (!start) return "0:00";
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - start) / 1000));
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function getProgressPercent(match: RecentMatch, nowMs: number): number {
  void nowMs;
  const eventCount = match.event_count ?? 0;
  const eventProgress = Math.min((eventCount / EXPECTED_EVENT_COUNT) * 100, 100);
  return Math.round(eventProgress);
}

function getRelativeTimeLabel(value?: string): string {
  if (!value) return "No analyses yet";
  const now = Date.now();
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "Unknown";

  const diffSeconds = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function tokenizeSearchQuery(query: string): string[] {
  return query
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function tokenizeSearchableText(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(Boolean);
}

function boundedLevenshteinDistance(source: string, target: string, maxDistance: number): number {
  const sourceLength = source.length;
  const targetLength = target.length;
  if (Math.abs(sourceLength - targetLength) > maxDistance) {
    return maxDistance + 1;
  }

  const previousRow = new Array(targetLength + 1);
  const currentRow = new Array(targetLength + 1);

  for (let j = 0; j <= targetLength; j += 1) previousRow[j] = j;

  for (let i = 1; i <= sourceLength; i += 1) {
    currentRow[0] = i;
    let rowMin = currentRow[0];

    for (let j = 1; j <= targetLength; j += 1) {
      const substitutionCost = source[i - 1] === target[j - 1] ? 0 : 1;
      const deletion = previousRow[j] + 1;
      const insertion = currentRow[j - 1] + 1;
      const substitution = previousRow[j - 1] + substitutionCost;
      const value = Math.min(deletion, insertion, substitution);
      currentRow[j] = value;
      if (value < rowMin) rowMin = value;
    }

    if (rowMin > maxDistance) {
      return maxDistance + 1;
    }

    for (let j = 0; j <= targetLength; j += 1) {
      previousRow[j] = currentRow[j];
    }
  }

  return previousRow[targetLength];
}

function isFuzzyTokenMatch(token: string, candidateWords: string[]): boolean {
  const tokenLength = token.length;
  const allowedDistance = tokenLength >= 8 ? 2 : 1;

  return candidateWords.some((word) => {
    if (word === token) return true;
    if (word.includes(token)) return true;
    if (token.includes(word) && word.length >= 4) return true;
    return boundedLevenshteinDistance(token, word, allowedDistance) <= allowedDistance;
  });
}

function highlightSearchMatches(text: string, query: string): ReactNode {
  const tokens = tokenizeSearchQuery(query).filter((token) => token.length >= 2);
  if (tokens.length === 0) return text;

  const lowerText = text.toLowerCase();
  const ranges: Array<{ start: number; end: number }> = [];

  for (const token of tokens) {
    let fromIndex = 0;
    while (fromIndex < lowerText.length) {
      const matchStart = lowerText.indexOf(token, fromIndex);
      if (matchStart === -1) break;
      ranges.push({ start: matchStart, end: matchStart + token.length });
      fromIndex = matchStart + token.length;
    }
  }

  if (ranges.length === 0) return text;

  ranges.sort((a, b) => a.start - b.start);
  const mergedRanges: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    const last = mergedRanges[mergedRanges.length - 1];
    if (!last || range.start > last.end) {
      mergedRanges.push({ ...range });
      continue;
    }
    last.end = Math.max(last.end, range.end);
  }

  const parts: ReactNode[] = [];
  let cursor = 0;
  mergedRanges.forEach((range, index) => {
    if (range.start > cursor) {
      parts.push(text.slice(cursor, range.start));
    }
    parts.push(
      <span key={`${range.start}-${range.end}-${index}`} className="text-primary font-semibold">
        {text.slice(range.start, range.end)}
      </span>
    );
    cursor = range.end;
  });

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return <>{parts}</>;
}

export default function Home() {
  const router = useRouter();
  const [availableTeams, setAvailableTeams] = useState<Team[]>([]);
  const [recentMatches, setRecentMatches] = useState<RecentMatch[]>([]);
  const [matchPreviewUrls, setMatchPreviewUrls] = useState<Record<string, string>>({});
  const [nowMs, setNowMs] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const getTeamName = (teamId: string | null) => {
    if (!teamId) return "Unassigned";
    return availableTeams.find((team) => team.id === teamId)?.name ?? teamId;
  };

  const doesMatchSearch = (match: RecentMatch, query: string): boolean => {
    const tokens = tokenizeSearchQuery(query);
    if (tokens.length === 0) return true;

    const homeName = getTeamName(match.home_team_id).toLowerCase();
    const awayName = getTeamName(match.away_team_id).toLowerCase();
    const title = (match.title ?? "").toLowerCase();
    const haystack = `${homeName} ${awayName} ${title}`;
    const words = tokenizeSearchableText(haystack);

    // Process-of-elimination search: every token must appear somewhere in the match text.
    return tokens.every((token) => haystack.includes(token) || isFuzzyTokenMatch(token, words));
  };

  const processingMatches = useMemo(
    () => recentMatches.filter(isAnalysisProcessing),
    [recentMatches]
  );

  const completedMatches = useMemo(
    () =>
      recentMatches
        .filter(
          (match) =>
            !isAnalysisProcessing(match) &&
            (match.analysis_status === "completed" || match.has_summary === true)
        )
        .sort((a, b) => {
          const aTime = new Date(a.created_at ?? a.match_date ?? 0).getTime();
          const bTime = new Date(b.created_at ?? b.match_date ?? 0).getTime();
          return bTime - aTime;
        }),
    [recentMatches]
  );

  const filteredProcessingMatches = processingMatches.filter((match) =>
    doesMatchSearch(match, searchQuery)
  );

  const filteredCompletedMatches = completedMatches.filter((match) =>
    doesMatchSearch(match, searchQuery)
  );

  const dashboardStats = useMemo(() => {
    const activeAnalyses = processingMatches.length;
    const analysedMatches = completedMatches;
    const matchesAnalysedCount = analysedMatches.length;
    const totalEvents = completedMatches.reduce((sum, match) => sum + (match.event_count ?? 0), 0);
    const avgEventsPerMatch = matchesAnalysedCount > 0 ? totalEvents / matchesAnalysedCount : 0;
    const latestMatch = completedMatches
      .filter((match) => Boolean(match.created_at ?? match.match_date))
      .sort((a, b) => {
        const aTime = new Date(a.created_at ?? a.match_date ?? 0).getTime();
        const bTime = new Date(b.created_at ?? b.match_date ?? 0).getTime();
        return bTime - aTime;
      })[0];

    const weightedTas = completedMatches.reduce(
      (acc, match) => {
        const tasValue = typeof match.tas === "number" && Number.isFinite(match.tas) ? match.tas : null;
        if (tasValue === null) return acc;
        const weight = Math.max(1, match.event_count ?? 0);
        return {
          weightedSum: acc.weightedSum + tasValue * weight,
          totalWeight: acc.totalWeight + weight,
        };
      },
      { weightedSum: 0, totalWeight: 0 }
    );

    const weightedSyniq = completedMatches.reduce(
      (acc, match) => {
        const rawSyniq =
          typeof match.syniq === "number" && Number.isFinite(match.syniq)
            ? match.syniq
            : typeof match.synIq === "number" && Number.isFinite(match.synIq)
            ? match.synIq
            : null;
        if (rawSyniq === null) return acc;
        const weight = Math.max(1, match.event_count ?? 0);
        return {
          weightedSum: acc.weightedSum + rawSyniq * weight,
          totalWeight: acc.totalWeight + weight,
        };
      },
      { weightedSum: 0, totalWeight: 0 }
    );

    const overallTas =
      weightedTas.totalWeight > 0 ? Number((weightedTas.weightedSum / weightedTas.totalWeight).toFixed(1)) : null;
    const overallSyniq =
      weightedSyniq.totalWeight > 0
        ? Number((weightedSyniq.weightedSum / weightedSyniq.totalWeight).toFixed(1))
        : null;

    return {
      matchesAnalysedCount,
      activeAnalyses,
      totalEvents,
      avgEventsPerMatch,
      latestAnalysisLabel: getRelativeTimeLabel(latestMatch?.created_at ?? latestMatch?.match_date),
      overallTas,
      overallSyniq,
    };
  }, [completedMatches, processingMatches]);

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

  useEffect(() => {
    const loadRecentMatches = async () => {
      const { data: matches, error: matchError } = await supabase
        .from("matches")
        .select("*")
        .limit(10);

      if (matchError) {
        console.warn("Recent matches unavailable:", matchError?.message || "unknown error");
        return;
      }

      if (!matches || matches.length === 0) {
        setRecentMatches([]);
        return;
      }

      const normalized: RecentMatch[] = (matches as MatchRecord[])
        .map((match) => ({
          id: match.id,
          title: match.title,
          video_url: match.video_url,
          home_team_id: match.home_team_id,
          away_team_id: match.away_team_id,
          created_at: match.created_at,
          match_date: match.match_date,
          tas: match.tas ?? null,
          syniq: match.syniq ?? null,
          synIq: match.synIq ?? null,
          analysis_status: normalizeAnalysisStatus(match.analysis_status),
        }))
        .filter((match) => match.id && match.video_url)
        .filter((match, index, list) => list.findIndex((candidate) => candidate.id === match.id) === index)
        .sort((a, b) => {
          const aTime = new Date(a.created_at ?? a.match_date ?? 0).getTime();
          const bTime = new Date(b.created_at ?? b.match_date ?? 0).getTime();
          return bTime - aTime;
        })
        .slice(0, 10);

      const aggregateByMatchId = new Map<string, MatchAggregateRecord>();
      const normalizedIds = normalized.map((match) => match.id);
      if (normalizedIds.length > 0) {
        const { data: aggregateRows, error: aggregateError } = await supabase
          .from("match_analysis_aggregates")
          .select("match_id, summary_metrics")
          .in("match_id", normalizedIds);

        if (aggregateError) {
          console.warn("Unable to load aggregate metrics for overview cards", aggregateError.message);
        } else {
          for (const row of (aggregateRows ?? []) as MatchAggregateRecord[]) {
            aggregateByMatchId.set(row.match_id, row);
          }
        }
      }

      const enriched = await Promise.all(
        normalized.map(async (match: RecentMatch) => {
          const [{ count, error: countError }, { data: completionMarker, error: completionError }] =
            await Promise.all([
              supabase
                .from("tactical_events")
                .select("*", { count: "exact", head: true })
                .eq("match_id", match.id),
              supabase
                .from("tactical_events")
                .select("id")
                .eq("match_id", match.id)
                .eq("event_type", "summary")
                .eq("timestamp_seconds", -1)
                .limit(1)
                .maybeSingle(),
            ]);

          const hasCompletionMarker = !completionError && Boolean(completionMarker?.id);
          const aggregateRow = aggregateByMatchId.get(match.id);
          const aggregateTas = extractAggregateMetricValue(aggregateRow?.summary_metrics, "tas");
          const aggregateSyniq = extractAggregateMetricValue(aggregateRow?.summary_metrics, "synchrony");

          return {
            ...match,
            tas: aggregateTas ?? match.tas ?? null,
            syniq: aggregateSyniq ?? match.syniq ?? match.synIq ?? null,
            event_count: countError ? 0 : count || 0,
            has_summary: hasCompletionMarker,
            analysis_status:
              match.analysis_status === "completed" || hasCompletionMarker
                ? "completed"
                : match.analysis_status,
          };
        })
      );
      setRecentMatches(enriched);
    };

    loadRecentMatches();
    const interval = setInterval(loadRecentMatches, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let isActive = true;

    const loadPreviewUrls = async () => {
      if (recentMatches.length === 0) {
        if (isActive) setMatchPreviewUrls({});
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        return;
      }

      const entries = await Promise.all(
        recentMatches.map(async (match) => {
          if (/^https?:\/\//i.test(match.video_url)) {
            return [match.id, match.video_url] as const;
          }

          try {
            const response = await fetch(`/api/video-url?match_id=${match.id}`, {
              headers: { Authorization: `Bearer ${session.access_token}` },
            });

            if (!response.ok) {
              return null;
            }

            const payload = (await response.json()) as { playback_url?: string };
            if (!payload?.playback_url) {
              return null;
            }

            return [match.id, payload.playback_url] as const;
          } catch {
            return null;
          }
        })
      );

      if (!isActive) return;

      const nextMap: Record<string, string> = {};
      for (const entry of entries) {
        if (!entry) continue;
        nextMap[entry[0]] = entry[1];
      }
      setMatchPreviewUrls(nextMap);
    };

    loadPreviewUrls();

    return () => {
      isActive = false;
    };
  }, [recentMatches]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    // Redirect the user back to the login page after signing out
    router.push("/login");
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

          <TopNavBar
            searchValue={searchQuery}
            onSearchChange={setSearchQuery}
            onToggleMenu={() => setIsMobileMenuOpen((prev) => !prev)}
            isMenuOpen={isMobileMenuOpen}
          />
          <SideNavBar
            onLogout={handleLogout}
            currentPage="dashboard"
            isMobileMenuOpen={isMobileMenuOpen}
            onCloseMobileMenu={() => setIsMobileMenuOpen(false)}
          />

          <main className="lg:ml-64 lg:w-[calc(100%-16rem)] pt-20 pb-12 px-6 w-full box-border space-y-12 relative z-10">
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
                <div className="w-full space-y-6 relative z-10">
                  <div>
                    <h1 className="text-4xl md:text-5xl font-black tracking-tight text-on-surface mb-2">
                      Match Intelligence Overview
                    </h1>
                    <p className="text-on-surface-variant text-lg">
                      Live summary of recent analysis activity and tactical data depth.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-4">
                    <div className="bg-surface-container-lowest/70 border border-outline-variant/20 rounded-xl p-4">
                      <p className="text-xs uppercase tracking-widest text-on-surface-variant/70 mb-2">Matches Analysed</p>
                      <p className="text-3xl font-black text-on-surface">{dashboardStats.matchesAnalysedCount}</p>
                    </div>
                    <div className="bg-surface-container-lowest/70 border border-outline-variant/20 rounded-xl p-4">
                      <p className="text-xs uppercase tracking-widest text-on-surface-variant/70 mb-2">Active Analyses</p>
                      <p className="text-3xl font-black text-amber-300">{dashboardStats.activeAnalyses}</p>
                    </div>
                    <div className="bg-surface-container-lowest/70 border border-outline-variant/20 rounded-xl p-4">
                      <p className="text-xs uppercase tracking-widest text-on-surface-variant/70 mb-2">Overall Team TAS</p>
                      <p className="text-3xl font-black text-primary">
                        {dashboardStats.overallTas !== null ? dashboardStats.overallTas.toFixed(1) : "-"}
                      </p>
                    </div>
                    <div className="bg-surface-container-lowest/70 border border-outline-variant/20 rounded-xl p-4">
                      <p className="text-xs uppercase tracking-widest text-on-surface-variant/70 mb-2">Overall Team SynIQ</p>
                      <p className="text-3xl font-black text-secondary">
                        {dashboardStats.overallSyniq !== null ? dashboardStats.overallSyniq.toFixed(1) : "-"}
                      </p>
                    </div>
                    <div className="bg-surface-container-lowest/70 border border-outline-variant/20 rounded-xl p-4">
                      <p className="text-xs uppercase tracking-widest text-on-surface-variant/70 mb-2">Avg Events / Match</p>
                      <p className="text-3xl font-black text-on-surface">{dashboardStats.avgEventsPerMatch.toFixed(1)}</p>
                    </div>
                    <div className="bg-surface-container-lowest/70 border border-outline-variant/20 rounded-xl p-4">
                      <p className="text-xs uppercase tracking-widest text-on-surface-variant/70 mb-2">Last Analysis</p>
                      <p className="text-3xl font-black text-secondary">{dashboardStats.latestAnalysisLabel}</p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Recent Processing Matches */}
            {filteredProcessingMatches.length > 0 && (
              <section className="space-y-6">
                <div className="flex justify-between items-end px-2">
                  <div>
                    <h2 className="text-2xl font-bold text-on-surface">
                      Processing Analysis
                    </h2>
                    <p className="text-on-surface-variant text-sm">
                      Matches currently being analysed
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {filteredProcessingMatches.map((match) => {
                    const eventCount = match.event_count || 0;
                    const progressPercent = getProgressPercent(match, nowMs);
                    const previewUrl = matchPreviewUrls[match.id] ?? null;
                    const tasValue = typeof match.tas === "number" ? match.tas : null;
                    const syniqRaw = typeof match.syniq === "number" ? match.syniq : match.synIq;
                    const syniqValue = typeof syniqRaw === "number" ? syniqRaw : null;
                    return (
                      <div
                        key={match.id}
                        className="glass-card p-6 rounded-xl relative overflow-hidden group transition-all cursor-not-allowed opacity-85 h-full flex flex-col"
                      >
                        <div className="flex justify-between items-start mb-4 gap-3">
                          <div className="flex-grow">
                            <h3 className="text-lg font-bold text-on-surface mb-2">
                              {match.title ?? "Match analysis"}
                            </h3>
                            <p className="text-sm text-on-surface-variant">
                              Teams: {highlightSearchMatches(getTeamName(match.home_team_id), searchQuery)} vs {" "}
                              {highlightSearchMatches(getTeamName(match.away_team_id), searchQuery)}
                            </p>
                          </div>
                          <span className="px-3 py-1 bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-bold tracking-widest rounded-full whitespace-nowrap">
                            <span className="inline-block animate-pulse mr-1">●</span> PROCESSING
                          </span>
                        </div>

                        <div className="mb-4 rounded-lg overflow-hidden border border-outline-variant/20 bg-black/40 aspect-video flex items-center justify-center">
                          {previewUrl ? (
                            <video
                              src={previewUrl}
                              muted
                              playsInline
                              preload="metadata"
                              className="w-full h-full object-cover"
                              onLoadedMetadata={(event) => {
                                event.currentTarget.currentTime = 1;
                              }}
                            />
                          ) : (
                            <span className="material-symbols-outlined text-on-surface-variant/60 text-5xl">
                              movie
                            </span>
                          )}
                        </div>

                        <div className="w-full bg-surface-container-lowest rounded-full h-2 overflow-hidden mt-auto">
                          <div
                            className="bg-gradient-to-r from-primary to-primary-container h-full rounded-full transition-all duration-700"
                            style={{ width: `${progressPercent}%` }}
                          ></div>
                        </div>

                        <div className="mt-3 flex items-center justify-between gap-4">
                          <p className="text-xs text-on-surface-variant/80">
                            {eventCount > 0
                              ? `${progressPercent}% complete • ${eventCount} events • elapsed ${getElapsedTimeLabel(match, nowMs)}`
                              : `Waiting for worker output... • elapsed ${getElapsedTimeLabel(match, nowMs)}`}
                          </p>
                        </div>

                        <div className="flex items-center justify-between pt-3 mt-3 border-t border-outline-variant/10">
                          <div className="flex gap-4">
                            <ScoreRing value={tasValue} label="TAS" accentClass="text-primary" />
                            <ScoreRing value={syniqValue} label="SynIQ" accentClass="text-secondary" />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Completed Analyses */}
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
              {filteredCompletedMatches.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {filteredCompletedMatches.map((match) => {
                    const eventCount = match.event_count || 0;
                    const previewUrl = matchPreviewUrls[match.id] ?? null;
                    const tasValue = typeof match.tas === "number" ? match.tas : null;
                    const syniqRaw = typeof match.syniq === "number" ? match.syniq : match.synIq;
                    const syniqValue = typeof syniqRaw === "number" ? syniqRaw : null;
                    return (
                      <div
                        key={match.id}
                        className="glass-card p-6 rounded-xl relative overflow-hidden transition-all hover:bg-opacity-50 cursor-pointer h-full flex flex-col"
                        onClick={() => router.push(`/analysis?id=${match.id}`)}
                      >
                        <div className="flex justify-between items-start mb-4 gap-3">
                          <div className="flex-grow">
                            <h3 className="text-lg font-bold text-on-surface mb-2">
                              {match.title ?? "Match analysis"}
                            </h3>
                            <p className="text-sm text-on-surface-variant">
                              Teams: {highlightSearchMatches(getTeamName(match.home_team_id), searchQuery)} vs {" "}
                              {highlightSearchMatches(getTeamName(match.away_team_id), searchQuery)}
                            </p>
                          </div>
                          <span className="px-3 py-1 bg-green-500/20 border border-green-500/40 text-green-300 text-xs font-bold tracking-widest rounded-full whitespace-nowrap">
                            COMPLETE
                          </span>
                        </div>

                        <div className="mb-4 rounded-lg overflow-hidden border border-outline-variant/20 bg-black/40 aspect-video flex items-center justify-center">
                          {previewUrl ? (
                            <video
                              src={previewUrl}
                              muted
                              playsInline
                              preload="metadata"
                              className="w-full h-full object-cover"
                              onLoadedMetadata={(event) => {
                                event.currentTarget.currentTime = 1;
                              }}
                            />
                          ) : (
                            <span className="material-symbols-outlined text-on-surface-variant/60 text-5xl">
                              analytics
                            </span>
                          )}
                        </div>

                        <div className="flex items-center justify-between gap-4">
                          <p className="text-xs text-on-surface-variant/80">
                            {eventCount} events generated
                          </p>
                          <p className="text-xs text-on-surface-variant/80">
                            {getRelativeTimeLabel(match.created_at ?? match.match_date)}
                          </p>
                        </div>

                        <div className="flex items-center justify-between pt-3 mt-3 border-t border-outline-variant/10">
                          <div className="flex gap-4">
                            <ScoreRing value={tasValue} label="TAS" accentClass="text-primary" />
                            <ScoreRing value={syniqValue} label="SynIQ" accentClass="text-secondary" />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
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
                      {searchQuery.trim()
                        ? `No matches found for "${searchQuery.trim()}"`
                        : "Ready for your first analysis?"}
                    </h3>
                    <p className="text-on-surface-variant text-lg leading-relaxed">
                      {searchQuery.trim()
                        ? "Try searching by home team, away team, or part of the fixture name."
                        : "Upload a match video above to unlock elite-level tactical insights, player tracking, and performance metrics. Your analysis will appear here once complete."}
                    </p>
                    <div className="pt-4">
                      <p className="text-sm text-on-surface-variant/70 font-medium">
                        ✨ Powered by Pelios AI-driven Analytics Engine, and SynIQ analysis
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* Stats Overview Footer */}
            <footer className="pt-8 border-t border-outline-variant/10 flex flex-col md:flex-row justify-between items-center gap-6">
              <div className="flex items-center gap-8">
                <div>
                  <span className="block text-xs font-bold text-on-surface-variant/60 uppercase tracking-widest mb-1">
                    Analyses Completed
                  </span>
                  <span className="text-2xl font-black text-on-surface">
                    {dashboardStats.matchesAnalysedCount} <small className="text-xs font-normal text-primary">Matches</small>
                  </span>
                </div>
                <div>
                  <span className="block text-xs font-bold text-on-surface-variant/60 uppercase tracking-widest mb-1">
                    Events Generated
                  </span>
                  <span className="text-2xl font-black text-on-surface">
                    {dashboardStats.totalEvents} <small className="text-xs font-normal text-secondary">Events</small>
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