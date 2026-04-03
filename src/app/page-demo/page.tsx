"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  Bell,
  ChevronRight,
  Info,
  Settings,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";

type Metric = {
  label: string;
  value: string;
  confidence: number;
  evidenceAt: string;
};

const METRICS: Metric[] = [
  { label: "TAS v1", value: "90.0 pts", confidence: 78, evidenceAt: "6:01" },
  { label: "Synchrony", value: "100.0%", confidence: 74, evidenceAt: "6:01" },
  { label: "Compactness", value: "100.0%", confidence: 71, evidenceAt: "6:01" },
  { label: "Recovery Latency", value: "1.8s", confidence: 65, evidenceAt: "5:10" },
  { label: "Transition Reaction", value: "2.4s", confidence: 67, evidenceAt: "4:44" },
];

const EVENTS = [
  { type: "player_tracking", at: "6:01", text: "Home_Midfielder_1 at (754.4, 585.0), conf 0.80" },
  { type: "unit_dislocation", at: "5:10", text: "Away rear line stretched by 11.8m, lane exposure increased." },
  { type: "sync_snapshot", at: "4:44", text: "Collective spacing tightened, TAS rebounded to 89.6." },
  { type: "summary", at: "0:00", text: "Analysis complete. Defence lines and midfield synchronisation insights recorded." },
];

function DemoMetricCard({ metric }: { metric: Metric }) {
  return (
    <article className="rounded-2xl border border-outline-variant/30 bg-surface-container-high/70 p-5 backdrop-blur-xl shadow-[0_20px_40px_rgba(0,0,0,0.25)]">
      <p className="text-[10px] uppercase tracking-[0.24em] text-on-surface-variant font-semibold">{metric.label}</p>
      <p className="mt-2 text-2xl font-black tracking-tight text-on-surface">{metric.value}</p>
      <p className="mt-1 text-[11px] text-on-surface-variant">Confidence {metric.confidence}%</p>
      <div className="mt-3 h-1.5 w-full rounded-full bg-surface-container-low">
        <div
          className="h-1.5 rounded-full bg-primary transition-all duration-700"
          style={{ width: `${metric.confidence}%` }}
        />
      </div>
      <p className="mt-3 text-[11px] uppercase tracking-[0.2em] text-on-surface-variant">Evidence at {metric.evidenceAt}</p>
    </article>
  );
}

export default function PageDemo() {
  const [activeSection, setActiveSection] = useState("Overview");

  const score = useMemo(() => 90, []);
  const gaugeDash = 151;
  const gaugeOffset = gaugeDash - (gaugeDash * score) / 100;

  return (
    <div className="min-h-screen bg-surface text-on-surface">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-24 -left-24 h-80 w-80 rounded-full bg-primary/15 blur-[120px]" />
        <div className="absolute -bottom-24 -right-24 h-80 w-80 rounded-full bg-tertiary/15 blur-[120px]" />
      </div>

      <header className="sticky top-0 z-40 border-b border-outline-variant/30 bg-surface/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <p className="text-lg font-black tracking-tight">TEAMOVIA AI</p>
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
              Demo
            </span>
          </div>
          <div className="flex items-center gap-2 text-on-surface-variant">
            <button className="rounded-full p-2 hover:bg-surface-container-highest" aria-label="Notifications">
              <Bell size={18} />
            </button>
            <button className="rounded-full p-2 hover:bg-surface-container-highest" aria-label="Settings">
              <Settings size={18} />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl grid-cols-12 gap-6 px-4 py-8 sm:px-6 lg:px-8">
        <aside className="col-span-12 rounded-2xl border border-outline-variant/30 bg-surface-container/65 p-3 backdrop-blur-xl lg:col-span-3 lg:h-fit">
          <div className="grid grid-cols-3 gap-2 lg:grid-cols-1">
            {["Overview", "Performance", "Resilience"].map((item) => (
              <button
                key={item}
                onClick={() => setActiveSection(item)}
                className={`rounded-xl px-3 py-2 text-left text-xs font-bold uppercase tracking-[0.14em] transition ${
                  activeSection === item
                    ? "bg-primary/15 text-primary border border-primary/30"
                    : "text-on-surface-variant hover:bg-surface-container-high"
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        </aside>

        <main className="col-span-12 space-y-6 lg:col-span-9">
          <section className="rounded-2xl border border-outline-variant/30 bg-surface-container-highest/75 p-6 backdrop-blur-xl shadow-[0_24px_50px_rgba(0,0,0,0.25)]">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-on-surface-variant font-semibold">
                  <span>Dashboard</span>
                  <ChevronRight size={12} />
                  <span>Match Analysis</span>
                  <ChevronRight size={12} />
                  <span className="text-primary">Tactical Scan</span>
                </p>
                <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">SynIQ Index v2.4</h1>
                <p className="mt-2 text-sm text-on-surface-variant">Collective Synchronisation Analytics • Static Demo View</p>
              </div>

              <div className="flex items-center gap-5 rounded-full border border-primary/30 bg-surface-container-high px-5 py-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">Team Aptitude Score</p>
                  <p className="text-2xl font-black text-primary">{score}.0 TAS</p>
                </div>
                <div className="relative h-14 w-14">
                  <svg className="h-full w-full -rotate-90" aria-hidden="true">
                    <circle cx="28" cy="28" r="24" fill="transparent" stroke="currentColor" strokeWidth="4" className="text-surface" />
                    <circle
                      cx="28"
                      cy="28"
                      r="24"
                      fill="transparent"
                      stroke="currentColor"
                      strokeWidth="4"
                      strokeDasharray={gaugeDash}
                      strokeDashoffset={gaugeOffset}
                      strokeLinecap="round"
                      className="text-primary transition-all duration-700"
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-primary">
                    <Zap size={16} />
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-outline-variant/30 bg-surface-container-high p-4">
                <p className="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">Live Data</p>
                <p className="mt-2 text-lg font-bold">99.2% Accuracy</p>
              </div>
              <div className="rounded-xl border border-outline-variant/30 bg-surface-container-high p-4">
                <p className="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">Events Tracked</p>
                <p className="mt-2 text-lg font-bold">7</p>
              </div>
              <div className="rounded-xl border border-outline-variant/30 bg-surface-container-high p-4">
                <p className="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">Status</p>
                <p className="mt-2 inline-flex items-center gap-2 rounded-full border border-green-400/30 bg-green-400/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-green-300">
                  <Activity size={12} /> Completed
                </p>
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-5">
            {METRICS.map((metric) => (
              <DemoMetricCard key={metric.label} metric={metric} />
            ))}
          </section>

          <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <article className="rounded-2xl border border-outline-variant/30 bg-surface-container-high/75 p-6 lg:col-span-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-black uppercase tracking-[0.2em]">Key Incident Analysis</h2>
                <span className="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">Demo Table</span>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">
                    <tr>
                      <th className="pb-3 pr-3">Timestamp</th>
                      <th className="pb-3 pr-3">Event</th>
                      <th className="pb-3 pr-3 text-center">TAS</th>
                      <th className="pb-3 text-right">Trend</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-outline-variant/30">
                      <td className="py-4 pr-3 text-on-surface-variant">14 MAR</td>
                      <td className="py-4 pr-3 font-semibold">Lead Expansion (Yates)</td>
                      <td className="py-4 pr-3 text-center">88.4</td>
                      <td className="py-4 text-right text-green-300"><TrendingUp size={16} className="inline" /></td>
                    </tr>
                    <tr className="border-t border-outline-variant/30">
                      <td className="py-4 pr-3 text-on-surface-variant">14 MAR</td>
                      <td className="py-4 pr-3 font-semibold">Concession Phase</td>
                      <td className="py-4 pr-3 text-center">58.9</td>
                      <td className="py-4 text-right text-rose-300"><TrendingDown size={16} className="inline" /></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </article>

            <article className="rounded-2xl border border-outline-variant/30 bg-surface-container-high/75 p-6">
              <div className="flex items-center gap-2">
                <ShieldAlert size={18} className="text-primary" />
                <h2 className="text-sm font-black uppercase tracking-[0.2em]">Resilience Timeline</h2>
              </div>
              <ul className="mt-4 space-y-4">
                {EVENTS.map((event) => (
                  <li key={`${event.type}-${event.at}`} className="rounded-xl border border-outline-variant/25 bg-surface-container px-3 py-3">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant">
                      {event.type} • {event.at}
                    </p>
                    <p className="mt-1 text-sm">{event.text}</p>
                  </li>
                ))}
              </ul>
              <div className="mt-5 rounded-xl border border-primary/30 bg-primary/10 p-3 text-xs">
                <p className="flex items-start gap-2 text-on-surface">
                  <Info size={14} className="mt-0.5 text-primary" />
                  AI Explainability: SynIQ confidence is primarily weighted by spacing compactness and transition recovery windows.
                </p>
              </div>
            </article>
          </section>
        </main>
      </div>
    </div>
  );
}
