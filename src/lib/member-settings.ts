import { arriveEarlyNote, groupClass } from "@/content/classes";
import { formatAddressLines } from "@/content/site";
import { publishedClasses } from "@/lib/class-sessions";
import { formatTime } from "@/lib/schedule";
import type { TimeOfDay } from "@/content/types";
import { rpc, type Db, type DbResult } from "./coach/db";
import { ACCOUNT_PATH, memberLinkOrigin } from "./member-auth";
import type { Env } from "./env";

/**
 * The account menu's settings (owner, 2026-10-28; migration
 * 20261031000000_akb_member_settings.sql): profile, devices, the private
 * calendar link and class reminders. Server only: these call the member
 * functions with the secret key, passing the signed-in client's id.
 */

export const PROFILE_PATH = "/account/profile";
export const SECURITY_PATH = "/account/security";
export const CALENDAR_SYNC_PATH = "/account/calendar-sync";
export const NOTIFICATIONS_PATH = "/account/notifications";
export const CALENDAR_FEED_PATH = "/account/calendar/feed";

export interface MemberSettings {
  name: string;
  email: string;
  phone: string;
  class_reminders: boolean;
  /** Also an email the day before each class (owner, 2026-11-03). */
  reminder_day_before?: boolean;
  calendar_feed: boolean;
}

export interface MemberDevice {
  id: string;
  device: string;
  signed_in_at: string;
  last_seen_at: string;
  current: boolean;
}

export const memberSettings = (db: Db, clientId: string) => rpc<MemberSettings>(db, "akb_member_settings_get", { p_client: clientId });

export const updateProfile = (db: Db, clientId: string, name: string, phone: string) =>
  rpc<null>(db, "akb_member_update_profile", { p_client: clientId, p_name: name, p_phone: phone });

export const setReminders = (db: Db, clientId: string, on: boolean) => rpc<null>(db, "akb_member_set_reminders", { p_client: clientId, p_on: on });

export const setDayBefore = (db: Db, clientId: string, on: boolean) => rpc<null>(db, "akb_member_set_day_before", { p_client: clientId, p_on: on });

export const labelSession = (db: Db, sessionHash: string, device: string) => rpc<null>(db, "akb_member_label_session", { p_session_hash: sessionHash, p_device: device });

export const memberDevices = (db: Db, clientId: string, currentHash: string) =>
  rpc<MemberDevice[]>(db, "akb_member_sessions_list", { p_client: clientId, p_current_hash: currentHash });

export const endOtherSession = (db: Db, clientId: string, sessionId: string, currentHash: string): Promise<DbResult<boolean>> =>
  rpc<boolean>(db, "akb_member_end_other_session", { p_client: clientId, p_session: sessionId, p_current_hash: currentHash });

export const setCalendarFeed = (db: Db, clientId: string, tokenHash: string) => rpc<null>(db, "akb_member_calendar_set", { p_client: clientId, p_token_hash: tokenHash });
export const turnOffCalendarFeed = (db: Db, clientId: string) => rpc<null>(db, "akb_member_calendar_off", { p_client: clientId });
export const calendarFeedClient = (db: Db, tokenHash: string) => rpc<string | null>(db, "akb_member_calendar_client", { p_token_hash: tokenHash });

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

/**
 * A short label from the browser's own description, so a member can tell their
 * phone from their laptop. Only the device and browser family are kept; the
 * user agent itself is never stored.
 */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Macintosh|Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /CrOS/.test(ua) ? "Chromebook" : /Linux/.test(ua) ? "Linux" : "";
  const browser = /Edg(e|A|iOS)?\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\/|FxiOS\//.test(ua) ? "Firefox" : /Chrome\/|CriOS\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return [os, browser].filter(Boolean).join(", ");
}

// ---------------------------------------------------------------------------
// Calendar link
// ---------------------------------------------------------------------------

/** The private link: the site's own address (never the Host header), then the token. */
export function calendarFeedUrl(token: string, env: Env = process.env): string {
  return `${memberLinkOrigin(env)}${CALENDAR_FEED_PATH}/${token}.ics`;
}

/** The same link for calendar apps that subscribe through the webcal scheme. */
export function webcalUrl(httpsUrl: string): string {
  return httpsUrl.replace(/^https?:/, "webcal:");
}

/** The token in /account/calendar/feed/<token>.ics (the ".ics" is optional). */
export function feedToken(segment: string): string {
  return segment.replace(/\.ics$/i, "");
}

// ---------------------------------------------------------------------------
// Class reminders
// ---------------------------------------------------------------------------

export interface DueReminder {
  attendance_id: string;
  name: string;
  email: string;
  starts_at: string;
  slot: string;
}

export const dueReminders = (db: Db, date: string) => rpc<DueReminder[]>(db, "akb_class_reminders_due", { p_date: date });
export const reminderSent = (db: Db, attendanceId: string) => rpc<null>(db, "akb_class_reminder_sent", { p_attendance: attendanceId });
/** Classes tomorrow (from `date`), for members who asked to be told the day before. */
export const dueDayBefore = (db: Db, date: string) => rpc<DueReminder[]>(db, "akb_class_day_before_due", { p_date: date });
export const dayBeforeSent = (db: Db, attendanceId: string) => rpc<null>(db, "akb_class_day_before_sent", { p_attendance: attendanceId });

const londonTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false });

/** The reminder email. Plain text: the class, where, and how to see or stop reminders. `dayBefore`: sent the day before ("tomorrow"). */
export function reminderEmail(r: DueReminder, env: Env = process.env, dayBefore = false): { subject: string; text: string } {
  // "6:30 pm", as the timetable writes it.
  const time = formatTime(londonTime.format(new Date(r.starts_at)) as TimeOfDay);
  const slot = publishedClasses().find((c) => c.id === r.slot);
  const first = r.name.trim().split(/\s+/)[0] || "there";
  const origin = memberLinkOrigin(env);
  return {
    subject: `Reminder: ${slot?.name ?? groupClass.name} ${dayBefore ? "tomorrow" : "today"} at ${time}`,
    text: [
      `Hi ${first},`,
      "",
      `A reminder that you're booked on ${slot?.name ?? groupClass.name} ${dayBefore ? "tomorrow" : "today"} at ${time}${slot?.durationMinutes ? ` (${slot.durationMinutes} minutes)` : ""}.`,
      "",
      `Where: ${formatAddressLines().join(", ")}`,
      "",
      arriveEarlyNote,
      "",
      `Your bookings: ${origin}${ACCOUNT_PATH}`,
      `Turn these reminders off any time: ${origin}${NOTIFICATIONS_PATH}`,
    ].join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Changing the account's email (owner, 2026-11-03; migration 20261116000000)
// ---------------------------------------------------------------------------

/** Starts a change: raises akb:same_email, akb:email_taken or akb:too_many. */
export const startEmailChange = (db: Db, clientId: string, newEmail: string, codeHash: string) =>
  rpc<null>(db, "akb_member_email_change_start", { p_client: clientId, p_new_email: newEmail, p_code_hash: codeHash });

/** Confirms it with the code: the old and new address, or null for a wrong, expired or used code. */
export const confirmEmailChange = (db: Db, clientId: string, codeHash: string) =>
  rpc<{ old_email: string; new_email: string } | null>(db, "akb_member_email_change_confirm", { p_client: clientId, p_code_hash: codeHash });

/** The code, to the new address. Plain text. */
export function emailChangeCodeEmail(code: string): { subject: string; text: string; code: string } {
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  return {
    subject: `Your RAENG email change code: ${spaced}`,
    text: [
      `Your code is ${spaced}`,
      "",
      "Type it on your Profile page to make this your RAENG email. It works once, for the next 15 minutes.",
      "",
      "If you didn't ask for this, you can ignore this email: nothing changes without the code.",
    ].join("\n"),
    code,
  };
}

/** The note to the old address once it's changed. Shows only part of the new one. */
export function emailChangedNotice(newEmail: string): { subject: string; text: string } {
  const [user, domain] = newEmail.split("@");
  const hidden = `${user.slice(0, 2)}${"•".repeat(Math.max(1, user.length - 2))}@${domain}`;
  return {
    subject: "Your RAENG email has been changed",
    text: [
      `Your RAENG account's email has been changed to ${hidden}. From now on you sign in with that address and our emails go there.`,
      "",
      "If you didn't do this, reply to this email straight away and we'll sort it out.",
    ].join("\n"),
  };
}
