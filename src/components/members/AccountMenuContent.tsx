import Link from "next/link";
import { signOutMember } from "@/app/account/actions";
import { site } from "@/content/site";
import { COACHING_PATH, COACHING_UNLOCK_PATH, type CoachingStatus } from "@/lib/coaching";
import { formatPenceShort } from "@/lib/membership";
import type { MemberOverview } from "@/lib/member-auth";
import { CALENDAR_SYNC_PATH, NOTIFICATIONS_PATH, PROFILE_PATH, SECURITY_PATH, type MemberSettings } from "@/lib/member-settings";
import { MEMBERS_VIEW_PATH } from "@/lib/members-app";
import { usesCredits, firstName } from "@/lib/member-view";
import { external, Icon, MENU_ICON, NEW_TAB } from "./icons";
import { PendingButton } from "@/components/ui/PendingButton";

/**
 * What the avatar's account menu holds (owner's members design): who you are,
 * Coaching (its state, or Unlock), Profile, Plan and billing, Notifications,
 * Calendar sync, Sign-in and security, Help, Sign out. Shared by the members
 * frame and the coaching frame. Each state shown is real; one that couldn't
 * be read is left out.
 */
export function AccountMenuContent({ overview: o, settings, coaching }: { overview: MemberOverview; settings: MemberSettings | null; coaching: CoachingStatus | null }) {
  // A cancelled membership with nothing left to use reads as pay as you go (owner, 2026-11-03).
  const m = usesCredits(o) ? o.membership : null;
  const name = firstName(o.client.name) || "Member";
  const initial = name.slice(0, 1).toUpperCase();
  const coached = coaching?.active === true;
  return (
    <>
      <div className="mb-1.5 flex items-center gap-3 border-b border-line px-2.5 pt-2.5 pb-3.5">
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-[1.0625rem] font-bold text-paper">
          {initial}
        </span>
        <div className="min-w-0">
          <p className="font-bold">{o.client.name || name}</p>
          <p className="text-[0.8125rem] text-ink">
            {m ? `${m.plan_name} member` : "Pay as you go"}
            {coached ? " · Coaching" : ""}
          </p>
        </div>
      </div>
      <ul>
        {coaching ? (
          <li>
            <Link href={coached ? COACHING_PATH : COACHING_UNLOCK_PATH} className="members-menu-item">
              <Icon name="coach" className={MENU_ICON} />
              Coaching
              <em className="ml-auto text-xs text-ink not-italic">{coached ? (coaching.programme ? `Week ${coaching.programme.week}` : "Active") : "Unlock"}</em>
            </Link>
          </li>
        ) : null}
        <li>
          <Link href={PROFILE_PATH} className="members-menu-item">
            <Icon name="person" className={MENU_ICON} />
            Profile and details
          </Link>
        </li>
        <li>
          <Link href={MEMBERS_VIEW_PATH.plan} className="members-menu-item">
            <Icon name="card" className={MENU_ICON} />
            Plan and billing
            {m ? <em className="ml-auto text-xs text-ink not-italic">{formatPenceShort(m.price_pence)} / 4 wks</em> : null}
          </Link>
        </li>
        <li>
          <Link href={NOTIFICATIONS_PATH} className="members-menu-item">
            <Icon name="bell" className={MENU_ICON} />
            Notifications
            {settings ? <em className="ml-auto text-xs text-ink not-italic">{settings.class_reminders ? "On" : "Off"}</em> : null}
          </Link>
        </li>
        <li>
          <Link href={CALENDAR_SYNC_PATH} className="members-menu-item">
            <Icon name="calendar" className={MENU_ICON} />
            Calendar sync
            {settings ? <em className="ml-auto text-xs text-ink not-italic">{settings.calendar_feed ? "Connected" : "Not connected"}</em> : null}
          </Link>
        </li>
        <li>
          <Link href={SECURITY_PATH} className="members-menu-item">
            <Icon name="lock" className={MENU_ICON} />
            Sign-in and security
          </Link>
        </li>
      </ul>
      <hr className="my-1.5 border-line" />
      <ul>
        <li>
          <a href={site.social.instagram.url} {...external} className="members-menu-item">
            <Icon name="help" className={MENU_ICON} />
            <span>Help and contact{NEW_TAB}</span>
            <em className="ml-auto text-xs text-ink not-italic">Instagram</em>
          </a>
        </li>
      </ul>
      <hr className="my-1.5 border-line" />
      <form action={signOutMember}>
        <PendingButton pendingLabel="Signing out…" className="members-menu-item text-ink">
          <Icon name="out" className={MENU_ICON} />
          Sign out
        </PendingButton>
      </form>
      <form action={signOutMember}>
        <input type="hidden" name="everywhere" value="yes" />
        <PendingButton pendingLabel="Signing out…" className="members-menu-item text-ink">
          <Icon name="devices" className={MENU_ICON} />
          Sign out of every device
        </PendingButton>
      </form>
    </>
  );
}
