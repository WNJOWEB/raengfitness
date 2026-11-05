import Link from "next/link";
import type { Price } from "@/content/types";
import { Provisional } from "@/components/ui/Provisional";
import { publishable } from "@/lib/publish";
import { formatGbp } from "@/lib/schedule";
import { cn } from "@/lib/cn";

interface PriceListProps {
  prices: Price[];
  tone?: "paper" | "ink";
  /** Link "Get in touch" to /contact. Off where a contact button sits right below. */
  linkContact?: boolean;
}

/**
 * Shows only publishable prices. When none can be published (e.g. all are
 * provisional on production) it shows a neutral "get in touch" line instead.
 */
export function PriceList({ prices, tone = "paper", linkContact = true }: PriceListProps) {
  const muted = tone === "ink" ? "text-muted-inverse" : "text-muted";
  const visible = publishable(prices);

  if (visible.length === 0) {
    return (
      <p className={cn("text-sm", muted)}>
        {linkContact ? (
          <Link
            href="/contact"
            className={cn("font-semibold underline underline-offset-4", tone === "ink" ? "text-paper" : "text-ink")}
          >
            Get in touch
          </Link>
        ) : (
          <span className={cn("font-semibold", tone === "ink" ? "text-paper" : "text-ink")}>Get in touch</span>
        )}{" "}
        for current pricing.
      </p>
    );
  }

  const status = visible.every((p) => p.status === "confirmed") ? "confirmed" : "provisional";
  const line = tone === "ink" ? "divide-line-inverse border-line-inverse" : "divide-line border-line";

  return (
    <Provisional status={status}>
      <dl className={cn("divide-y border-y", line)}>
        {visible.map((price) => (
          <div key={price.label} className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-1 py-4">
            <dt className={cn("text-sm", muted)}>{price.label}</dt>
            <dd className="text-right">
              {price.prefix ? (
                <span className={cn("mr-1.5 text-sm", muted)}>{price.prefix}</span>
              ) : null}
              <span className="text-2xl font-bold tabular-nums">{formatGbp(price.amountGbp)}</span>
              <span className={cn("ml-1.5 text-sm", muted)}>{price.unit}</span>
            </dd>
            {price.description ? <dd className={cn("col-span-2 max-w-md text-sm", muted)}>{price.description}</dd> : null}
          </div>
        ))}
      </dl>
    </Provisional>
  );
}
