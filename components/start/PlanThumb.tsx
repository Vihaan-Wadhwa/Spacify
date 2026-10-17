import type { PlanOption } from "@/lib/planner";

const KIND: [RegExp, string][] = [
  [/Bedroom/, "bed"],
  [/Living|Dining/, "live"],
  [/Kitchen|Store/, "cook"],
  [/Bathroom/, "wet"],
  [/Pooja/, "pooja"],
  [/Passage|Staircase/, "move"],
  [/Balcony|Terrace/, "out"],
];
const kind = (name: string) => KIND.find(([re]) => re.test(name))?.[1] ?? "other";

/** One floor of an option, seen from above: plot, buildable area, rooms by kind, and the road side marked. */
export function PlanThumb({ option, floor = 1 }: { option: PlanOption; floor?: number }) {
  const p = option.plotRect;
  const pad = 2.5;
  const road = option.plot.facing;
  const roadLine = {
    north: { x1: p.x, y1: p.z - 1.2, x2: p.x + p.w, y2: p.z - 1.2 },
    south: { x1: p.x, y1: p.z + p.l + 1.2, x2: p.x + p.w, y2: p.z + p.l + 1.2 },
    east: { x1: p.x + p.w + 1.2, y1: p.z, x2: p.x + p.w + 1.2, y2: p.z + p.l },
    west: { x1: p.x - 1.2, y1: p.z, x2: p.x - 1.2, y2: p.z + p.l },
  }[road];
  const rooms = option.rooms.filter((r) => r.floor === floor);
  return (
    <svg className="st-thumb" viewBox={`${p.x - pad} ${p.z - pad} ${p.w + pad * 2} ${p.l + pad * 2}`} role="img" aria-label={`${option.name}, ${floor === 1 ? "ground" : `floor ${floor}`} plan`}>
      <rect className="st-thumb-plot" x={p.x} y={p.z} width={p.w} height={p.l} />
      <line className="st-thumb-road" {...roadLine} />
      {rooms.map((r, i) => (
        <rect key={i} className={`st-thumb-room is-${kind(r.name)}`} x={r.x} y={r.z} width={r.w} height={r.l}>
          <title>{`${r.name} · ${r.w} × ${r.l} ft`}</title>
        </rect>
      ))}
    </svg>
  );
}
