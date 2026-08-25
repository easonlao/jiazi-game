export function CardHistoryButton({
  cardName,
  onOpen,
}: {
  cardName: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="card-history-button"
      aria-label={`查看${cardName}行迹`}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      className="group flex min-h-11 w-full items-center justify-center gap-1.5 border-t border-wood-light/45 bg-parchment/65 px-2 text-xs font-bold text-ink-light transition-colors hover:bg-white/75 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink/55 active:bg-wood-light/15"
    >
      <svg
        viewBox="0 0 20 20"
        className="h-3.5 w-3.5 shrink-0 transition-transform group-hover:-translate-y-0.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 14.5 7.2 10l3 2.4L17 5.5" />
        <path d="M3 4v12h14" />
      </svg>
      <span>行迹</span>
    </button>
  );
}
