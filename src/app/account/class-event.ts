import { groupClass } from "@/content/classes";
import { formatAddressLines, site } from "@/content/site";
import type { ClassEvent } from "@/lib/calendar";
import { publishedClasses } from "@/lib/class-sessions";
import { siteUrl } from "@/lib/env";
import { ACCOUNT_PATH, type MemberPlace } from "@/lib/member-auth";

/** A booked place as a calendar event: the class's own length from the timetable, the venue from content. */
export function classEventFor(place: MemberPlace): ClassEvent {
  const slot = publishedClasses().find((c) => c.id === place.slot);
  return {
    id: place.id,
    title: `${slot?.name ?? groupClass.name}, ${site.name}`,
    startsAt: place.starts_at,
    durationMinutes: slot?.durationMinutes ?? 60,
    location: formatAddressLines().join(", "),
    description: `Booked in your ${site.name} account. To cancel, go to ${siteUrl()}${ACCOUNT_PATH}`,
  };
}
