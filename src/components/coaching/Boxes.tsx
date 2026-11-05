import { revealDelay } from "@/lib/reveal";

const card = "rounded-[1.25rem] bg-white px-5 py-5";

/** Numbered white boxes ("What's included", small group benefits). */
export function Boxes({ items, label }: { items: readonly { title: string; body: string }[]; label: string }) {
  return (
    <ol aria-label={label} className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {items.map((item, i) => (
        <li key={item.title} data-reveal style={revealDelay(i)} className={card}>
          <p className="eyebrow" aria-hidden="true">
            {String(i + 1).padStart(2, "0")}
          </p>
          <h3 className="mt-3 font-bold">{item.title}</h3>
          <p className="mt-2">{item.body}</p>
        </li>
      ))}
    </ol>
  );
}
