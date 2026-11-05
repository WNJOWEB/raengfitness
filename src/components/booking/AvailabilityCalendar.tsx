"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { formatLongDate, formatMonth, fromDateKey, monthGrid, monthKey, type DateKey } from "@/lib/availability/dates";
import { dayStatus, type AvailabilityWindow, type DayStatus } from "@/lib/availability/types";
import { formatSpaces } from "@/lib/class-spaces";
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
}

/**
 * Month calendar plus times for the chosen date. Dates and times are native
 * radios: arrow keys move between the dates that can be chosen, and dates
 * without availability are disabled and labelled.
 */
export function AvailabilityCalendar({ window: avail, date, slotId, onDate, onSlot, noun }: Props) {
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
            <span key={d} className="py-2 text-center text-xs font-semibold uppercase tracking-[0.08em] text-muted">
              {d}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 border-t border-l border-line" data-testid="calendar-grid">
          {cells.map((key, i) => {
            if (!key) return <span key={`pad-${i}`} className="border-r border-b border-line" />;
            const status = statusOf(key);
            const selectable = status === "available";
            const selected = key === date;
            const day = fromDateKey(key).getDate();
            const label = `${formatLongDate(key)}, ${
              status === "available" ? "available" : status === "full" ? "fully booked" : "no sessions"
            }`;
            return (
              <label
                key={key}
                data-status={status}
                className={cn(
                  "relative flex h-12 items-center justify-center border-r border-b border-line text-sm transition-colors duration-150 sm:h-14",
                  selectable && "cursor-pointer font-semibold hover:bg-surface",
                  selected && "bg-ink text-paper hover:bg-ink",
                  !selectable && "text-muted",
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
                {selectable && !selected ? (
                  <span aria-hidden="true" className="absolute bottom-1.5 size-1 rounded-full bg-ink sm:bottom-2" />
                ) : null}
              </label>
            );
          })}
        </div>
        <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted" aria-label="Key">
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-ink" /> Available
          </li>
          {avail.days.some((d) => dayStatus(d) === "full") ? (
            <li className="flex items-center gap-2">
              <span aria-hidden="true" className="line-through">21</span> Fully booked
            </li>
          ) : null}
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="size-3 bg-ink" /> Selected
          </li>
        </ul>
      </fieldset>

      <fieldset id="times" className="scroll-mt-28">
        <legend className="font-semibold">
          {date ? formatLongDate(date) : "Times"}
        </legend>
        {chosenDay ? (
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-1">
            {chosenDay.slots.map((slot) => (
              <label
                key={slot.id}
                className={cn(
                  "flex min-h-12 items-center justify-between gap-2 border px-4 py-2 text-sm font-semibold transition-colors duration-150",
                  slot.available
                    ? "cursor-pointer border-muted bg-white hover:border-ink has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-paper"
                    : "cursor-not-allowed border-line text-muted",
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
                <span className="min-w-0">
                  <span className="block">{formatTime(slot.time)}</span>
                  {slot.name ? <span className="block text-xs font-normal">{slot.name}</span> : null}
                  {slot.places ? (
                    <span className="mt-0.5 block text-xs font-normal">{formatSpaces(slot.places)}</span>
                  ) : null}
                </span>
                {!slot.available && !slot.places ? <span className="text-xs font-normal">Full</span> : null}
              </label>
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
      className="inline-flex size-11 items-center justify-center transition-colors hover:bg-surface disabled:text-line disabled:hover:bg-transparent"
    >
      <span aria-hidden="true">{direction === "previous" ? "←" : "→"}</span>
    </button>
  );
}
