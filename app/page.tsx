import Link from "next/link";
import { Reveal } from "@/components/landing/Reveal";
import { StartForm } from "@/components/landing/StartForm";
import { ThemeToggleButton } from "@/components/ThemeToggleButton";
import "./landing.css";

const DEMO_ROOMS: { x: number; y: number; w: number; h: number; label: string; tx: number; ty: number; fill?: number }[] = [
  { x: 20, y: 20, w: 160, h: 120, label: "LIVING ROOM", tx: 100, ty: 82 },
  { x: 180, y: 20, w: 180, h: 130, label: "MASTER BED", tx: 270, ty: 82 },
  { x: 20, y: 140, w: 100, h: 120, label: "KITCHEN", tx: 70, ty: 202, fill: 0.05 },
  { x: 120, y: 140, w: 120, h: 120, label: "BEDROOM 2", tx: 180, ty: 202 },
  { x: 240, y: 150, w: 120, h: 55, label: "BATH", tx: 300, ty: 179 },
  { x: 240, y: 205, w: 120, h: 55, label: "STORE", tx: 300, ty: 234 },
];

const STEPS = [
  { n: "01", title: "Sketch your plan", text: "Draw on paper or digitally. Follow our guided tutorial with example sketches to mark rooms — MB, B1, Kitchen, Pooja, and more." },
  { n: "02", title: "Enter dimensions", text: "Input total area, length, width, and individual room sizes. Or upload a sketch and let AI read the measurements automatically." },
  { n: "03", title: "Explore in 3D", text: "Rotate, zoom, and flip your interactive model. Toggle between raw structure and fully furnished interiors with one click." },
];

const FEATURES = [
  { icon: "⬜", title: "Interactive 3D model", text: "Rotate, flip, zoom your floor plan. Walk through every room with real spatial proportions." },
  { icon: "◑", title: "Interior toggle", text: "Switch between bare walls and fully furnished vision — beds, cupboards, kitchen cabinets, and more." },
  { icon: "◈", title: "Room labelling system", text: "Mark every space precisely: MB, B1, B2, WIC, Pooja, Study, Balcony, Store — with guided tutorial." },
  { icon: "⬡", title: "Multi-floor support", text: "Design G+1, G+2 buildings with staircase placement and floor-by-floor 3D views." },
  {
    icon: "✦",
    title: "AI design assistant",
    text: "Chat with Spacify's AI to get wall colour suggestions, kitchen layout ideas, false ceiling designs, tile vs marble recommendations — and auto-fill your 3D model with a single prompt.",
    wide: true,
  },
];

export default function LandingPage() {
  return (
    <div className="landing">
      <nav className="nav">
        <Link href="/" className="nav-logo">
          Spac<span>i</span>fy
        </Link>
        <div className="nav-right">
          <ul className="nav-links">
            <li><a href="#how">How it works</a></li>
            <li><a href="#features">Features</a></li>
            <li><a href="#start">Get started</a></li>
          </ul>
          <ThemeToggleButton className="theme-btn" />
        </div>
      </nav>

      <div className="hero">
        <div className="hero-grid" />
        <div className="hero-tag">✦ AI-Powered Architecture</div>
        <h1>
          Turn rough sketches into
          <br />
          <em>living</em> 3D spaces
        </h1>
        <p>Upload your floor plan, label your rooms, and watch Spacify build an interactive 3D model — powered by AI.</p>
        <div className="hero-cta">
          <a href="#start" className="btn-primary">Start your project</a>
          <a href="#how" className="btn-secondary">See how it works</a>
        </div>

        <div className="hero-visual">
          <div className="demo-topbar">
            <div className="dot r" /><div className="dot y" /><div className="dot g" />
            <span className="demo-label">spacify.in — project editor</span>
          </div>
          <div className="demo-body">
            <div className="demo-canvas">
              <svg className="floor-plan" viewBox="0 0 380 280" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ fontFamily: "var(--sans)" }}>
                <rect x="20" y="20" width="340" height="240" rx="2" stroke="currentColor" strokeWidth="2.5" fill="none" opacity="0.2" />
                {DEMO_ROOMS.map((r) => (
                  <g key={r.label}>
                    <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="currentColor" fillOpacity={r.fill ?? 0.03} stroke="currentColor" strokeOpacity="0.12" strokeWidth="1" />
                    <text x={r.tx} y={r.ty} textAnchor="middle" fontSize="9" fill="currentColor" fillOpacity="0.4" letterSpacing="0.08em">
                      {r.label}
                    </text>
                  </g>
                ))}
                <path d="M180 110 Q200 110 200 130" stroke="#c8f0a0" strokeWidth="1" strokeDasharray="3 2" fill="none" opacity="0.5" />
                <path d="M70 140 Q70 155 85 155" stroke="#c8f0a0" strokeWidth="1" strokeDasharray="3 2" fill="none" opacity="0.5" />
              </svg>
            </div>
            <div className="demo-sidebar">
              <div className="sidebar-section">
                <h4>Rooms</h4>
                <div>
                  {["MB", "B2", "Kitchen", "Bath"].map((t) => <span key={t} className="room-tag active">{t}</span>)}
                  {["WIC", "Pooja", "Study"].map((t) => <span key={t} className="room-tag">{t}</span>)}
                </div>
              </div>
              <div className="sidebar-section">
                <h4>Dimensions</h4>
                <div className="input-row">
                  <label htmlFor="demo-area">Total area (sq ft)</label>
                  <input id="demo-area" type="text" defaultValue="1,450" />
                </div>
                <div className="input-row">
                  <label htmlFor="demo-floors">Floors</label>
                  <input id="demo-floors" type="text" defaultValue="1" />
                </div>
              </div>
              <Link href="/design?demo=1" className="generate-btn">Generate 3D Model →</Link>
            </div>
          </div>
        </div>
      </div>

      <section id="how">
        <Reveal>
          <div className="section-eyebrow">Process</div>
          <h2 className="section-heading">Three steps to<br />your 3D home</h2>
        </Reveal>
        <Reveal className="steps">
          {STEPS.map((s) => (
            <div key={s.n} className="step">
              <div className="step-num">{s.n}</div>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </div>
          ))}
        </Reveal>
      </section>

      <hr className="divider" />

      <section id="features">
        <Reveal>
          <div className="section-eyebrow">Features</div>
          <h2 className="section-heading">Everything a designer<br />actually needs</h2>
          <p className="section-sub">Built for Indian property designers and builders — from 1BHK to multi-storey villas.</p>
        </Reveal>
        <Reveal className="features-grid">
          {FEATURES.map((f) => (
            <div key={f.title} className={`feature-card${f.wide ? " wide" : ""}`}>
              <div className="feat-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </div>
          ))}
        </Reveal>
      </section>

      <hr className="divider" />

      <section id="start">
        <Reveal>
          <div className="section-eyebrow">Get started</div>
          <h2 className="section-heading">Start your first<br />project today</h2>
        </Reveal>
        <Reveal className="form-wrapper">
          <StartForm />
          <div className="form-info">
            <h3>What happens next?</h3>
            <p>Fill in your details and we&apos;ll set up your project workspace — ready for you to upload your sketch and generate a 3D model.</p>
            <ul className="info-list">
              <li>Upload a hand-drawn or digital floor plan sketch</li>
              <li>Label rooms using our guided system</li>
              <li>Generate your interactive 3D model instantly</li>
              <li>Chat with AI to design interiors</li>
              <li>Share a link with your client</li>
            </ul>
          </div>
        </Reveal>
      </section>

      <footer>
        <div className="footer-logo">Spac<span>i</span>fy</div>
        <p>Built for Indian architects &amp; designers · 2025</p>
      </footer>
    </div>
  );
}
