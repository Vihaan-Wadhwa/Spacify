/**
 * Gold seams across the marble. `progress` (0–1) draws them out from their source, so on /start every answer
 * visibly carries the gold further; at 1 (and on the landing page) they are fully drawn.
 */
const VEINS = [
  { d: "M1600 110 C1440 170 1360 140 1270 230 S1090 310 1030 400 S930 560 820 600 S640 660 560 760", w: 2.2, o: 0.85 },
  { d: "M1270 230 C1300 300 1390 330 1420 430 S1460 560 1540 620", w: 1.2, o: 0.7 },
  { d: "M1030 400 C1080 450 1140 470 1170 550 S1270 680 1370 740 S1520 860 1600 880", w: 1.6, o: 0.8 },
  { d: "M0 690 C140 650 230 700 340 640 S470 560 530 500 S600 420 640 300", w: 1.8, o: 0.75 },
  { d: "M340 640 C360 720 330 800 380 880 S420 960 400 1000", w: 1, o: 0.6 },
  { d: "M760 0 C720 90 690 140 640 210 S600 300 640 300", w: 1.3, o: 0.65 },
];

export function GoldVeins({ progress = 1, className = "", id = "gold-rough" }: { progress?: number; className?: string; id?: string }) {
  const p = Math.max(0, Math.min(1, progress));
  return (
    <svg className={`gold-veins ${className}`.trim()} viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <filter id={id} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="3" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="10" />
        </filter>
      </defs>
      <g filter={`url(#${id})`} fill="none" strokeLinecap="round">
        {VEINS.map((v, i) => (
          <path
            key={i}
            d={v.d}
            pathLength={1}
            stroke={i % 2 ? "#d6ae5b" : "#c49a45"}
            strokeWidth={v.w}
            opacity={v.o}
            strokeDasharray="1 1"
            // Later veins start later, so the seams branch out as progress grows.
            strokeDashoffset={1 - Math.max(0, Math.min(1, p * 1.6 - i * 0.12))}
            style={{ transition: "stroke-dashoffset 1.6s cubic-bezier(0.16, 1, 0.3, 1)" }}
          />
        ))}
      </g>
    </svg>
  );
}
