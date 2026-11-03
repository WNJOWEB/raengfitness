import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import { AccountUnavailable } from "@/components/members/Cards";
import { CalendarLink } from "@/components/members/CalendarLink";
import { MembersShell } from "@/components/members/MembersShell";
import { SettingsHeading } from "@/components/members/Settings";
import { loadMembers } from "../data";
import { turnOffCalendarLink } from "../settings-actions";
import { PendingButton } from "@/components/ui/PendingButton";

export const metadata: Metadata = pageMetadata({
  title: "Calendar sync",
  description: "Your RAENG classes in your own calendar.",
  path: "/account/calendar-sync",
  noindex: true,
});

/**
 * Calendar sync (account menu): a private link that Apple, Google and Outlook
 * calendars subscribe to, so booked classes appear (and cancelled ones go)
 * without adding each one. Only the link's hash is stored, so it can be shown
 * once; a new link replaces it, and Turn off removes it.
 */
export default async function AccountCalendarSyncPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const d = await loadMembers(searchParams);
  if (!d.overview.ok) return <AccountUnavailable />;
  const connected = d.settings?.calendar_feed ?? false;

  return (
    <MembersShell view={null} overview={d.overview.data} settings={d.settings} coaching={d.coaching} now={d.now} done={d.done} error={d.error} sheet={null}>
      <SettingsHeading eyebrow="Account" title="Calendar sync.">
        Your booked classes in your own calendar, kept up to date. Calendar apps check for changes every so often, so a new booking can take a while to show.
      </SettingsHeading>
      <p className="font-semibold">{connected ? "A calendar link is set up." : "Not connected."}</p>
      <CalendarLink connected={connected} />
      {connected ? (
        <form action={turnOffCalendarLink}>
          <PendingButton pendingLabel="Turning off…" className="members-link">
            Turn off calendar sync
          </PendingButton>
        </form>
      ) : null}
      <p className="text-sm">You can also add a single class from Home with Add to calendar.</p>
    </MembersShell>
  );
}
