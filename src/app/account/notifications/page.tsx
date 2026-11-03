import type { Metadata } from "next";
import { bookingDeliveryConfig } from "@/lib/booking-request";
import { pageMetadata } from "@/lib/metadata";
import { AccountUnavailable } from "@/components/members/Cards";
import { MembersShell } from "@/components/members/MembersShell";
import { SettingsHeading } from "@/components/members/Settings";
import { loadMembers } from "../data";
import { saveDayBefore, saveReminders } from "../settings-actions";
import { PendingButton } from "@/components/ui/PendingButton";

export const metadata: Metadata = pageMetadata({
  title: "Notifications",
  description: "Class reminder emails for your RAENG bookings.",
  path: "/account/notifications",
  noindex: true,
});

/**
 * Notifications (account menu): one real setting, a reminder email on the
 * morning of each class the member is booked on (off until they switch it on).
 * Emails about a booking they've just made or cancelled are not optional and
 * not affected. Sent by the daily /api/cron/class-reminders.
 */
export default async function AccountNotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const d = await loadMembers(searchParams);
  if (!d.overview.ok) return <AccountUnavailable />;
  const on = d.settings?.class_reminders ?? false;
  const dayBefore = d.settings?.reminder_day_before ?? false;
  const emailReady = bookingDeliveryConfig() !== null;

  return (
    <MembersShell view={null} overview={d.overview.data} settings={d.settings} coaching={d.coaching} now={d.now} done={d.done} error={d.error} sheet={null}>
      <SettingsHeading eyebrow="Account" title="Notifications." />
      <section aria-labelledby="reminders-eyebrow reminders-heading" className="flex flex-col gap-3 rounded-3xl border-[1.5px] border-ink p-5.5">
        <p id="reminders-eyebrow" className="members-eyebrow">On the morning of the class</p>
        <h2 id="reminders-heading" className="text-[1.5rem] font-extrabold tracking-[-0.03em]">
          {on ? "On" : "Off"}
        </h2>
        <p>An email on the morning of each class you&apos;re booked on, with the time and where to find us, sent to {d.settings?.email || "your email"}.</p>
        {!emailReady ? <p className="font-semibold">Reminder emails aren&apos;t switched on for the site yet. You can choose now, and they&apos;ll start when they are.</p> : null}
        <form action={saveReminders} className="mt-1">
          <input type="hidden" name="reminders" value={on ? "off" : "on"} />
          <PendingButton pendingLabel="Saving…" className={`members-btn w-full sm:w-auto ${on ? "" : "members-btn-solid"}`}>
            {on ? "Turn reminders off" : "Turn reminders on"}
          </PendingButton>
        </form>
      </section>
      <section aria-labelledby="day-before-eyebrow day-before-heading" className="flex flex-col gap-3 rounded-3xl border-[1.5px] border-ink p-5.5">
        <p id="day-before-eyebrow" className="members-eyebrow">The day before</p>
        <h2 id="day-before-heading" className="text-[1.5rem] font-extrabold tracking-[-0.03em]">
          {dayBefore ? "On" : "Off"}
        </h2>
        <p>An email the day before each class you&apos;re booked on, to help you plan ahead. Works alongside the morning reminder, or on its own.</p>
        <form action={saveDayBefore} className="mt-1">
          <input type="hidden" name="day_before" value={dayBefore ? "off" : "on"} />
          <PendingButton pendingLabel="Saving…" className={`members-btn w-full sm:w-auto ${dayBefore ? "" : "members-btn-solid"}`}>
            {dayBefore ? "Turn day-before reminders off" : "Turn day-before reminders on"}
          </PendingButton>
        </form>
      </section>
      <p className="text-sm">Emails about a booking or payment you make, such as a confirmation, are always sent and aren&apos;t affected by this.</p>
    </MembersShell>
  );
}
