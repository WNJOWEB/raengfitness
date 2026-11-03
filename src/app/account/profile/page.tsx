import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import { AccountUnavailable } from "@/components/members/Cards";
import { MembersShell } from "@/components/members/MembersShell";
import { SettingsHeading } from "@/components/members/Settings";
import { LIMITS } from "@/lib/form-validation";
import { loadMembers } from "../data";
import { saveProfile } from "../settings-actions";
import { EmailChangeForm } from "./EmailChangeForm";
import { PendingButton } from "@/components/ui/PendingButton";

export const metadata: Metadata = pageMetadata({
  title: "Profile and details",
  description: "Your name and phone number on your RAENG account.",
  path: "/account/profile",
  noindex: true,
});


/**
 * Profile and details (account menu): the member's own name and phone, and
 * their email, which they can change by confirming a code sent to the new
 * address (owner, 2026-11-03).
 */
export default async function AccountProfilePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const d = await loadMembers(searchParams);
  if (!d.overview.ok) return <AccountUnavailable />;
  const o = d.overview.data;
  const c = d.settings ?? { name: o.client.name, email: o.client.email, phone: o.client.phone };

  return (
    <MembersShell view={null} overview={o} settings={d.settings} coaching={d.coaching} now={d.now} done={d.done} error={d.error} sheet={null}>
      <SettingsHeading eyebrow="Account" title="Your details.">
        Used for your bookings and to fill in forms for you.
      </SettingsHeading>
      <form action={saveProfile} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="profile-name" className="font-semibold">
            Name
          </label>
          <input id="profile-name" name="name" required maxLength={LIMITS.name} autoComplete="name" defaultValue={c.name} className="members-input" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="profile-phone" className="font-semibold">
            Phone <span className="font-normal">(optional)</span>
          </label>
          <input id="profile-phone" name="phone" type="tel" inputMode="tel" maxLength={LIMITS.phone} autoComplete="tel" defaultValue={c.phone} className="members-input" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="profile-email" className="font-semibold">
            Email
          </label>
          <input id="profile-email" type="email" readOnly value={c.email} aria-describedby="profile-email-note" className="members-input" />
          <p id="profile-email-note" className="text-sm">
            You sign in with this address. To change it, use Change your email below.
          </p>
        </div>
        <PendingButton pendingLabel="Saving…" className="members-btn members-btn-solid w-full sm:w-auto">
          Save details
        </PendingButton>
      </form>
      <section aria-labelledby="email-change-heading" className="flex flex-col gap-3 rounded-3xl bg-white p-5.5">
        <h2 id="email-change-heading" className="text-[1.25rem] font-extrabold tracking-[-0.02em]">
          Change your email
        </h2>
        <EmailChangeForm current={c.email} />
      </section>
    </MembersShell>
  );
}
