import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import { AccountUnavailable } from "@/components/members/Cards";
import { MembersShell } from "@/components/members/MembersShell";
import { SettingsHeading } from "@/components/members/Settings";
import { shortWhen } from "@/lib/member-view";
import { memberDevices } from "@/lib/member-settings";
import { signOutMember } from "../actions";
import { signOutDevice } from "../settings-actions";
import { loadMembers } from "../data";
import { PendingButton } from "@/components/ui/PendingButton";

export const metadata: Metadata = pageMetadata({
  title: "Sign-in and security",
  description: "The devices signed in to your RAENG account.",
  path: "/account/security",
  noindex: true,
});

/**
 * Sign-in and security (account menu): there is no password, so this is the
 * list of devices signed in (30 days each, or until signed out), with Sign
 * out for each other device and for every device.
 */
export default async function AccountSecurityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const d = await loadMembers(searchParams);
  if (!d.overview.ok) return <AccountUnavailable />;
  const devices = await memberDevices(d.member.db, d.member.clientId, d.member.sessionHash);
  const list = devices.ok ? devices.data : [];

  return (
    <MembersShell view={null} overview={d.overview.data} settings={d.settings} coaching={d.coaching} now={d.now} done={d.done} error={d.error} sheet={null}>
      <SettingsHeading eyebrow="Account" title="Sign-in and security.">
        There&apos;s no password. Each time you sign in we email a link that works once, for 15 minutes, and a device then stays signed in for 30 days.
      </SettingsHeading>

      <section aria-labelledby="devices-heading" className="flex flex-col gap-3">
        <h2 id="devices-heading" className="members-eyebrow">
          Signed in on
        </h2>
        {devices.ok ? (
          <ul className="border-t border-line">
            {list.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 border-b border-line py-3">
                <div className="flex min-w-0 flex-col">
                  <span className="font-semibold">
                    {s.device || "A device"}
                    {s.current ? " (this device)" : ""}
                  </span>
                  <span className="text-sm">
                    {s.current ? "Signed in " : "Last used "}
                    {shortWhen(s.current ? s.signed_in_at : s.last_seen_at)}
                  </span>
                </div>
                {s.current ? null : (
                  <form action={signOutDevice}>
                    <input type="hidden" name="device" value={s.id} />
                    <PendingButton pendingLabel="Signing out…" className="members-link">
                      Sign out<span className="sr-only"> {s.device || "this device"}</span>
                    </PendingButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p>Sorry, the list of devices couldn&apos;t be loaded just now. Please try again in a minute.</p>
        )}
      </section>

      <div className="flex flex-col gap-3 sm:flex-row">
        <form action={signOutMember}>
          <PendingButton pendingLabel="Signing out…" className="members-btn w-full sm:w-auto">
            Sign out of this device
          </PendingButton>
        </form>
        <form action={signOutMember}>
          <input type="hidden" name="everywhere" value="yes" />
          <PendingButton pendingLabel="Signing out…" className="members-btn w-full sm:w-auto">
            Sign out of every device
          </PendingButton>
        </form>
      </div>
      <p className="text-sm">If you see a device you don&apos;t recognise, sign out of every device, then sign in again with a new link.</p>
    </MembersShell>
  );
}
