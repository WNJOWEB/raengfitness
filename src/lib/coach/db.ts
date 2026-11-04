import { supabaseConfig, type Env, type SupabaseConfig } from "../env";

/**
 * The coach portal's database access: Supabase's PostgREST API with the
 * secret key, on the server only (like request-store.ts). Callers must have
 * run requireCoach() first. Every call returns a result instead of throwing,
 * so pages can show a clear "couldn't load" state.
 *
 * Logs carry the operation, relation and error code only: never row data,
 * error messages (which can quote values) or keys.
 */

export interface Db {
  config: SupabaseConfig;
  fetchImpl: typeof fetch;
}

export type DbErrorKind =
  /** Network failure, timeout or a 5xx. */
  | "unavailable"
  /** The portal tables don't exist yet (migration not applied). */
  | "not-set-up"
  /** A unique, foreign-key or overlap constraint said no. */
  | "conflict"
  /** One of the portal's own rules (raised as "akb:<rule>"). */
  | "rule"
  /** Bad input that got past validation (shouldn't happen). */
  | "invalid";

export interface DbError {
  kind: DbErrorKind;
  /** Postgres or PostgREST error code, e.g. 23505. */
  code: string;
  /** For kind "rule": e.g. "class_full". */
  rule?: string;
  /** For kind "conflict": the constraint, when Postgres names it. */
  constraint?: string;
}

export type DbResult<T> = { ok: true; data: T } | { ok: false; error: DbError };

export type Query = ReadonlyArray<readonly [string, string]>;

export function coachDb(env: Env = process.env, fetchImpl: typeof fetch = fetch): Db | null {
  const config = supabaseConfig(env);
  return config ? { config, fetchImpl } : null;
}

const TIMEOUT_MS = 10_000;

function headers(db: Db, extra: Record<string, string> = {}): Record<string, string> {
  // The apikey header alone, as in request-store.ts: Supabase's gateway turns a
  // secret key into the service role. (Secret keys aren't JWTs, so no Authorization header.)
  return { apikey: db.config.secretKey, "Content-Type": "application/json", ...extra };
}

function url(db: Db, path: string, query: Query = []): string {
  const search = new URLSearchParams();
  for (const [key, value] of query) search.append(key, value);
  const qs = search.toString();
  return `${db.config.url}/rest/v1/${path}${qs ? `?${qs}` : ""}`;
}

async function toError(response: Response, op: string, target: string): Promise<DbError> {
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    // No JSON body: treated by status below.
  }
  const code = typeof body.code === "string" ? body.code : String(response.status);
  const message = typeof body.message === "string" ? body.message : "";
  let error: DbError;
  if (code === "PGRST205" || code === "PGRST202" || code === "42P01" || code === "42883") {
    error = { kind: "not-set-up", code };
  } else if (message.startsWith("akb:")) {
    error = { kind: "rule", code, rule: message.slice(4) };
  } else if (response.status === 409) {
    const constraint = /constraint "([a-z0-9_]+)"/.exec(message)?.[1];
    error = { kind: "conflict", code, ...(constraint ? { constraint } : {}) };
  } else if (response.status >= 500 || response.status === 401 || response.status === 403) {
    error = { kind: "unavailable", code };
  } else {
    error = { kind: "invalid", code };
  }
  // A rule the database enforces (already a member, class full, a wrong code...) is an expected answer the
  // page shows the visitor, not a fault: logged as information so the error list shows only real problems.
  if (error.kind === "rule") console.info(`Database: ${op} ${target} refused (${error.rule})`);
  else console.error(`Database: ${op} ${target} failed (${response.status} ${code})`);
  return error;
}

async function call<T>(db: Db, op: string, target: string, path: string, init: RequestInit, query: Query = []): Promise<DbResult<T>> {
  try {
    const response = await db.fetchImpl(url(db, path, query), {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, error: await toError(response, op, target) };
    const text = await response.text();
    return { ok: true, data: (text ? JSON.parse(text) : null) as T };
  } catch {
    console.error(`Database: ${op} ${target} failed (network)`);
    return { ok: false, error: { kind: "unavailable", code: "network" } };
  }
}

/** Rows of a table or view. `query` uses PostgREST syntax, e.g. [["status", "eq.new"], ["order", "created_at.desc"]]. */
export function select<T>(db: Db, relation: string, query: Query = []): Promise<DbResult<T[]>> {
  const q: Query = query.some(([k]) => k === "select") ? query : [["select", "*"], ...query];
  return call<T[]>(db, "select", relation, relation, { method: "GET", headers: headers(db) }, q);
}

/** One row by id, or null. */
export async function selectOne<T>(db: Db, relation: string, id: string): Promise<DbResult<T | null>> {
  if (!isUuid(id)) return { ok: true, data: null };
  const result = await select<T>(db, relation, [["id", `eq.${id}`], ["limit", "1"]]);
  return result.ok ? { ok: true, data: result.data[0] ?? null } : result;
}

export function insert<T>(db: Db, table: string, rows: Record<string, unknown> | Record<string, unknown>[]): Promise<DbResult<T[]>> {
  return call<T[]>(db, "insert", table, table, {
    method: "POST",
    headers: headers(db, { Prefer: "return=representation" }),
    body: JSON.stringify(rows),
  });
}

/** Updates the rows matching `filters` (at least one filter is required). */
export function update<T>(db: Db, table: string, filters: Query, patch: Record<string, unknown>): Promise<DbResult<T[]>> {
  if (filters.length === 0) throw new Error("update needs a filter");
  return call<T[]>(
    db,
    "update",
    table,
    table,
    { method: "PATCH", headers: headers(db, { Prefer: "return=representation" }), body: JSON.stringify(patch) },
    filters,
  );
}

export function remove(db: Db, table: string, filters: Query): Promise<DbResult<null>> {
  if (filters.length === 0) throw new Error("remove needs a filter");
  return call<null>(db, "delete", table, table, { method: "DELETE", headers: headers(db) }, filters);
}

/** Calls a Postgres function (one transaction). */
export function rpc<T>(db: Db, fn: string, args: Record<string, unknown>): Promise<DbResult<T>> {
  return call<T>(db, "rpc", fn, `rpc/${fn}`, { method: "POST", headers: headers(db), body: JSON.stringify(args) });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** PostgREST `in.(…)` list; ids are checked so nothing can break out of the list. */
export function inList(ids: readonly string[]): string {
  const safe = ids.filter(isUuid);
  return `in.(${safe.join(",")})`;
}

/** Search text safe to put inside an `ilike` pattern within or=(…). */
export function searchTerm(raw: string): string {
  return raw.replace(/[^\p{L}\p{N}@.+\-' ]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

type DataOf<R> = Extract<R, { ok: true }> extends { data: infer T } ? T : never;

/** Several results as one: all the data, or the first error. */
export function collect<const R extends readonly DbResult<unknown>[]>(results: R): DbResult<{ -readonly [K in keyof R]: DataOf<R[K]> }> {
  for (const r of results) if (!r.ok) return r;
  return { ok: true, data: results.map((r) => (r as { data: unknown }).data) as { -readonly [K in keyof R]: DataOf<R[K]> } };
}
