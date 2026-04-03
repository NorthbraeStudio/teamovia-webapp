"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/lib/AuthGuard";
import { supabase } from "@/lib/supabase";
import TopNavBar from "@/lib/TopNavBar";
import SideNavBar from "@/lib/SideNavBar";

interface Team {
  id: string;
  name: string;
}

interface RecentMatch {
  id: string;
  title?: string;
  video_url: string;
  home_team_id: string | null;
  away_team_id: string | null;
  created_at?: string;
  match_date?: string;
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
  analysis_status?: unknown;
};

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
    const createdTime = getMatchStartTimestamp(match);
    if (!createdTime) return true;
    const now = new Date().getTime();
    const ageMinutes = (now - createdTime) / (1000 * 60);
    return ageMinutes < MAX_PROCESSING_MINUTES;
  }
  if (
    match.analysis_status === "completed" ||
    match.analysis_status === "failed" ||
    match.analysis_status === "stopped"
  ) {
    return false;
  }

  const hasSummary = match.has_summary === true;
  if (hasSummary) return false;

  const createdTime = getMatchStartTimestamp(match);
  if (!createdTime) return (match.event_count ?? 0) > 0;

  const now = new Date().getTime();
  const ageMinutes = (now - createdTime) / (1000 * 60);
  return ageMinutes < MAX_PROCESSING_MINUTES;
}

function getElapsedTimeLabel(match: RecentMatch, nowMs: number): string {
  const start = getMatchStartTimestamp(match);
  if (!start) return "0:00";
  const maxElapsedSeconds = MAX_PROCESSING_MINUTES * 60;
  const elapsedSeconds = Math.max(0, Math.min(Math.floor((nowMs - start) / 1000), maxElapsedSeconds));
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function getProgressPercent(match: RecentMatch): number {
  const eventCount = match.event_count ?? 0;
  const eventProgress = Math.min((eventCount / EXPECTED_EVENT_COUNT) * 100, 100);
  return Math.round(eventProgress);
}

function MatchCardPreview({ idSuffix }: { idSuffix: string }) {
  const gridId = `grid-${idSuffix}`;
  const pulseId = `pulseGradient-${idSuffix}`;

  return (
    <svg viewBox="0 0 800 450" xmlns="http://www.w3.org/2000/svg" className="w-full h-full rounded-t-xl bg-[#0e0c20]">
      <rect width="800" height="450" fill="#0e0c20" />
      <rect width="800" height="450" fill={`url(#${gridId})`} />
      <rect x="50" y="50" width="700" height="350" fill="none" stroke="#e7e2ff" strokeWidth="1" strokeOpacity="0.1" />
      <line x1="400" y1="50" x2="400" y2="400" stroke="#e7e2ff" strokeWidth="1" strokeOpacity="0.1" />
      <circle cx="400" cy="225" r="50" fill="none" stroke="#e7e2ff" strokeWidth="1" strokeOpacity="0.1" />

      <defs>
        <pattern id={gridId} width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#8B5CF6" strokeWidth="0.5" strokeOpacity="0.1" />
        </pattern>
        <radialGradient id={pulseId}>
          <stop offset="10%" stopColor="#ff706e" />
          <stop offset="100%" stopColor="#ff706e" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="560" cy="180" r="80" fill={`url(#${pulseId})`} fillOpacity="0.3">
        <animate attributeName="r" values="70;90;70" dur="3s" repeatCount="indefinite" />
      </circle>

      <g>
        <circle cx="150" cy="120" r="4" fill="#ff706e" />
        <circle cx="140" cy="190" r="4" fill="#ff706e" />
        <circle cx="145" cy="260" r="4" fill="#ff706e" />
        <circle cx="160" cy="330" r="4" fill="#ff706e" />
        <path d="M 150 120 L 140 190 L 145 260 L 160 330" fill="none" stroke="#ff706e" strokeWidth="1.5" strokeDasharray="4" />

        <circle cx="320" cy="150" r="4" fill="#ff706e" />
        <circle cx="310" cy="225" r="4" fill="#ff706e" />
        <circle cx="330" cy="300" r="4" fill="#ff706e" />
      </g>

      <g transform="translate(560, 180)">
        <circle r="15" fill="none" stroke="#ff706e" strokeWidth="2">
          <animate attributeName="stroke-width" values="1;4;1" dur="1.5s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="1;0.2;1" dur="1.5s" repeatCount="indefinite" />
        </circle>
        <text y="-25" textAnchor="middle" fill="#ff706e" fontFamily="Montserrat, sans-serif" fontWeight="900" fontSize="12" letterSpacing="2">
          SYNC ANOMALY
        </text>
      </g>

      <rect y="400" width="800" height="50" fill="#252147" fillOpacity="0.8" />
      <text x="30" y="430" fill="#e7e2ff" fontFamily="Inter, sans-serif" fontWeight="700" fontSize="10" letterSpacing="1">
        AI ANALYSIS: IN PROGRESS
      </text>
      <text x="770" y="430" textAnchor="end" fill="#ff706e" fontFamily="Inter, sans-serif" fontWeight="900" fontSize="10" letterSpacing="2">
        94.2 TAS
      </text>
    </svg>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const [isRoleLoading, setIsRoleLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const [teams, setTeams] = useState<Team[]>([]);
  const [recentMatches, setRecentMatches] = useState<RecentMatch[]>([]);

  const [storageUsedBytes, setStorageUsedBytes] = useState<number | null>(null);
  const storageQuotaBytes = 9 * 1024 * 1024 * 1024;

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedHomeTeam, setSelectedHomeTeam] = useState("");
  const [selectedAwayTeam, setSelectedAwayTeam] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "success" | "error">("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [preflightWarning, setPreflightWarning] = useState<string | null>(null);
  const [pendingAnalysisRequest, setPendingAnalysisRequest] = useState<{
    object_key: string;
    file_size: number;
    home_team_id: string;
    away_team_id: string;
  } | null>(null);
  const [stoppingMatchIds, setStoppingMatchIds] = useState<string[]>([]);
  const [reprocessingMatchIds, setReprocessingMatchIds] = useState<string[]>([]);
  const [markingGoalMatchIds, setMarkingGoalMatchIds] = useState<string[]>([]);
  const [manualGoalSecondsByMatch, setManualGoalSecondsByMatch] = useState<Record<string, string>>({});
  const [manualGoalTeamByMatch, setManualGoalTeamByMatch] = useState<Record<string, "home" | "away">>({});
  const [nowMs, setNowMs] = useState(Date.now());

  const getTeamName = (teamId: string | null) => {
    if (!teamId) return "Unassigned";
    return teams.find((team) => team.id === teamId)?.name ?? teamId;
  };

  useEffect(() => {
    const loadRole = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setIsAdmin(false);
        setIsRoleLoading(false);
        return;
      }

      const { data: profile, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        console.warn("Unable to load user role", error);
        setIsAdmin(false);
      } else {
        setIsAdmin(profile?.role === "admin");
      }

      setIsRoleLoading(false);
    };

    loadRole();
  }, []);

  useEffect(() => {
    if (!isAdmin) return;

    const loadTeams = async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name")
        .order("name", { ascending: true });

      if (data) {
        setTeams(data);
      } else if (error) {
        console.error("Failed to load teams", error);
      }
    };

    loadTeams();
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;

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
          analysis_status: normalizeAnalysisStatus(match.analysis_status),
        }))
        .filter((match) => match.id && match.video_url)
        .sort((a, b) => {
          const aTime = new Date(a.created_at ?? a.match_date ?? 0).getTime();
          const bTime = new Date(b.created_at ?? b.match_date ?? 0).getTime();
          return bTime - aTime;
        })
        .slice(0, 10);

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

          const hasSummary = !completionError && Boolean(completionMarker?.id);

          return {
            ...match,
            event_count: countError ? 0 : count || 0,
            has_summary: hasSummary,
            analysis_status: (
              match.analysis_status === "completed" || hasSummary
                ? "completed"
                : (match.analysis_status ?? null)
            ) as RecentMatch["analysis_status"],
          };
        })
      );
      setRecentMatches(enriched);
    };

    loadRecentMatches();
    const interval = setInterval(loadRecentMatches, 30000);
    return () => clearInterval(interval);
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;

    const fetchStorageUsage = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      try {
        const res = await fetch("/api/storage-usage", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const json = await res.json();
          setStorageUsedBytes(json.used_bytes ?? 0);
        }
      } catch {
        // silently ignore on load
      }
    };

    fetchStorageUsage();
  }, [isAdmin]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  const triggerAnalysisRequest = async (requestPayload: {
    object_key: string;
    file_size: number;
    home_team_id: string;
    away_team_id: string;
  }) => {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      throw new Error("Your session has expired. Please log in again.");
    }

    const res = await fetch("/api/analyse", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(requestPayload),
    });

    const data = await res.json();
    if (!res.ok || !data.match?.id) {
      throw new Error(data?.error ?? "Unable to start analysis. Please check your inputs and try again.");
    }

    setSubmitStatus("success");
    setSubmitError(null);
    setSelectedFile(null);
    setUploadProgress(0);
    setPendingAnalysisRequest(null);
    setPreflightWarning(null);
  };

  const handleAnalysisSubmit = async () => {
    if (!selectedFile) {
      setSubmitError("Please select a video file to upload.");
      setSubmitStatus("error");
      return;
    }

    if (!selectedHomeTeam || !selectedAwayTeam) {
      setSubmitError("Please select both a home team and an away team.");
      setSubmitStatus("error");
      return;
    }

    if (selectedHomeTeam === selectedAwayTeam) {
      setSubmitError("Home and away teams must be different.");
      setSubmitStatus("error");
      return;
    }

    setIsSubmitting(true);
    setIsUploading(true);
    setUploadProgress(0);
    setSubmitStatus("idle");
    setSubmitError(null);
    setPreflightWarning(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setSubmitError("Your session has expired. Please log in again.");
        setSubmitStatus("error");
        return;
      }

      // Step 1: get a presigned PUT URL from the server
      const uploadUrlRes = await fetch("/api/upload-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          filename: selectedFile.name,
          content_type: selectedFile.type,
          file_size: selectedFile.size,
        }),
      });

      const uploadUrlRaw = await uploadUrlRes.text();
      let uploadUrlData: { upload_url?: string; object_key?: string; error?: string } = {};
      if (uploadUrlRaw) {
        try {
          uploadUrlData = JSON.parse(uploadUrlRaw);
        } catch {
          uploadUrlData = { error: uploadUrlRaw.slice(0, 300) };
        }
      }

      if (!uploadUrlRes.ok) {
        setSubmitError(uploadUrlData?.error ?? `Failed to prepare upload (HTTP ${uploadUrlRes.status}).`);
        setSubmitStatus("error");
        return;
      }

      const { upload_url, object_key } = uploadUrlData as { upload_url: string; object_key: string };

      // Step 2: PUT file directly to R2 with progress tracking
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", upload_url, true);
        xhr.setRequestHeader("Content-Type", selectedFile.type);
        xhr.timeout = 5 * 60 * 1000;

        const uploadOrigin = (() => {
          try {
            return new URL(upload_url).origin;
          } catch {
            return "unknown origin";
          }
        })();

        xhr.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) {
            setUploadProgress(Math.round((event.loaded / event.total) * 100));
          }
        });

        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            setUploadProgress(100);
            resolve();
          } else {
            const responseBody = (xhr.responseText || "").slice(0, 300);
            reject(
              new Error(
                `Upload failed (status ${xhr.status}) to ${uploadOrigin}.${
                  responseBody ? ` R2 response: ${responseBody}` : ""
                }`
              )
            );
          }
        });

        xhr.addEventListener("error", () =>
          reject(
            new Error(
              `Upload network error while sending to ${uploadOrigin}. This is usually a bucket CORS/preflight issue in Cloudflare R2.`
            )
          )
        );
        xhr.addEventListener("abort", () => reject(new Error("Upload was aborted")));
        xhr.addEventListener("timeout", () =>
          reject(new Error(`Upload timed out while sending to ${uploadOrigin}.`))
        );

        xhr.send(selectedFile);
      });

      setIsUploading(false);

      // Step 3: run a quick player-visibility preflight before full analysis
      let shouldRequireProceedConfirmation = false;
      let preflightMessage: string | null = null;

      try {
        const preflightRes = await fetch("/api/analyse/preflight", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            object_key,
          }),
        });

        const preflightPayload = await preflightRes.json();
        if (preflightRes.ok && preflightPayload?.preflight_passed === false) {
          const warningText =
            typeof preflightPayload?.warning === "string"
              ? preflightPayload.warning
              : "Low player visibility detected in sampled frames. Analysis may fail or produce low-confidence output.";
          const details =
            typeof preflightPayload?.sampled_frames === "number"
              ? ` Sampled ${preflightPayload.sampled_frames} frames, with people in ${preflightPayload.frames_with_people ?? 0}.`
              : "";
          preflightMessage = `${warningText}${details}`;
          shouldRequireProceedConfirmation = true;
          setPreflightWarning(preflightMessage);
        } else {
          setPreflightWarning(null);
        }
      } catch {
        // Preflight is advisory only; continue analysis if it fails.
        setPreflightWarning("Preflight check could not be completed. Analysis will continue.");
      }

      const analysisRequestPayload = {
        object_key,
        file_size: selectedFile.size,
        home_team_id: selectedHomeTeam,
        away_team_id: selectedAwayTeam,
      };

      if (shouldRequireProceedConfirmation && preflightMessage) {
        setPendingAnalysisRequest(analysisRequestPayload);
        setSubmitStatus("idle");
        setSubmitError(null);
        // Upload already succeeded; adjust storage usage immediately.
        setStorageUsedBytes((prev) => (prev !== null ? prev + selectedFile.size : null));
        return;
      }

      await triggerAnalysisRequest(analysisRequestPayload);
      // Refresh storage usage after successful upload
      setStorageUsedBytes((prev) => (prev !== null ? prev + selectedFile.size : null));
    } catch (error) {
      console.error("Analysis submission error:", error);
      setSubmitError(error instanceof Error ? error.message : "Error during upload or analysis start.");
      setSubmitStatus("error");
    } finally {
      setIsSubmitting(false);
      setIsUploading(false);
    }
  };

  const handleProceedAnyway = async () => {
    if (!pendingAnalysisRequest) return;

    setIsSubmitting(true);
    setSubmitStatus("idle");
    setSubmitError(null);

    try {
      await triggerAnalysisRequest(pendingAnalysisRequest);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Unable to start analysis.");
      setSubmitStatus("error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelPendingAnalysis = () => {
    setPendingAnalysisRequest(null);
    setPreflightWarning(null);
    setSubmitStatus("idle");
    setSubmitError(null);
  };

  const handleStopAnalysis = async (matchId: string) => {
    setStoppingMatchIds((prev) => [...prev, matchId]);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setSubmitStatus("error");
        setSubmitError("Your session has expired. Please log in again.");
        return;
      }

      const res = await fetch("/api/analyse/stop", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ match_id: matchId }),
      });

      const data = await res.json();
      if (!res.ok) {
        setSubmitStatus("error");
        setSubmitError(data?.error ?? "Unable to stop this analysis. Please try again.");
        return;
      }

      setRecentMatches((prev) => prev.filter((match) => match.id !== matchId));
      setSubmitStatus("success");
    } catch (error) {
      console.error("Stop analysis error:", error);
      setSubmitStatus("error");
      setSubmitError("Network error while stopping analysis. Please try again.");
    } finally {
      setStoppingMatchIds((prev) => prev.filter((id) => id !== matchId));
    }
  };

  const handleMarkGoalEvent = async (matchId: string) => {
    const rawSeconds = manualGoalSecondsByMatch[matchId] ?? "";
    const timestampSeconds = Number(rawSeconds);
    const teamAssignment = manualGoalTeamByMatch[matchId] ?? "home";

    if (!Number.isFinite(timestampSeconds) || timestampSeconds < 0) {
      setSubmitStatus("error");
      setSubmitError("Enter a valid goal timestamp in seconds.");
      return;
    }

    setMarkingGoalMatchIds((prev) => [...prev, matchId]);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setSubmitStatus("error");
        setSubmitError("Your session has expired. Please log in again.");
        return;
      }

      const res = await fetch("/api/analyse/manual-event", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          match_id: matchId,
          team_assignment: teamAssignment,
          timestamp_seconds: timestampSeconds,
        }),
      });

      const payload = await res.json();
      if (!res.ok) {
        setSubmitStatus("error");
        setSubmitError(payload?.error ?? "Unable to mark manual goal event.");
        return;
      }

      setSubmitStatus("success");
      setSubmitError(null);
      setManualGoalSecondsByMatch((prev) => ({ ...prev, [matchId]: "" }));
    } catch {
      setSubmitStatus("error");
      setSubmitError("Network error while marking goal event. Please try again.");
    } finally {
      setMarkingGoalMatchIds((prev) => prev.filter((id) => id !== matchId));
    }
  };

  const handleReprocessMatch = async (matchId: string) => {
    setReprocessingMatchIds((prev) => [...prev, matchId]);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        setSubmitStatus("error");
        setSubmitError("Your session has expired. Please log in again.");
        return;
      }

      const res = await fetch("/api/analyse/reprocess", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ match_id: matchId }),
      });

      const payload = await res.json();
      if (!res.ok) {
        setSubmitStatus("error");
        setSubmitError(payload?.error ?? "Unable to reprocess this match.");
        return;
      }

      setSubmitStatus("success");
      setSubmitError(null);
      setManualGoalSecondsByMatch((prev) => ({ ...prev, [matchId]: "" }));
      setRecentMatches((prev) =>
        prev.map((match) =>
          match.id === matchId
            ? {
                ...match,
                has_summary: false,
                event_count: 0,
                analysis_status: "processing",
                created_at: new Date().toISOString(),
              }
            : match
        )
      );
    } catch {
      setSubmitStatus("error");
      setSubmitError("Network error while starting reprocess. Please try again.");
    } finally {
      setReprocessingMatchIds((prev) => prev.filter((id) => id !== matchId));
    }
  };

  const processingMatches = useMemo(
    () => recentMatches.filter(isAnalysisProcessing),
    [recentMatches]
  );

  const completedMatches = useMemo(
    () =>
      recentMatches
        .filter((match) => match.analysis_status === "completed" || match.has_summary === true)
        .sort((a, b) => {
          const aTime = new Date(a.created_at ?? a.match_date ?? 0).getTime();
          const bTime = new Date(b.created_at ?? b.match_date ?? 0).getTime();
          return bTime - aTime;
        }),
    [recentMatches]
  );

  return (
    <AuthGuard>
      <>
        <style>{`
          .admin-bg {
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
        <div className="admin-bg font-body selection:bg-primary selection:text-on-primary-container relative">
          <TopNavBar
            searchValue=""
            onSearchChange={() => {}}
            onToggleMenu={() => setIsMobileMenuOpen((prev) => !prev)}
            isMenuOpen={isMobileMenuOpen}
          />
          <SideNavBar
            onLogout={handleLogout}
            currentPage="admin"
            isMobileMenuOpen={isMobileMenuOpen}
            onCloseMobileMenu={() => setIsMobileMenuOpen(false)}
          />

          <main className="lg:ml-64 lg:w-[calc(100%-16rem)] w-full pt-20 pb-12 px-6 box-border space-y-10 relative z-10">
            {isRoleLoading ? (
              <section className="glass-card p-10 rounded-xl text-center text-on-surface-variant">
                Checking administrator access...
              </section>
            ) : !isAdmin ? (
              <section className="glass-card p-10 rounded-xl text-center space-y-4">
                <h1 className="text-3xl font-black">Administrator Access Required</h1>
                <p className="text-on-surface-variant">
                  This portal is restricted to administrator accounts.
                </p>
              </section>
            ) : (
              <>
                <section className="glass-card p-8 md:p-10 rounded-xl space-y-6">
                  <div>
                    <h1 className="text-4xl font-black tracking-tight text-on-surface mb-2">
                      Admin Analysis Console
                    </h1>
                    <p className="text-on-surface-variant text-lg">
                      Submit new video analyses and manage currently processing runs.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-bold text-on-surface mb-2">Home Team</label>
                      <select
                        value={selectedHomeTeam}
                        onChange={(e) => setSelectedHomeTeam(e.target.value)}
                        disabled={isSubmitting}
                        className="w-full bg-surface-container-lowest border border-outline-variant/30 rounded-lg py-2 px-3 text-on-surface focus:ring-2 focus:ring-primary/50 transition-all disabled:opacity-50"
                      >
                        <option value="">Select home team</option>
                        {teams.map((team) => (
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
                        {teams.map((team) => (
                          <option key={team.id} value={team.id}>
                            {team.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-col gap-4">
                    {/* Storage usage bar */}
                    {storageUsedBytes !== null && (
                      <div className="space-y-2">
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-bold text-on-surface-variant uppercase tracking-wider">R2 Storage</span>
                          <span className={storageUsedBytes >= storageQuotaBytes ? "text-red-400 font-bold" : "text-on-surface-variant"}>
                            {(storageUsedBytes / (1024 ** 3)).toFixed(2)} GB / {(storageQuotaBytes / (1024 ** 3)).toFixed(0)} GB
                          </span>
                        </div>
                        <div className="w-full bg-surface-container-lowest rounded-full h-2 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              storageUsedBytes / storageQuotaBytes >= 0.9
                                ? "bg-red-500"
                                : storageUsedBytes / storageQuotaBytes >= 0.7
                                ? "bg-amber-400"
                                : "bg-gradient-to-r from-primary to-primary-container"
                            }`}
                            style={{ width: `${Math.min((storageUsedBytes / storageQuotaBytes) * 100, 100).toFixed(1)}%` }}
                          />
                        </div>
                        {storageUsedBytes >= storageQuotaBytes && (
                          <p className="text-xs text-red-400 font-medium">
                            Storage limit reached. Remove existing videos before uploading more.
                          </p>
                        )}
                      </div>
                    )}

                    <label
                      htmlFor="video-upload"
                      className={`relative flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl py-10 px-6 cursor-pointer transition-all ${
                        isSubmitting
                          ? "opacity-50 cursor-not-allowed border-outline-variant/30"
                          : selectedFile
                          ? "border-primary/60 bg-primary/5"
                          : "border-outline-variant/30 hover:border-primary/40 hover:bg-primary/5"
                      }`}
                    >
                      <span className="material-symbols-outlined text-4xl text-on-surface-variant">upload_file</span>
                      {selectedFile ? (
                        <div className="text-center">
                          <p className="text-sm font-bold text-on-surface">{selectedFile.name}</p>
                          <p className="text-xs text-on-surface-variant mt-1">
                            {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB &middot; {selectedFile.type}
                          </p>
                        </div>
                      ) : (
                        <div className="text-center">
                          <p className="text-sm font-medium text-on-surface">Click to select a video file</p>
                          <p className="text-xs text-on-surface-variant mt-1">MP4, MOV, M4V or WebM &middot; up to 4 GB</p>
                        </div>
                      )}
                      <input
                        id="video-upload"
                        type="file"
                        accept="video/mp4,video/quicktime,video/x-m4v,video/webm,.mp4,.mov,.m4v,.webm"
                        className="sr-only"
                        disabled={isSubmitting}
                        onChange={(e) => {
                          const file = e.target.files?.[0] ?? null;
                          setSelectedFile(file);
                          setUploadProgress(0);
                          setSubmitStatus("idle");
                          setSubmitError(null);
                          setPreflightWarning(null);
                        }}
                      />
                    </label>

                    {isUploading && (
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs text-on-surface-variant">
                          <span>Uploading to cloud storage...</span>
                          <span>{uploadProgress}%</span>
                        </div>
                        <div className="w-full bg-surface-container-lowest rounded-full h-2 overflow-hidden">
                          <div
                            className="bg-gradient-to-r from-primary to-primary-container h-full rounded-full transition-all duration-300"
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                      </div>
                    )}

                    <button
                      onClick={handleAnalysisSubmit}
                      disabled={isSubmitting || !selectedFile || (storageUsedBytes !== null && storageUsedBytes >= storageQuotaBytes)}
                      className="bg-gradient-to-r from-primary to-primary-container text-on-primary-container font-bold px-8 py-4 rounded-full flex items-center justify-center gap-2 hover:shadow-[0_0_30px_rgba(255,112,110,0.4)] transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSubmitting
                        ? isUploading
                          ? `Uploading... ${uploadProgress}%`
                          : "Starting analysis..."
                        : "Upload & Analyse"}
                      <span className="material-symbols-outlined text-xl">
                        {isSubmitting ? "hourglass_empty" : "rocket_launch"}
                      </span>
                    </button>
                  </div>

                  {submitStatus === "success" && (
                    <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400 text-sm font-medium">
                      Analysis started successfully.
                    </div>
                  )}
                  {submitStatus === "error" && (
                    <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm font-medium">
                      {submitError ?? "Unable to complete this action."}
                    </div>
                  )}
                  {preflightWarning && (
                    <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-300 text-sm font-medium">
                      <p>{preflightWarning}</p>
                      {pendingAnalysisRequest && (
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void handleProceedAnyway()}
                            disabled={isSubmitting}
                            className="px-3 py-1.5 text-[10px] font-bold tracking-widest uppercase rounded-full border border-amber-300/60 text-amber-200 hover:bg-amber-500/20 transition-all disabled:opacity-60"
                          >
                            {isSubmitting ? "Starting..." : "Proceed Anyway"}
                          </button>
                          <button
                            type="button"
                            onClick={handleCancelPendingAnalysis}
                            disabled={isSubmitting}
                            className="px-3 py-1.5 text-[10px] font-bold tracking-widest uppercase rounded-full border border-white/30 text-on-surface-variant hover:bg-white/10 transition-all disabled:opacity-60"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </section>

                {processingMatches.length > 0 && (
                  <section className="space-y-4">
                    <div>
                      <h2 className="text-2xl font-bold text-on-surface">Processing Runs</h2>
                      <p className="text-on-surface-variant text-sm">Monitor active analyses and stop if needed.</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                      {processingMatches.map((match) => {
                        const eventCount = match.event_count || 0;
                        const progressPercent = getProgressPercent(match);
                        const isStopping = stoppingMatchIds.includes(match.id);
                        const isReprocessing = reprocessingMatchIds.includes(match.id);
                        const isMarkingGoal = markingGoalMatchIds.includes(match.id);
                        const selectedGoalTeam = manualGoalTeamByMatch[match.id] ?? "home";
                        const selectedGoalSeconds = manualGoalSecondsByMatch[match.id] ?? "";

                        return (
                          <div
                            key={match.id}
                            className="glass-card p-6 rounded-xl relative overflow-hidden group transition-all cursor-default"
                          >
                            <div className="flex justify-between items-start mb-4 gap-3">
                              <div className="flex-grow">
                                <h3 className="text-lg font-bold text-on-surface mb-2">
                                  {match.title ?? "Match analysis"}
                                </h3>
                                <p className="text-sm text-on-surface-variant">
                                  Teams: {getTeamName(match.home_team_id)} vs {getTeamName(match.away_team_id)}
                                </p>
                              </div>
                              <span className="px-3 py-1 bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-bold tracking-widest rounded-full whitespace-nowrap">
                                <span className="inline-block animate-pulse mr-1">●</span> PROCESSING
                              </span>
                            </div>

                            <div className="mb-4 rounded-lg overflow-hidden border border-outline-variant/20 bg-black/40 aspect-video">
                              <MatchCardPreview idSuffix={`processing-${match.id}`} />
                            </div>

                            <div className="w-full bg-surface-container-lowest rounded-full h-2 overflow-hidden">
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
                                {getMatchStartTimestamp(match) &&
                                  nowMs - (getMatchStartTimestamp(match) ?? nowMs) >= MAX_PROCESSING_MINUTES * 60 * 1000 &&
                                  " • stale"}
                              </p>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  disabled={isReprocessing}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleReprocessMatch(match.id);
                                  }}
                                  className="px-3 py-1.5 text-[10px] font-bold tracking-widest uppercase rounded-full border border-[#60a5fa]/50 text-[#93c5fd] hover:bg-[#1d4ed8]/20 transition-all disabled:opacity-60"
                                >
                                  {isReprocessing ? "Reprocessing..." : "Reprocess"}
                                </button>
                                <button
                                  type="button"
                                  disabled={isStopping}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleStopAnalysis(match.id);
                                  }}
                                  className="px-3 py-1.5 text-[10px] font-bold tracking-widest uppercase rounded-full border border-red-400/50 text-red-300 hover:bg-red-500/20 transition-all disabled:opacity-60"
                                >
                                  {isStopping ? "Stopping..." : "Stop Analysis"}
                                </button>
                              </div>
                            </div>

                            <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3">
                              <p className="text-[10px] uppercase tracking-widest text-on-surface-variant/70 mb-2">
                                Manual Goal Marker
                              </p>
                              <div className="flex flex-col md:flex-row gap-2 md:items-center">
                                <select
                                  value={selectedGoalTeam}
                                  onChange={(event) => {
                                    const value = event.target.value === "away" ? "away" : "home";
                                    setManualGoalTeamByMatch((prev) => ({ ...prev, [match.id]: value }));
                                  }}
                                  className="bg-surface-container-lowest border border-outline-variant/30 rounded px-2 py-1.5 text-xs text-on-surface"
                                >
                                  <option value="home">Home scored</option>
                                  <option value="away">Away scored</option>
                                </select>
                                <input
                                  type="number"
                                  min={0}
                                  step="1"
                                  placeholder="Time (seconds)"
                                  value={selectedGoalSeconds}
                                  onChange={(event) =>
                                    setManualGoalSecondsByMatch((prev) => ({
                                      ...prev,
                                      [match.id]: event.target.value,
                                    }))
                                  }
                                  className="bg-surface-container-lowest border border-outline-variant/30 rounded px-2 py-1.5 text-xs text-on-surface"
                                />
                                <button
                                  type="button"
                                  disabled={isMarkingGoal}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleMarkGoalEvent(match.id);
                                  }}
                                  className="px-3 py-1.5 text-[10px] font-bold tracking-widest uppercase rounded-full border border-[#60a5fa]/50 text-[#93c5fd] hover:bg-[#1d4ed8]/20 transition-all disabled:opacity-60"
                                >
                                  {isMarkingGoal ? "Marking..." : "Mark Goal"}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}

                {completedMatches.length > 0 && (
                  <section className="space-y-4">
                    <div>
                      <h2 className="text-2xl font-bold text-on-surface">Completed Matches</h2>
                      <p className="text-on-surface-variant text-sm">Reprocess any completed match with one click.</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                      {completedMatches.map((match) => {
                        const eventCount = match.event_count || 0;
                        const isReprocessing = reprocessingMatchIds.includes(match.id);
                        return (
                          <div
                            key={match.id}
                            className="glass-card p-6 rounded-xl relative overflow-hidden group transition-all cursor-pointer"
                            onClick={() => router.push(`/analysis?id=${match.id}`)}
                          >
                            <div className="flex justify-between items-start mb-4 gap-3">
                              <div className="flex-grow">
                                <h3 className="text-lg font-bold text-on-surface mb-2">
                                  {match.title ?? "Match analysis"}
                                </h3>
                                <p className="text-sm text-on-surface-variant">
                                  Teams: {getTeamName(match.home_team_id)} vs {getTeamName(match.away_team_id)}
                                </p>
                              </div>
                              <span className="px-3 py-1 bg-green-500/20 border border-green-500/40 text-green-300 text-xs font-bold tracking-widest rounded-full whitespace-nowrap">
                                COMPLETE
                              </span>
                            </div>

                            <div className="mb-4 rounded-lg overflow-hidden border border-outline-variant/20 bg-black/40 aspect-video">
                              <MatchCardPreview idSuffix={`complete-${match.id}`} />
                            </div>

                            <div className="mt-3 flex items-center justify-between gap-4">
                              <p className="text-xs text-on-surface-variant/80">
                                {eventCount} events generated
                              </p>
                              <button
                                type="button"
                                disabled={isReprocessing}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleReprocessMatch(match.id);
                                }}
                                className="px-3 py-1.5 text-[10px] font-bold tracking-widest uppercase rounded-full border border-[#60a5fa]/50 text-[#93c5fd] hover:bg-[#1d4ed8]/20 transition-all disabled:opacity-60"
                              >
                                {isReprocessing ? "Reprocessing..." : "Reprocess"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}
              </>
            )}
          </main>
        </div>
      </>
    </AuthGuard>
  );
}
