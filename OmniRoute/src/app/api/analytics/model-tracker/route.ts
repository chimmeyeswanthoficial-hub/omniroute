import { NextResponse } from "next/server";
import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import {
  getModelTrackerTotals,
  getModelTrackerRows,
  getAutoRouterPicks,
  getAutoRouterTotal,
} from "@/lib/db/modelTracker";

export const dynamic = "force-dynamic";

const VALID_RANGES = new Set(["1d", "7d", "30d", "90d", "all"]);

function getRangeStartIso(range: string): string | null {
  if (range === "all" || !VALID_RANGES.has(range)) return null;
  const end = new Date();
  const start = new Date(end);
  const days = Number(range.slice(0, -1));
  start.setDate(start.getDate() - days);
  return start.toISOString();
}

/**
 * GET /api/analytics/model-tracker?range=1d|7d|30d|90d|all
 *
 * Model Tracker data:
 *  - `totals`: request/token aggregates for all model traffic in the range
 *  - `models`: per-resolved-model usage rows ranked by request count
 *    (each row carries its % of total requests/tokens, precomputed)
 *  - `autoRouter`: pick distribution of the built-in router — how many
 *    `auto`/`max` requests landed on each resolved model (the "which model
 *    is max using the most" view), with % of router picks
 */
export async function GET(request: Request) {
  const authError = await requireManagementAuth(request);
  if (authError) return authError;

  try {
    const range = new URL(request.url).searchParams.get("range") || "7d";
    const sinceIso = getRangeStartIso(range);

    const totals = getModelTrackerTotals(sinceIso);
    const rows = getModelTrackerRows(sinceIso, 100);
    const models = rows.map((row) => ({
      ...row,
      requestPct: totals.requests > 0 ? Number(((row.requests / totals.requests) * 100).toFixed(2)) : 0,
      tokenPct: totals.totalTokens > 0 ? Number(((row.totalTokens / totals.totalTokens) * 100).toFixed(2)) : 0,
    }));

    const autoRouterTotal = getAutoRouterTotal(sinceIso);
    const autoRouterPicks = getAutoRouterPicks(sinceIso, 50).map((pick) => ({
      ...pick,
      pickPct: autoRouterTotal > 0 ? Number(((pick.picks / autoRouterTotal) * 100).toFixed(2)) : 0,
    }));

    return NextResponse.json({
      range,
      totals: {
        ...totals,
        successRatePct:
          totals.requests > 0
            ? Number(((totals.successfulRequests / totals.requests) * 100).toFixed(2))
            : 0,
      },
      models,
      autoRouter: {
        totalRequests: autoRouterTotal,
        picks: autoRouterPicks,
      },
    });
  } catch (error) {
    console.error("Model tracker analytics error:", error);
    return NextResponse.json(
      { error: "Failed to load model tracker" },
      { status: 500 }
    );
  }
}
