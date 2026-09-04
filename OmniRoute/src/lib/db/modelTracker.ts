/**
 * Model Tracker — per-model usage analytics over `call_logs`.
 *
 * Answers two questions:
 *   1. Which model is used the most? (by request share, token share, cost-
 *      independent of pricing — token counts are recorded on every call)
 *   2. Where does the `auto`/`max` router send requests? (requested_model
 *      auto* / max* → resolved model), so the operator can see the pick
 *      distribution of the built-in router.
 *
 * `call_logs.model` is the RESOLVED (serving) model; `requested_model` keeps
 * the client-requested id (e.g. `auto`, `auto/best-coding`, `max`).
 */

import { getDbInstance } from "./core";

export interface ModelTrackerTotalsRow {
  requests: number;
  successfulRequests: number;
  tokensIn: number;
  tokensOut: number;
  totalTokens: number;
  modelsUsed: number;
}

export interface ModelTrackerRow {
  model: string;
  provider: string;
  requests: number;
  successfulRequests: number;
  tokensIn: number;
  tokensOut: number;
  totalTokens: number;
  avgDurationMs: number;
  lastUsed: string;
}

export interface AutoRouterPickRow {
  model: string;
  provider: string;
  picks: number;
  successfulPicks: number;
  tokensIn: number;
  tokensOut: number;
  avgDurationMs: number;
}

function rangeCondition(sinceIso: string | null): { sql: string; params: Record<string, string> } {
  if (!sinceIso) return { sql: "", params: {} };
  return { sql: " AND timestamp >= @sinceIso", params: { sinceIso } };
}

/**
 * Aggregate totals for every call-log row that carries a resolved model
 * (chat/model traffic only — non-chat rows have `model` NULL).
 */
export function getModelTrackerTotals(sinceIso: string | null): ModelTrackerTotalsRow {
  const db = getDbInstance();
  const { sql, params } = rangeCondition(sinceIso);
  const row = db
    .prepare(
      `
      SELECT
        COUNT(*) as requests,
        COALESCE(SUM(CASE WHEN status >= 200 AND status < 400 THEN 1 ELSE 0 END), 0) as successfulRequests,
        COALESCE(SUM(tokens_in), 0) as tokensIn,
        COALESCE(SUM(tokens_out), 0) as tokensOut,
        COALESCE(SUM(tokens_in + tokens_out), 0) as totalTokens,
        COUNT(DISTINCT LOWER(model)) as modelsUsed
      FROM call_logs
      WHERE model IS NOT NULL AND model != ''${sql}
    `
    )
    .get(params) as ModelTrackerTotalsRow | undefined;
  return row ?? {
    requests: 0,
    successfulRequests: 0,
    tokensIn: 0,
    tokensOut: 0,
    totalTokens: 0,
    modelsUsed: 0,
  };
}

/**
 * Per-resolved-model usage rows, ranked by request count. `sinceIso` is an
 * inclusive ISO-8601 lower bound (null = all time).
 */
export function getModelTrackerRows(
  sinceIso: string | null,
  limit = 100
): ModelTrackerRow[] {
  const db = getDbInstance();
  const { sql, params } = rangeCondition(sinceIso);
  return db
    .prepare(
      `
      SELECT
        LOWER(model) as model,
        LOWER(COALESCE(NULLIF(provider, ''), 'unknown')) as provider,
        COUNT(*) as requests,
        COALESCE(SUM(CASE WHEN status >= 200 AND status < 400 THEN 1 ELSE 0 END), 0) as successfulRequests,
        COALESCE(SUM(tokens_in), 0) as tokensIn,
        COALESCE(SUM(tokens_out), 0) as tokensOut,
        COALESCE(SUM(tokens_in + tokens_out), 0) as totalTokens,
        COALESCE(AVG(duration), 0) as avgDurationMs,
        COALESCE(MAX(timestamp), '') as lastUsed
      FROM call_logs
      WHERE model IS NOT NULL AND model != ''${sql}
      GROUP BY LOWER(model), LOWER(COALESCE(NULLIF(provider, ''), 'unknown'))
      ORDER BY requests DESC
      LIMIT @limit
    `
    )
    .all({ ...params, limit }) as ModelTrackerRow[];
}

/**
 * Pick distribution of the built-in router: for every request that arrived as
 * `auto` / `auto/*` / `max` / `max/*` (requested_model), which RESOLVED model
 * actually served it. `max` is an alias of `auto` at the routing entry point,
 * so both spellings are matched here for rows logged before and after aliasing.
 */
export function getAutoRouterPicks(sinceIso: string | null, limit = 50): AutoRouterPickRow[] {
  const db = getDbInstance();
  const { sql, params } = rangeCondition(sinceIso);
  const routerFilter =
    "(requested_model = 'auto' OR requested_model LIKE 'auto/%' " +
    "OR requested_model = 'max' OR requested_model LIKE 'max/%')";
  return db
    .prepare(
      `
      SELECT
        LOWER(model) as model,
        LOWER(COALESCE(NULLIF(provider, ''), 'unknown')) as provider,
        COUNT(*) as picks,
        COALESCE(SUM(CASE WHEN status >= 200 AND status < 400 THEN 1 ELSE 0 END), 0) as successfulPicks,
        COALESCE(SUM(tokens_in), 0) as tokensIn,
        COALESCE(SUM(tokens_out), 0) as tokensOut,
        COALESCE(AVG(duration), 0) as avgDurationMs
      FROM call_logs
      WHERE ${routerFilter} AND model IS NOT NULL AND model != ''${sql}
      GROUP BY LOWER(model), LOWER(COALESCE(NULLIF(provider, ''), 'unknown'))
      ORDER BY picks DESC
      LIMIT @limit
    `
    )
    .all({ ...params, limit }) as AutoRouterPickRow[];
}

export function getAutoRouterTotal(sinceIso: string | null): number {
  const db = getDbInstance();
  const { sql, params } = rangeCondition(sinceIso);
  const routerFilter =
    "(requested_model = 'auto' OR requested_model LIKE 'auto/%' " +
    "OR requested_model = 'max' OR requested_model LIKE 'max/%')";
  const row = db
    .prepare(`SELECT COUNT(*) as count FROM call_logs WHERE ${routerFilter}${sql}`)
    .get(params) as { count: number } | undefined;
  return row?.count ?? 0;
}
