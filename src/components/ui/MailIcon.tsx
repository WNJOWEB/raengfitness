/** An envelope, drawn in the same stroke as InstagramIcon so the two sit together. Decorative: the word "Email" is always in the link's text or label. */
export function MailIcon({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="3.2" />
      <path d="M4 8l8 5.4L20 8" />
    </svg>
  );
}
