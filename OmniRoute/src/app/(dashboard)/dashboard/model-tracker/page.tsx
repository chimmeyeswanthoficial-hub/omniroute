"use client";

/**
 * Model Tracker
 *
 * Answers "which model am I actually using the most?":
 *  - Per-model usage ranked by request share (with token share) across a
 *    selectable time range, straight from call_logs.
 *  - "Router picks": how the built-in auto/max router distributed its
 *    requests across concrete models (requested_model with the auto or
 *    max prefix → resolved model), so you can see what `max` is
 *    resolving to most.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { Card } from "@/shared/components";

type Range = "1d" | "7d" | "30d" | "90d" | "all";

const RANGES: Range[] = ["1d", "7d", "30d", "90d", "all"];

interface Totals {
  requests: number;
  successfulRequests: number;
  tokensIn: number;
  tokensOut: number;
  totalTokens: number;
  modelsUsed: number;
  successRatePct: number;
}

interface ModelRow {
  model: string;
  provider: string;
  requests: number;
  successfulRequests: number;
  tokensIn: number;
  tokensOut: number;
  totalTokens: number;
  avgDurationMs: number;
  lastUsed: string;
  requestPct: number;
  tokenPct: number;
}

interface PickRow {
  model: string;
  provider: string;
  picks: number;
  successfulPicks: number;
  tokensIn: number;
  tokensOut: number;
  avgDurationMs: number;
  pickPct: number;
}

interface TrackerData {
  range: Range;
  totals: Totals;
  models: ModelRow[];
  autoRouter: {
    totalRequests: number;
    picks: PickRow[];
  };
}

type SortKey = "requests" | "totalTokens" | "avgDurationMs" | "successfulRequests";
type SortDir = "asc" | "desc";

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
    value
  );
}

function formatLatency(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatLastUsed(iso: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function PctBar({ pct, className = "bg-primary" }: { pct: number; className?: string }) {
  const width = Math.max(0, Math.min(100, pct));
  return (
    <div className="h-1.5 w-full min-w-[64px] overflow-hidden rounded-full bg-muted/40">
      <div className={`h-full rounded-full ${className}`} style={{ width: `${width}%` }} />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  iconClass,
}: {
  label: string;
  value: string;
  icon: string;
  iconClass: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3 mb-2">
        <div className={`flex items-center justify-center size-8 rounded-lg ${iconClass}`}>
          <span className="material-symbols-outlined text-[18px]">{icon}</span>
        </div>
        <span className="text-sm text-text-muted">{label}</span>
      </div>
      <p className="text-xl font-semibold text-text-main">{value}</p>
    </Card>
  );
}

export default function ModelTrackerPage() {
  const [range, setRange] = useState<Range>("7d");
  const [data, setData] = useState<TrackerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("requests");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const load = useCallback(async (nextRange: Range) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/analytics/model-tracker?range=${nextRange}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as TrackerData;
      setData(json);
    } catch (err) {
      console.error("Model tracker failed to load:", err);
      setError("Could not load model usage data. Is the database available?");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(range);
  }, [range, load]);

  const sortedModels = useMemo(() => {
    if (!data) return [];
    const rows = [...data.models];
    rows.sort((a, b) => {
      const va = Number(a[sortKey] ?? 0);
      const vb = Number(b[sortKey] ?? 0);
      return sortDir === "desc" ? vb - va : va - vb;
    });
    return rows;
  }, [data, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const totals = data?.totals;
  const topModel = data?.models[0];
  const autoRouter = data?.autoRouter;

  const sortIndicator = (key: SortKey) =>
    key === sortKey ? (sortDir === "desc" ? "arrow_downward" : "arrow_upward") : "unfold_more";

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-main flex items-center gap-2">
            <span className="material-symbols-outlined text-[22px] text-primary">query_stats</span>
            Model Tracker
          </h1>
          <p className="text-sm text-text-muted mt-0.5">
            Which model is used the most — by request share, token share, and router picks
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-muted/30 p-1">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                range === r
                  ? "bg-primary text-primary-foreground"
                  : "text-text-muted hover:text-text-main"
              }`}
            >
              {r.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <Card className="p-4 border-red-500/30 bg-red-500/5">
          <p className="text-sm text-red-400">{error}</p>
        </Card>
      )}

      {loading && !data ? (
        <Card className="p-10 text-center">
          <span className="material-symbols-outlined animate-spin text-[28px] text-primary">
            progress_activity
          </span>
          <p className="mt-3 text-sm text-text-muted">Loading model usage…</p>
        </Card>
      ) : (
        <>
          {totals && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <SummaryCard
                label="Total requests"
                value={formatNumber(totals.requests)}
                icon="swap_horiz"
                iconClass="bg-primary/10 text-primary"
              />
              <SummaryCard
                label="Total tokens"
                value={formatCompact(totals.totalTokens)}
                icon="token"
                iconClass="bg-blue-500/10 text-blue-500"
              />
              <SummaryCard
                label="Models used"
                value={formatNumber(totals.modelsUsed)}
                icon="model_training"
                iconClass="bg-purple-500/10 text-purple-500"
              />
              <SummaryCard
                label="Success rate"
                value={`${totals.successRatePct}%`}
                icon="check_circle"
                iconClass="bg-green-500/10 text-green-500"
              />
            </div>
          )}

          <Card className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-text-main flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-primary">
                  autopilot
                </span>
                Router picks — where <code className="text-sm">max</code> /{" "}
                <code className="text-sm">auto</code> sends requests
              </h2>
              {autoRouter && autoRouter.totalRequests > 0 && (
                <span className="text-sm text-text-muted">
                  {formatNumber(autoRouter.totalRequests)} routed requests
                </span>
              )}
            </div>

            {!autoRouter || autoRouter.totalRequests === 0 ? (
              <div className="rounded-lg border border-dashed border-muted/60 p-6 text-center">
                <span className="material-symbols-outlined text-[32px] text-text-muted">
                  routes
                </span>
                <p className="mt-2 text-sm text-text-muted">
                  No <code>auto</code> / <code>max</code> requests in this range yet.
                </p>
                <p className="mt-1 text-sm text-text-muted">
                  Set <code>model: "max"</code> in any tool (Claude Code, Cursor, OpenAI SDK…) and
                  the router&apos;s pick distribution will show up here.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {autoRouter.picks.slice(0, 12).map((pick) => (
                  <div key={`${pick.provider}/${pick.model}`} className="flex items-center gap-3">
                    <span className="w-8 text-right text-xs font-mono text-text-muted">
                      {Math.round(pick.pickPct)}%
                    </span>
                    <div className="flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm text-text-main">
                          {pick.model}
                          <span className="ml-2 text-xs text-text-muted">{pick.provider}</span>
                        </span>
                        <span className="shrink-0 text-xs text-text-muted">
                          {formatNumber(pick.picks)} picks · {formatLatency(pick.avgDurationMs)}
                        </span>
                      </div>
                      <div className="mt-1">
                        <PctBar pct={pick.pickPct} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-text-main flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-primary">
                  table_chart
                </span>
                Model usage ranking
              </h2>
              {topModel && (
                <span className="text-sm text-text-muted">
                  Top: <span className="text-text-main">{topModel.model}</span> (
                  {topModel.requestPct}% of requests)
                </span>
              )}
            </div>

            {sortedModels.length === 0 ? (
              <div className="rounded-lg border border-dashed border-muted/60 p-6 text-center">
                <p className="text-sm text-text-muted">No model traffic recorded in this range.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-muted/40 text-left text-xs uppercase tracking-wide text-text-muted">
                      <th className="py-2 pr-2 w-8">#</th>
                      <th className="py-2 pr-3">Model</th>
                      <th className="py-2 pr-3 cursor-pointer select-none" onClick={() => toggleSort("requests")}>
                        Requests <span className="material-symbols-outlined text-[14px] align-middle">{sortIndicator("requests")}</span>
                      </th>
                      <th className="py-2 pr-3">Share</th>
                      <th className="py-2 pr-3 cursor-pointer select-none" onClick={() => toggleSort("totalTokens")}>
                        Tokens <span className="material-symbols-outlined text-[14px] align-middle">{sortIndicator("totalTokens")}</span>
                      </th>
                      <th className="py-2 pr-3 cursor-pointer select-none" onClick={() => toggleSort("avgDurationMs")}>
                        Avg latency <span className="material-symbols-outlined text-[14px] align-middle">{sortIndicator("avgDurationMs")}</span>
                      </th>
                      <th className="py-2 pr-3 cursor-pointer select-none" onClick={() => toggleSort("successfulRequests")}>
                        Success <span className="material-symbols-outlined text-[14px] align-middle">{sortIndicator("successfulRequests")}</span>
                      </th>
                      <th className="py-2">Last used</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedModels.map((row, index) => {
                      const successRate =
                        row.requests > 0
                          ? ((row.successfulRequests / row.requests) * 100).toFixed(1)
                          : "0";
                      return (
                        <tr
                          key={`${row.provider}/${row.model}`}
                          className="border-b border-muted/20 hover:bg-muted/20"
                        >
                          <td className="py-2 pr-2 text-text-muted">{index + 1}</td>
                          <td className="py-2 pr-3">
                            <span className="font-medium text-text-main">{row.model}</span>
                            <span className="ml-2 text-xs text-text-muted">{row.provider}</span>
                          </td>
                          <td className="py-2 pr-3 font-mono text-text-main">
                            {formatNumber(row.requests)}
                          </td>
                          <td className="py-2 pr-3">
                            <div className="flex items-center gap-2">
                              <PctBar pct={row.requestPct} />
                              <span className="w-14 text-right font-mono text-xs text-text-muted">
                                {row.requestPct}%
                              </span>
                            </div>
                          </td>
                          <td className="py-2 pr-3 font-mono text-text-main">
                            {formatCompact(row.totalTokens)}
                          </td>
                          <td className="py-2 pr-3 text-text-main">{formatLatency(row.avgDurationMs)}</td>
                          <td className="py-2 pr-3 text-text-main">{successRate}%</td>
                          <td className="py-2 text-text-muted">{formatLastUsed(row.lastUsed)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {sortedModels.length > 0 && totals && (
                  <p className="mt-3 text-xs text-text-muted">
                    Showing top {sortedModels.length} of {formatNumber(totals.modelsUsed)} models ·
                    Share = % of all requests in range (tokens: % of all tokens)
                  </p>
                )}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
