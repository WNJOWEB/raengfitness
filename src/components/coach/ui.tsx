import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Building blocks for coach portal pages (server components; monochrome, per DESIGN.md). */

export function PageHeader({ title, eyebrow, children, id = "page-heading" }: { title: ReactNode; eyebrow?: ReactNode; children?: ReactNode; id?: string }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 flex-col gap-2">
        {eyebrow ? <p className="members-eyebrow">{eyebrow}</p> : null}
        <h1 id={id} className="text-[clamp(1.875rem,8.4vw,2.625rem)] leading-[1.05] font-extrabold tracking-[-0.035em] text-balance break-words">
          {title}
        </h1>
      </div>
      {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
    </div>
  );
}

export function Panel({ title, id, children, actions, className }: { title: ReactNode; id: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={cn("mt-10", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-3">
        <h2 id={id} className="text-lg font-bold">
          {title}
        </h2>
        {actions ? <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">{actions}</div> : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Metric({ label, value, note, href, emphasis }: { label: string; value: ReactNode; note?: ReactNode; href?: string; emphasis?: boolean }) {
  const body = (
    <>
      <span className={cn("eyebrow", emphasis ? "text-white" : "text-muted")}>{label}</span>
      <span className="mt-2 block text-xl font-bold tabular-nums break-words sm:text-3xl">{value}</span>
      {note ? <span className={cn("mt-1 block text-sm", emphasis ? "text-white" : "text-muted")}>{note}</span> : null}
    </>
  );
  const classes = cn("block h-full p-3 sm:p-5", emphasis ? "bg-ink text-paper" : "border border-line bg-white");
  return href ? (
    <Link href={href} className={cn(classes, "transition-colors hover:border-ink")}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}

/** Status shown as text with a weight/fill, never colour alone. */
export function Badge({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "strong" | "muted" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.08em]",
        tone === "strong" && "bg-ink text-paper",
        tone === "plain" && "border border-ink",
        tone === "muted" && "border border-line text-muted",
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="border border-dashed border-muted bg-white p-6 text-center">
      <p className="font-semibold">{title}</p>
      {children ? <div className="mt-2 text-sm text-muted">{children}</div> : null}
    </div>
  );
}

export function LoadError({ message }: { message: string }) {
  return (
    <div role="alert" className="mt-8 border-2 border-ink bg-white p-5">
      <p className="font-semibold">{message}</p>
    </div>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return <p className="border-l-4 border-ink bg-white px-4 py-3 text-sm">{children}</p>;
}

const linkStyles = {
  primary: "bg-ink text-paper border border-ink hover:bg-white hover:text-ink",
  secondary: "border border-ink text-ink hover:bg-ink hover:text-paper",
} as const;

export function ActionLink({ href, children, variant = "secondary", className }: { href: string; children: ReactNode; variant?: keyof typeof linkStyles; className?: string }) {
  return (
    <Link href={href} className={cn("inline-flex min-h-11 items-center justify-center px-4 text-sm font-semibold uppercase tracking-[0.1em] transition-colors", linkStyles[variant], className)}>
      {children}
    </Link>
  );
}

export function TextLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("font-semibold underline underline-offset-4 hover:no-underline", className)}>
      {children}
    </Link>
  );
}

/** Filter or tab links: a real link per option, the current one marked. */
export function FilterLinks({ label, items, current }: { label: string; items: { value: string; label: string; href: string; count?: number }[]; current: string }) {
  return (
    <nav aria-label={label} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b border-line">
        {items.map((item) => {
          const active = item.value === current;
          return (
            <li key={item.value}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-semibold whitespace-nowrap",
                  active ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink",
                )}
              >
                {item.label}
                {item.count !== undefined ? <span className="tabular-nums text-muted">{item.count}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Details({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="divide-y divide-line border-y border-line">
      {items.map(([term, value], i) => (
        <div key={i} className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-3 sm:gap-4">
          <dt className="text-sm text-muted">{term}</dt>
          <dd className="break-words sm:col-span-2">{value || <span className="text-muted">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A list whose rows become a table from `md` up; on phones each row is a card. */
export function RowList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul aria-label={label} className="divide-y divide-line border-y border-line">
      {children}
    </ul>
  );
}

export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <li className={cn("py-3", className)}>{children}</li>;
}

/** A plain GET form for search and filters: works without JavaScript and keeps the URL shareable. */
export function SearchBar({ action, children, label = "Search" }: { action: string; children: ReactNode; label?: string }) {
  return (
    <form action={action} method="get" role="search" aria-label={label} className="mt-6 grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-end">
      {children}
      <button type="submit" className="inline-flex min-h-11 items-center justify-center bg-ink px-5 text-sm font-semibold uppercase tracking-[0.1em] text-paper border border-ink hover:bg-white hover:text-ink">
        Apply
      </button>
    </form>
  );
}

const plainControl = "mt-1 block min-h-11 w-full border border-muted bg-white px-3 text-base hover:border-ink focus-visible:border-ink sm:w-auto";

export function SearchInput({ name, label, defaultValue, type = "search" }: { name: string; label: string; defaultValue?: string; type?: "search" | "date" }) {
  return (
    <div className="sm:min-w-56">
      <label htmlFor={`f-${name}`} className="block text-sm font-semibold">
        {label}
      </label>
      <input id={`f-${name}`} name={name} type={type} defaultValue={defaultValue} className={plainControl} />
    </div>
  );
}

export function SearchSelect({ name, label, options, defaultValue }: { name: string; label: string; options: { value: string; label: string }[]; defaultValue?: string }) {
  return (
    <div>
      <label htmlFor={`f-${name}`} className="block text-sm font-semibold">
        {label}
      </label>
      <select id={`f-${name}`} name={name} defaultValue={defaultValue ?? ""} className={plainControl}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Pounds with the sign and colour-free emphasis. */
export function Amount({ pence, strong }: { pence: number; strong?: boolean }) {
  const text = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(Math.abs(pence) / 100);
  return <span className={cn("tabular-nums", strong && "font-bold")}>{pence < 0 ? `−${text}` : text}</span>;
}
