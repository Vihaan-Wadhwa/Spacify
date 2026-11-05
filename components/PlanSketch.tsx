import { DEMO_PLAN } from "@/lib/demoPlan";
import { planBounds, wallLine, type Opening, type Wall } from "@/lib/rooms";

type Props = {
  /**
 * "sketch": the tutorial's example, dark pen on white paper (what the AI reads best), labelled with short codes and sizes.
 * "preview": the landing page, in the page's own colours, with names.
 */
  variant: "sketch" | "preview";
  className?: string;
  style?: React.CSSProperties;
};

// Drawn in feet (the viewBox is in feet), so the sketch is to scale.
const PAPER = "#fbfaf6";
const INK = "#24272b";
const LOOK = {
  sketch: { ink: INK, stroke: 0.22, wallOpacity: 0.9, fill: 1, font: 1.35, sub: 1, labelOpacity: 1, door: INK, doorOpacity: 0.55 },
  preview: { ink: "currentColor", stroke: 0.14, wallOpacity: 0.16, fill: 0.04, font: 1.15, sub: 0, labelOpacity: 0.45, door: "#c8f0a0", doorOpacity: 0.55 },
};

/** Which way into the room each wall faces (in plan coordinates: x east, z south). */
const INWARD: Record<Wall, [number, number]> = { n: [0, 1], s: [0, -1], w: [1, 0], e: [-1, 0] };

/** A door as a quarter-circle swing: hinged at the start of the gap, opening into its own room. */
function doorArc(room: (typeof DEMO_PLAN)[number], o: Omit<Opening, "id">): string {
  const line = wallLine(room, o.wall);
  const along: [number, number] = line.axis === "x" ? [1, 0] : [0, 1];
  const hinge: [number, number] = line.axis === "x" ? [line.from + o.offset, line.at] : [line.at, line.from + o.offset];
  const end: [number, number] = [hinge[0] + along[0] * o.width, hinge[1] + along[1] * o.width];
  const [ix, iz] = INWARD[o.wall as Wall]; // the sample home's rooms are all rectangles
  const leaf: [number, number] = [hinge[0] + ix * o.width, hinge[1] + iz * o.width];
  const cross = along[0] * iz - along[1] * ix; // SVG's y grows downward, like z
  return `M${end[0]} ${end[1]} A${o.width} ${o.width} 0 0 ${cross > 0 ? 1 : 0} ${leaf[0]} ${leaf[1]}`;
}

/** The sample 3BHK (lib/demoPlan.ts) as a flat floor plan. */
export function PlanSketch({ variant, className, style }: Props) {
  const look = LOOK[variant];
  const b = planBounds(DEMO_PLAN.map((r, i) => ({ ...r, id: i, h: 10, floor: 1, openings: [] })))!;
  const pad = 2;
  const width = b.maxX - b.minX;
  const top = b.minZ - pad - (variant === "sketch" ? 1.5 : 0);
  const view = { x: b.minX - pad, y: top, w: width + pad * 2, h: b.maxZ + pad - top };
  return (
    <svg
      className={className}
      style={style}
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Example floor plan of a 3BHK home"
    >
      {variant === "sketch" && (
        <>
          <rect x={view.x} y={view.y} width={view.w} height={view.h} rx={0.6} fill={PAPER} />
          <g opacity="0.6" fill={INK}>
            <line x1={b.minX} y1={b.minZ - 1.6} x2={b.maxX} y2={b.minZ - 1.6} stroke={INK} strokeWidth={0.06} />
            <text x={(b.minX + b.maxX) / 2} y={b.minZ - 2} textAnchor="middle" fontSize={0.9}>{width} ft</text>
          </g>
        </>
      )}
      {DEMO_PLAN.map((r, i) => {
        const label = variant === "sketch" ? r.code : fit(r.name, r.code, r.w, look.font);
        const cx = r.x + r.w / 2;
        const cy = r.z + r.l / 2;
        const sized = variant === "sketch" && r.sized;
        return (
          <g key={i}>
            <rect
              x={r.x}
              y={r.z}
              width={r.w}
              height={r.l}
              fill={variant === "sketch" ? "none" : "currentColor"}
              fillOpacity={look.fill}
              stroke={look.ink}
              strokeOpacity={look.wallOpacity}
              strokeWidth={look.stroke}
            />
            <text
              x={cx}
              y={sized ? cy - 0.2 : cy + look.font * 0.35}
              textAnchor="middle"
              fontSize={look.font}
              fill={look.ink}
              fillOpacity={look.labelOpacity}
              letterSpacing={variant === "preview" ? "0.08em" : undefined}
            >
              {label}
            </text>
            {sized && (
              <text x={cx} y={cy + look.sub + 0.3} textAnchor="middle" fontSize={look.sub} fill={look.ink} fillOpacity={0.7}>
                {r.w}×{r.l}
              </text>
            )}
            {(r.openings ?? [])
              .filter((o) => o.kind === "door")
              .map((o, j) => (
                <path key={j} d={doorArc(r, o)} stroke={look.door} strokeOpacity={look.doorOpacity} strokeWidth={0.1} strokeDasharray="0.35 0.25" />
              ))}
          </g>
        );
      })}
    </svg>
  );
}

/** The room's name in capitals if it fits across the room, otherwise its short code. */
function fit(name: string, code: string, roomWidth: number, font: number): string {
  const upper = name.toUpperCase();
  return upper.length * font * 0.68 <= roomWidth - 1 ? upper : code.toUpperCase();
}
