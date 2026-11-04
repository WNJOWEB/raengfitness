import { NextResponse } from "next/server";
import { bookingDeliveryConfig } from "@/lib/booking-request";
import { coachDb } from "@/lib/coach/db";
import { londonToday } from "@/lib/coach/time";
import { cronAuthorized } from "@/lib/cron-auth";
import { afterPlacesChange } from "@/lib/waitlist";
import { dayBeforeSent, dueDayBefore, dueReminders, reminderEmail, reminderSent } from "@/lib/member-settings";
import { sendEmailWithRetry } from "@/lib/send-email";

/**
 * Class reminder emails (vercel.json "crons", daily, 2026-10-28): each
 * member who switched reminders on (Account → Notifications) gets one email on
 * the morning of a class they're booked on. Each place is reminded once
 * (a record is kept after the send, and the provider's idempotency key
 * covers a retry); a place cancelled, held for payment or on a cancelled
 * class gets nothing. Vercel Cron sends "Authorization: Bearer
 * <CRON_SECRET>"; anything else gets 401 and does nothing. Without the email
 * settings it sends nothing and records nothing, so the reminders go out
 * once email is on. Counts only in the response and the logs, never addresses.
 */
export async function GET(request: Request) {
  const noStore = { "Cache-Control": "no-store" };
  if (!cronAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: noStore });
  }
  const db = coachDb();
  const mail = bookingDeliveryConfig();
  if (!db || !mail) return NextResponse.json({ skipped: "not-configured" }, { headers: noStore });
  // The waitlist first: lapsed offers move on, and anyone newly offered a place is emailed.
  await afterPlacesChange(db);
  const due = await dueReminders(db, londonToday());
  if (!due.ok) {
    console.error(`Class reminders failed (${due.error.kind} ${due.error.code})`);
    return NextResponse.json({ ok: false, error: due.error.kind }, { status: 503, headers: noStore });
  }
  let sent = 0;
  let failed = 0;
  for (const reminder of due.data) {
    const result = await sendEmailWithRetry(mail, {
      ...reminderEmail(reminder),
      to: reminder.email,
      replyTo: mail.to,
      idempotencyKey: `class-reminder/${reminder.attendance_id}`,
    });
    if (!result.ok) {
      failed++;
      continue;
    }
    sent++;
    const recorded = await reminderSent(db, reminder.attendance_id);
    if (!recorded.ok) console.error(`Class reminder sent but not recorded (${recorded.error.kind})`);
  }
  // The day-before reminders (owner, 2026-11-03): tomorrow's classes, for members who asked.
  let dayBeforeSentCount = 0;
  const tomorrow = await dueDayBefore(db, londonToday());
  if (!tomorrow.ok) console.error(`Day-before reminders failed (${tomorrow.error.kind} ${tomorrow.error.code})`);
  for (const reminder of tomorrow.ok ? tomorrow.data : []) {
    const result = await sendEmailWithRetry(mail, {
      ...reminderEmail(reminder, process.env, true),
      to: reminder.email,
      replyTo: mail.to,
      idempotencyKey: `class-reminder-day-before/${reminder.attendance_id}`,
    });
    if (!result.ok) {
      failed++;
      continue;
    }
    dayBeforeSentCount++;
    const recorded = await dayBeforeSent(db, reminder.attendance_id);
    if (!recorded.ok) console.error(`Day-before reminder sent but not recorded (${recorded.error.kind})`);
  }
  if (failed) console.error(`Class reminders: ${failed} couldn't be sent`);
  return NextResponse.json({ ok: true, sent, dayBefore: dayBeforeSentCount, failed }, { headers: noStore });
}
