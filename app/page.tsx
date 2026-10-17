import Link from "next/link";
import "@fontsource-variable/anek-latin/wdth.css";
import "@fontsource-variable/martian-mono";
import { AskForm } from "@/components/landing/AskForm";
import { AxoDrawing, KitchenGlyph, PlanDrawing, SketchDrawing } from "@/components/landing/Drawings";
import { HeroMind } from "@/components/landing/HeroMind";
import { GoldVeins } from "@/components/start/GoldVeins";
import { CEILING_TYPES, FLOOR_OPTIONS, KITCHEN_LAYOUTS, KITCHEN_LAYOUT_LABELS, WALL_FINISHES, WALL_FINISH_LABELS } from "@/lib/rooms";
import { getCurrentUser } from "@/lib/server/currentUser";
import "./landing.css";

const CEILING_LABELS: Record<string, string> = { plain: "Plain", pop: "POP", gypsum: "Gypsum", wood: "Wood" };

const STAGES = [
  {
    title: "Reads your sketch",
    text: "Hand-drawn or digital. Short labels like MB, B1, WIC and Pooja are understood, and sizes written as 14×13 are copied exactly.",
    drawing: <SketchDrawing />,
  },
  {
    title: "Lays it out to scale",
    text: "Rooms meet wall to wall on a 2D plan. Drag and resize them, then add doors and windows where they really go.",
    drawing: <PlanDrawing />,
  },
  {
    title: "Raises it in 3D",
    text: "Orbit it, flip between floors, then walk through every room with W, A, S and D.",
    drawing: <AxoDrawing />,
  },
];

const TOGETHER = [
  { title: "Share it", text: "Give family, your designer or your builder access to edit, or just to look." },
  { title: "Every floor", text: "G, G+1 and G+2, each with its own plan and a staircase between them." },
  { title: "Bare or furnished", text: "Switch between bare walls and furnished rooms: beds, cupboards, kitchen cabinets." },
  { title: "Walk through it", text: "Move through each room at its real proportions before a single wall goes up." },
  { title: "Ask for ideas", text: "The assistant suggests wall colours, tile or marble, and false-ceiling designs for your rooms." },
  { title: "Keep a copy", text: "Export the plan or the 3D view as an image to send on." },
];

export default async function LandingPage() {
  // The landing page works without a database; then it just treats you as logged out.
  const user = await getCurrentUser().catch(() => null);
  return (
    <div className="lp">
      <header className="lp-nav">
        <Link href="/" className="lp-logo">
          Spac<span>i</span>fy
        </Link>
        <nav aria-label="Sections">
          <ul className="lp-links">
            <li><a href="#reads">How it reads</a></li>
            <li><a href="#finishes">Finishes</a></li>
            <li><a href="#together">Together</a></li>
          </ul>
        </nav>
        <div className="lp-nav-end">
          {user ? <Link href="/projects" className="lp-quiet">My projects</Link> : <Link href="/login" className="lp-quiet">Log in</Link>}
          <Link href="/start" className="lp-btn">Start your home</Link>
        </div>
      </header>

      <section className="lp-hero lp-marble" aria-labelledby="hero-title">
        <GoldVeins />
        <HeroMind />
        <div className="lp-hero-copy">
          <h1 id="hero-title">
            Sketch it on paper.
            <br />
            Walk through it <span>tonight.</span>
          </h1>
          <p className="lp-hero-sub">
            Give Spacify your plot and what you need, or a photo of your sketch. It lays every room out to scale and raises a 3D home you
            can walk through, room by room.
          </p>
          <AskForm id="ask-hero" />
          <p className="lp-fine">No account needed until you save.</p>
        </div>
        <p className="lp-hero-caption">Demo · a 3 BHK independent house on a 30 × 50 ft plot, from four answers</p>
      </section>

      <section id="reads" className="lp-day lp-reads" aria-labelledby="reads-title">
        <div className="lp-wrap">
          <h2 id="reads-title">It reads the way you draw</h2>
          <p className="lp-lede">One house, three ways. The rooms you scribble become the plan you edit and the home you walk through.</p>
          <ol className="lp-stages">
            {STAGES.map((s) => (
              <li key={s.title}>
                <figure>
                  <div className="lp-stage-art">{s.drawing}</div>
                  <figcaption>
                    <h3>{s.title}</h3>
                    <p>{s.text}</p>
                  </figcaption>
                </figure>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="finishes" className="lp-charcoal lp-finishes" aria-labelledby="finishes-title">
        <div className="lp-wrap">
          <h2 id="finishes-title">Pick the floor before you pour it</h2>
          <p className="lp-lede">Set flooring, walls, ceilings and the kitchen room by room, and see each choice in 3D straight away.</p>
          <ul className="lp-slabs" aria-label="Flooring">
            {FLOOR_OPTIONS.map((f) => (
              <li key={f.name} style={{ "--slab": f.color, "--tex": `url(/finishes/${f.name.toLowerCase().replace(/ /g, "-")}.svg)` } as React.CSSProperties}>
                <span className="lp-slab-name">{f.name}</span>
              </li>
            ))}
          </ul>
          <dl className="lp-specs">
            <div>
              <dt>Walls</dt>
              <dd>{WALL_FINISHES.map((w) => WALL_FINISH_LABELS[w]).join(" · ")}, in any colour</dd>
            </div>
            <div>
              <dt>Ceiling</dt>
              <dd>{CEILING_TYPES.map((c) => CEILING_LABELS[c]).join(" · ")}</dd>
            </div>
            <div>
              <dt>Kitchen</dt>
              <dd className="lp-kitchens">
                {KITCHEN_LAYOUTS.map((k) => (
                  <span key={k}>
                    <KitchenGlyph layout={k} />
                    {KITCHEN_LAYOUT_LABELS[k]}
                  </span>
                ))}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section id="together" className="lp-marble lp-together" aria-labelledby="together-title">
        <div className="lp-wrap">
          <h2 id="together-title">A home is decided together</h2>
          <dl className="lp-rows">
            {TOGETHER.map((t) => (
              <div key={t.title}>
                <dt>{t.title}</dt>
                <dd>{t.text}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="lp-charcoal lp-close" aria-labelledby="close-title">
        <GoldVeins id="gold-rough-close" />
        <div className="lp-wrap">
          <h2 id="close-title">Start with what you have</h2>
          <p className="lp-lede">Your plot size and a few answers, or a photo of your sketch, is enough to begin.</p>
          <AskForm id="ask-close" />
          <p className="lp-fine">
            Just looking? <Link href="/design?demo=1">Open the demo studio</Link>.
          </p>
        </div>
      </section>

      <footer className="lp-charcoal lp-foot">
        <span className="lp-logo">
          Spac<span>i</span>fy
        </span>
        <span>Made for Indian homes</span>
        <nav aria-label="Footer">
          <Link href="/design?demo=1">Demo studio</Link>
          {user ? <Link href="/projects">My projects</Link> : <Link href="/login">Log in</Link>}
        </nav>
      </footer>
    </div>
  );
}
