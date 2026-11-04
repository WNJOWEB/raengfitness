import { rpc, type Db, type DbError, type DbResult } from "./coach/db";

/**
 * A member pausing their membership (owner, 2026-11-04; migration
 * 20261122000000, where the rules are written down): once, for one period,
 * starting when the period they are in ends, at most once every 6 months,
 * asked for before the next period is set up. Server only.
 */

export type PauseState = "none" | "scheduled" | "paused";
export type PauseBlock = "no_membership" | "pause_active" | "too_late" | "too_soon";

export interface PauseInfo {
  state: PauseState;
  can_pause: boolean;
  /** Why they can't pause now. */
  reason?: PauseBlock;
  /** The day the pause starts and the day the membership renews (when they can pause, or already have). */
  pause_from?: string;
  pause_until?: string;
  /** Too soon: the first day a new pause could start. */
  next_allowed_on?: string;
}

export const memberPauseInfo = (db: Db, clientId: string): Promise<DbResult<PauseInfo>> => rpc<PauseInfo>(db, "akb_member_pause_info", { p_client: clientId });

export interface PauseResult {
  pause_from: string;
  pause_until: string;
  plan_name: string;
}

export const pauseOwnMembership = (db: Db, clientId: string): Promise<DbResult<PauseResult>> => rpc<PauseResult>(db, "akb_member_pause", { p_client: clientId });

export interface UndoResult {
  renews_on: string;
  /** Whether the pause had already begun (a running pause is ended: the membership restarts today). */
  began: boolean;
}

export const undoOwnPause = (db: Db, clientId: string): Promise<DbResult<UndoResult>> => rpc<UndoResult>(db, "akb_member_pause_undo", { p_client: clientId });

const REASONS = new Set<string>(["no_membership", "pause_active", "pause_too_late", "pause_too_soon", "no_pause"]);

/** The ?error= code for a refusal, one of the account's messages. */
export function pauseErrorCode(error: DbError): string {
  if (error.kind === "rule" && error.rule && REASONS.has(error.rule)) return error.rule;
  return "failed";
}
