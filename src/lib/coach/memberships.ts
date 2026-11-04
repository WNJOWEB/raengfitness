import { BILLING_WEEKS, membershipPlans, type MembershipPlan } from "@/content/memberships";
import { inList, rpc, select, selectOne, type Db, type DbResult } from "./db";

/**
 * Memberships with class credits (migration 20261023000000_akb_memberships.sql).
 * A membership is one of the owner's plans for one client. Each four-week
 * period gets its credits and one charge; the database renews them, counts
 * the credits and applies the 24-hour cancellation rule.
 */

export type MembershipStatus = "active" | "paused" | "cancelled";
export const MEMBERSHIP_STATUSES: readonly MembershipStatus[] = ["active", "paused", "cancelled"];

export interface Membership {
  id: string;
  created_at: string;
  updated_at: string;
  client_id: string;
  request_id: string | null;
  plan: MembershipPlan["id"];
  plan_name: string;
  price_pence: number;
  credits: number;
  period_days: number;
  start_on: string;
  next_period_on: string;
  status: MembershipStatus;
  cancelled_on: string | null;
  notes: string;
}

export interface MembershipPeriod {
  id: string;
  membership_id: string;
  client_id: string;
  plan: MembershipPlan["id"];
  plan_name: string;
  period_start: string;
  period_end: string;
  credits: number;
  credits_used: number;
  credits_left: number;
  charge_id: string | null;
}

/** The plan as published (content/memberships.ts), or undefined. */
export function findPlan(id: string): MembershipPlan | undefined {
  return membershipPlans.find((p) => p.id === id);
}

export const PERIOD_DAYS = BILLING_WEEKS * 7;

export interface StartMembershipInput {
  clientId: string;
  plan: MembershipPlan["id"];
  startOn: string;
  requestId?: string | null;
  notes?: string;
}

/** Starts a membership on the published plan's price and credits, with its first period and charge. */
export async function startMembership(db: Db, input: StartMembershipInput): Promise<DbResult<string>> {
  const plan = findPlan(input.plan);
  if (!plan) return { ok: false, error: { kind: "invalid", code: "plan" } };
  return rpc<string>(db, "akb_start_membership", {
    p_client: input.clientId,
    p_plan: plan.id,
    p_plan_name: plan.name,
    p_price_pence: plan.priceGbp * 100,
    p_credits: plan.credits,
    p_start_on: input.startOn,
    p_request: input.requestId ?? null,
    p_notes: input.notes ?? "",
  });
}

export function listMemberships(db: Db, opts: { clientId?: string; status?: MembershipStatus | "" } = {}): Promise<DbResult<Membership[]>> {
  const query: [string, string][] = [];
  if (opts.clientId) query.push(["client_id", `eq.${opts.clientId}`]);
  if (opts.status) query.push(["status", `eq.${opts.status}`]);
  query.push(["order", "created_at.desc"], ["limit", "500"]);
  return select<Membership>(db, "akb_memberships", query);
}

export function getMembership(db: Db, id: string): Promise<DbResult<Membership | null>> {
  return selectOne<Membership>(db, "akb_memberships", id);
}

/** Periods (newest first) with credits used and left, for some memberships. */
export function listPeriods(db: Db, membershipIds: readonly string[]): Promise<DbResult<MembershipPeriod[]>> {
  if (membershipIds.length === 0) return Promise.resolve({ ok: true, data: [] });
  return select<MembershipPeriod>(db, "akb_membership_period_balances", [
    ["membership_id", inList(membershipIds)],
    ["order", "period_start.desc"],
    ["limit", "1000"],
  ]);
}

/** The client's period covering a date, if any (for paying a class place with a credit). */
export async function periodOn(db: Db, clientId: string, date: string): Promise<DbResult<MembershipPeriod | null>> {
  const r = await select<MembershipPeriod>(db, "akb_membership_period_balances", [
    ["client_id", `eq.${clientId}`],
    ["period_start", `lte.${date}`],
    ["period_end", `gte.${date}`],
    ["order", "period_start.desc"],
    ["limit", "1"],
  ]);
  return r.ok ? { ok: true, data: r.data[0] ?? null } : r;
}

export function setMembershipStatus(db: Db, id: string, status: MembershipStatus, on: string): Promise<DbResult<null>> {
  return rpc<null>(db, "akb_set_membership_status", { p_membership: id, p_status: status, p_on: on });
}

/** Creates every period that has begun by `today`. Returns how many. Safe to repeat. */
export function renewMemberships(db: Db, today: string): Promise<DbResult<number>> {
  return rpc<number>(db, "akb_renew_memberships", { p_today: today });
}

/** Pays for a class place with a credit from the member's period on that date. */
export function payWithCredit(db: Db, attendanceId: string): Promise<DbResult<string>> {
  return rpc<string>(db, "akb_use_membership_credit", { p_attendance: attendanceId });
}

/** Periods covering a date for several clients (the members on a class list). */
export function periodsOn(db: Db, clientIds: readonly string[], date: string): Promise<DbResult<MembershipPeriod[]>> {
  if (clientIds.length === 0) return Promise.resolve({ ok: true, data: [] });
  return select<MembershipPeriod>(db, "akb_membership_period_balances", [
    ["client_id", inList(clientIds)],
    ["period_start", `lte.${date}`],
    ["period_end", `gte.${date}`],
    ["limit", "1000"],
  ]);
}

/**
 * Catches up renewals the daily job hasn't made yet (no CRON_SECRET, or a
 * missed run): safe to call on every portal visit, since the database creates
 * each period once. A failure only logs; the pages still load.
 */
export async function catchUpRenewals(db: Db, today: string): Promise<void> {
  const result = await renewMemberships(db, today);
  if (!result.ok) console.error(`Membership renewals catch-up failed (${result.error.kind})`);
}

/** Every membership period covering a date (for the dashboard). */
export function currentPeriods(db: Db, date: string): Promise<DbResult<MembershipPeriod[]>> {
  return select<MembershipPeriod>(db, "akb_membership_period_balances", [["period_start", `lte.${date}`], ["period_end", `gte.${date}`], ["limit", "1000"]]);
}

/** Gives back a forfeited credit (the coach cancelled the class, or goodwill). */
export function returnCredit(db: Db, attendanceId: string): Promise<DbResult<null>> {
  return rpc<null>(db, "akb_return_credit", { p_attendance: attendanceId });
}

/** Adds or takes away credits on a period (the credit adjuster; migration 20261121000000). Returns the new total. */
export function adjustCredits(db: Db, periodId: string, delta: number, reason: string): Promise<DbResult<number>> {
  return rpc<number>(db, "akb_adjust_period_credits", { p_period: periodId, p_delta: delta, p_reason: reason });
}

/** "3 of 8 credits left" */
export function creditsLine(period: Pick<MembershipPeriod, "credits" | "credits_left">): string {
  return `${period.credits_left} of ${period.credits} credit${period.credits === 1 ? "" : "s"} left`;
}
