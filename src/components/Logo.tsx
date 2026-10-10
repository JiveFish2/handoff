// The Handoff mark: an H whose crossbar carries something from the left stem to the right
// one, the receiving side in green. Same drawing as src/app/icon.svg.
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden className="shrink-0">
      <rect x="1" y="1" width="22" height="22" rx="5" fill="var(--bg)" stroke="var(--line)" strokeWidth=".8" />
      <path d="M7 6v12" stroke="var(--bright)" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M17 6v12" stroke="var(--ok)" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M7 12h7.2M12 9.2l2.8 2.8-2.8 2.8" fill="none" stroke="var(--bright)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
