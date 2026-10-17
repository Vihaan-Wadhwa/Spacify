import Link from "next/link";
import { HOME_TYPES, HOME_TYPE_LABELS } from "@/lib/start";

/** The first question of /start, asked right here. A plain GET form, so it works before any script loads. */
export function AskForm({ id }: { id: string }) {
  return (
    <form className="lp-ask" action="/start" method="get" aria-labelledby={id}>
      <p className="lp-ask-q" id={id}>What are you building?</p>
      <div className="lp-ask-row">
        {HOME_TYPES.map((t) => (
          <button key={t} type="submit" name="type" value={t} className="lp-ask-opt">
            {HOME_TYPE_LABELS[t]}
          </button>
        ))}
      </div>
      <Link href="/start?sketch=1" className="lp-ask-sketch">
        I have a sketch
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M11 5l5 5-5 5" /></svg>
      </Link>
    </form>
  );
}
