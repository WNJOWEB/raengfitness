"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { formatLongDate, formatMonth, fromDateKey, monthGrid, monthKey, type DateKey } from "@/lib/availability/dates";
import { dayStatus, type AvailabilityWindow, type DayStatus } from "@/lib/availability/types";
import { formatTime } from "@/lib/schedule";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface Props {
  window: AvailabilityWindow;
  date: DateKey | null;
  slotId: string | null;
  onDate: (date: DateKey) => void;
  onSlot: (slotId: string) => void;
  /** e.g. "class" or "session", for the times heading. */
  noun: string;
  /** Places still free on a class date and the class size (group classes, when the count is known); shown beside each time as "14 spaces remaining", "1 space remaining" or "Full". */
  placesLeft?: (slotId: string, date: DateKey) => { left: number; size: number };
  /** Where to join the waitlist for a full time (group classes; owner, 2026-11-04). Without it a full time just says Full. */
  waitlistHref?: (slotId: string, date: DateKey) => string;
}

/**
 * Month calendar plus times for the chosen date. Dates and times are native
 * radios: arrow keys move between the dates that can be chosen, and dates
 * without availability are disabled and labelled.
 */
export function AvailabilityCalendar({ window: avail, date, slotId, onDate, onSlot, noun, placesLeft, waitlistHref }: Props) {
  const byDate = new Map(avail.days.map((d) => [d.date, d]));
  const months = [...new Set([monthKey(avail.from), monthKey(avail.to)])];
  // Open on the chosen date's month, else the month of the first date that can be booked.
  const [monthIndex, setMonthIndex] = useState(() => {
    const first = avail.days.find((d) => dayStatus(d) === "available")?.date;
    const target = date ?? first;
    return Math.max(0, target ? months.indexOf(monthKey(target)) : 0);
  });
  const month = months[monthIndex] ?? months[0];
  const cells = monthGrid(`${month}-01`);
  const chosenDay = date ? byDate.get(date) : undefined;
  const demo = avail.source === "demo";

  const statusOf = (key: DateKey): DayStatus | "outside" =>
    key < avail.from || key > avail.to ? "outside" : dayStatus(byDate.get(key));

  return (
    <div className="grid grid-cols-1 gap-8 md:grid-cols-[minmax(0,1fr)_14rem] md:gap-10">
      <fieldset>
        <legend className="sr-only">Date{demo ? " (demonstration availability)" : ""}</legend>
        <div className="flex items-center justify-between">
          <p className="font-semibold" aria-live="polite">
            {formatMonth(`${month}-01`)}
          </p>
          <div className="flex">
            <MonthButton direction="previous" disabled={monthIndex === 0} onClick={() => setMonthIndex((i) => i - 1)} />
            <MonthButton
              direction="next"
              disabled={monthIndex >= months.length - 1}
              onClick={() => setMonthIndex((i) => i + 1)}
            />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-7" aria-hidden="true">
          {WEEKDAYS.map((d) => (
            <span key={d} className="py-2 text-center text-xs font-semibold text-muted">
              {d}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1" data-testid="calendar-grid">
          {cells.map((key, i) => {
            if (!key) return <span key={`pad-${i}`} />;
            const status = statusOf(key);
            // With a waitlist (group classes), a fully booked date can be opened to see its times and join the waitlist.
            const selectable = status === "available" || (status === "full" && Boolean(waitlistHref));
            const selected = key === date;
            const day = fromDateKey(key).getDate();
            const label = `${formatLongDate(key)}, ${
              status === "available" ? "available" : status === "full" ? (waitlistHref ? "fully booked, waitlist open" : "fully booked") : "no sessions"
            }`;
            return (
              <label
                key={key}
                data-status={status}
                className={cn(
                  "relative flex h-12 items-center justify-center rounded-xl text-sm transition-colors duration-150 sm:h-14",
                  // Bookable dates are outlined rounded squares in bold; the rest stay plain on the page (2026-10-27: outlines, not white fills).
                  selectable && "cursor-pointer hover:outline hover:outline-1 hover:-outline-offset-1 hover:outline-ink",
                  status === "available" && "font-bold",
                  // A fully booked date that can still be opened for its waitlist: dashed, not bold.
                  selectable && !selected && (status === "available" ? "border border-line" : "border border-dashed border-line text-muted"),
                  selected && "bg-ink text-paper",
                  // Dates that can't be booked recede (disabled controls are exempt from text contrast).
                  !selectable && "text-grey",
                  status === "full" && "line-through decoration-1",
                  "has-[:focus-visible]:z-10 has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-ink",
                  selected && "has-[:focus-visible]:outline-paper",
                )}
              >
                <input
                  type="radio"
                  name="date"
                  value={key}
                  checked={selected}
                  disabled={!selectable}
                  onChange={() => onDate(key)}
                  aria-label={label}
                  className="sr-only"
                />
                <span aria-hidden="true">{day}</span>
                {status === "available" && !selected ? (
                  <span aria-hidden="true" className="absolute bottom-1.5 size-1 rounded-full bg-ink sm:bottom-2" />
                ) : null}
              </label>
            );
          })}
        </div>
        <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted" aria-label="Key">
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="flex size-4 items-center justify-center rounded border border-line">
              <span className="size-1 rounded-full bg-ink" />
            </span>{" "}
            Available
          </li>
          {avail.days.some((d) => dayStatus(d) === "full") ? (
            <li className="flex items-center gap-2">
              <span aria-hidden="true" className="line-through">21</span> {waitlistHref ? "Fully booked: join the waitlist" : "Fully booked"}
            </li>
          ) : null}
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="size-3 rounded-sm bg-ink" /> Selected
          </li>
        </ul>
      </fieldset>

      <fieldset id="times" className="scroll-mt-28">
        <legend className="font-semibold">
          {date ? formatLongDate(date) : "Times"}
        </legend>
        {chosenDay ? (
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-1">
            {chosenDay.slots.map((slot) => (
              <div key={slot.id} className="flex flex-col">
              <label
                className={cn(
                  "flex min-h-12 rounded-xl border px-4 text-sm font-semibold transition-colors duration-150",
                  // With a places-left line the time and the line stack (two columns of tiles on a phone are narrow).
                  placesLeft && slot.available ? "min-h-14 flex-col justify-center gap-0.5 py-3" : "items-center justify-between gap-2",
                  slot.available
                    ? "cursor-pointer border-line hover:border-ink has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-paper"
                    : "cursor-not-allowed border-dashed border-line text-muted",
                  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-ink",
                )}
              >
                <input
                  type="radio"
                  name="slot-choice"
                  value={slot.id}
                  checked={slot.id === slotId}
                  disabled={!slot.available}
                  onChange={() => onSlot(slot.id)}
                  className="sr-only"
                />
                <span className={placesLeft && slot.available ? "text-base" : undefined}>{formatTime(slot.time)}</span>
                {!slot.available ? (
                  <span className="text-xs font-normal">{placesLeft && date ? spacesLabel(placesLeft(slot.id, date), false) : "Full"}</span>
                ) : placesLeft && date ? (
                  <span className="text-sm font-normal">{spacesLabel(placesLeft(slot.id, date), true)}</span>
                ) : null}
              </label>
              {!slot.available && waitlistHref && date ? (
                <a href={waitlistHref(slot.id, date)} className="inline-flex min-h-11 items-center px-1 text-sm font-semibold underline underline-offset-4 hover:no-underline">
                  Join the waitlist<span className="sr-only"> for {formatTime(slot.time)}</span>
                </a>
              ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">Choose a date to see {noun} times.</p>
        )}
      </fieldset>
    </div>
  );
}

function MonthButton({ direction, disabled, onClick }: { direction: "previous" | "next"; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`${direction === "previous" ? "Previous" : "Next"} month`}
      className="inline-flex min-h-11 items-center justify-center px-3 text-sm font-semibold transition-colors hover:bg-surface disabled:text-line disabled:hover:bg-transparent"
    >
      {direction === "previous" ? "Previous" : "Next"}
    </button>
  );
}

/** Places left only, never the booked count: "14 spaces remaining", "1 space remaining", or "Full". */
function spacesLabel({ left, size }: { left: number; size: number }, open: boolean): string {
  if (!open || left <= 0) return "Full";
  return `${left} ${left === 1 ? "space" : "spaces"} remaining`;
}
