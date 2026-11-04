import { NextResponse } from "next/server";
import { classSizes, fullClasses, sizesFor } from "@/lib/class-capacity";
import { publishedClasses } from "@/lib/class-sessions";
import { londonToday } from "@/lib/coach/time";

/**
 * Public: which upcoming group classes are full or cancelled, as "slot|date"
 * keys, so the booking calendar shows them as fully booked or leaves them
 * out, and the class sizes (the most places any class has, for the "places max" fact, and each class time's own). No personal data; the places left on a date are public, like the "Fully booked" they sit beside. Briefly cacheable at the edge.
 */
export async function GET() {
  const [result, sizes] = await Promise.all([fullClasses(londonToday()), classSizes()]);
  // `size`: the most places any class time has ("15 places max"); `sizes`: each class time's own.
  const each = sizes ? sizesFor(sizes, publishedClasses().map((c) => c.id)) : null;
  return NextResponse.json(
    { full: result.keys, cancelled: result.cancelled, known: result.known, size: each?.max ?? null, sizes: each?.bySlot ?? {}, left: result.left ?? {} },
    { headers: { "Cache-Control": "public, max-age=0, s-maxage=30, stale-while-revalidate=60" } },
  );
}
