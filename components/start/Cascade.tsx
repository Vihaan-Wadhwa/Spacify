/**
 * A number in fixed tabular cells. When it changes, only the digits that changed flip in,
 * one after another from the left, like a departures board.
 */
export function Cascade({ value, width, className = "" }: { value: string | number; width?: number; className?: string }) {
  const text = String(value).padStart(width ?? 0, " ");
  return (
    <span className={`cascade ${className}`.trim()} aria-label={String(value).trim()}>
      {[...text].map((ch, i) => (
        <span key={`${i}-${ch}`} className="cascade-cell" style={{ animationDelay: `${i * 45}ms` }} aria-hidden="true">
          {ch === " " ? " " : ch}
        </span>
      ))}
    </span>
  );
}
