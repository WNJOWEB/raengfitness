/** Phone and map pin, drawn in the same stroke as InstagramIcon and MailIcon. Decorative: each row's text says what it is. */
const common = { viewBox: "0 0 24 24", "aria-hidden": true, focusable: false, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function PhoneIcon({ className = "size-6" }: { className?: string }) {
  return (
    <svg {...common} className={className}>
      <path d="M6.6 3.5h3l1.4 4-2 1.3a11 11 0 0 0 5.2 5.2l1.3-2 4 1.4v3a2 2 0 0 1-2.1 2A15.5 15.5 0 0 1 4.6 5.6a2 2 0 0 1 2-2.1Z" />
    </svg>
  );
}

export function PinIcon({ className = "size-6" }: { className?: string }) {
  return (
    <svg {...common} className={className}>
      <path d="M12 21s6.5-5.6 6.5-11a6.5 6.5 0 1 0-13 0c0 5.4 6.5 11 6.5 11Z" />
      <circle cx="12" cy="10" r="2.3" />
    </svg>
  );
}
