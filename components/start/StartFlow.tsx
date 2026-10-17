"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthForm } from "@/components/auth/AuthForm";
import type { CurrentUser } from "@/lib/auth";
import { MAX_FLOORS } from "@/lib/rooms";
import { DEFAULT_SETBACKS, FACINGS, NOTES_MAX, PLOT, SETBACK_MAX, floorRooms, type Facing, type PlanBrief, type PlanOption } from "@/lib/planner";
import { PREF_TEXT, readNotes, type PrefKey } from "@/lib/planNotes";
import {
  BHK_OPTIONS,
  EXTRAS_FOR_TYPE,
  EXTRA_MAX,
  EXTRA_ROOMS,
  HANDOFF_KEY,
  HOME_TYPES,
  HOME_TYPE_LABELS,
  bathroomsFor,
  type ExtraRoom,
  type Handoff,
  type HomeType,
} from "@/lib/start";
import { Cascade } from "./Cascade";
import { GoldVeins } from "./GoldVeins";
import { LiquidMind, type LiquidHandle } from "./LiquidMind";
import { MindCanvas, type MindCanvasHandle } from "./MindCanvas";
import { PlanSheet } from "./PlanSheet";
import { PlanThumb } from "./PlanThumb";

type Step = "begin" | "sketch" | "type" | "bhk" | "plot" | "rooms" | "review";
type Stage = "asking" | "building" | "plans" | "sheet" | "house" | "error";

type Setbacks = PlanBrief["setbacks"];

type Answers = {
  homeType: HomeType | null;
  bhk: number | null;
  floors: number;
  extras: Partial<Record<ExtraRoom, number>>;
  width: number;
  depth: number;
  facing: Facing;
  setbacks: Setbacks;
  vastu: boolean;
  /** what the visitor wrote in their own words */
  notes: string;
};

const PLOT_FOR_TYPE: Record<HomeType, [number, number]> = { apartment: [30, 36], house: [30, 40], villa: [40, 60] };
const PRESETS: [number, number][] = [
  [20, 30],
  [30, 40],
  [30, 50],
  [40, 60],
  [50, 80],
];

const EMPTY: Answers = { homeType: null, bhk: null, floors: 1, extras: {}, width: 30, depth: 40, facing: "east", setbacks: DEFAULT_SETBACKS, vastu: true, notes: "" };
const STORAGE_KEY = "spacify-start-v2";
const PATH: Step[] = ["type", "bhk", "plot", "rooms", "review"];
const PATH_LABELS: Record<string, string> = { type: "Home", bhk: "BHK", plot: "Plot", rooms: "Rooms", review: "Plans" };

const TYPE_NOTES: Record<HomeType, string> = {
  apartment: "One floor in a building",
  house: "Your own plot, G to G+2",
  villa: "A plot with a garden around it",
};
const TYPE_HEARD: Record<HomeType, string> = {
  apartment: "Apartment. Drawing one floor of a building.",
  house: "Independent house. Marking out the plot.",
  villa: "Villa. Leaving space for a garden around it.",
};
const FACING_LABEL: Record<Facing, string> = { north: "North", east: "East", south: "South", west: "West" };
const FLOOR_NAMES = ["Ground", "First", "Second"];
const BLOB_WIDE: [number, number] = [0.5, 0.47];
const BLOB_NARROW: [number, number] = [0.5, 0.44];
const floorLabel = (n: number) => (n === 1 ? "G" : `G+${n - 1}`);
const fmt = (n: number) => n.toLocaleString("en-IN");

function plural(n: number, one: string) {
  return `${n} ${one}${n === 1 ? "" : "s"}`;
}

function describeBhk(bhk: number) {
  const beds = bhk - 1;
  const parts = ["living room", "kitchen", "master bedroom"];
  if (beds > 0) parts.push(plural(beds, "more bedroom"));
  parts.push(plural(bathroomsFor(bhk), "bathroom"));
  return `${bhk} BHK: ${parts.join(", ")}.`;
}

const clampPlot = (v: number, max: number) => Math.max(PLOT.min, Math.min(max, Math.round(v * 2) / 2 || PLOT.min));

type Props = {
  user: CurrentUser | null;
  initialType: HomeType | null;
  initialSketch: boolean;
};

/**
 * /start: a few questions about the home and the plot, each one visibly feeding the scene. Then the server
 * (POST /api/plans) lays out and scores many arrangements, with ideas from a local AI model when one is running,
 * and the best 4–5 come back as options. Logged-out visitors are asked to create an account only at the end.
 */
export function StartFlow({ user, initialType, initialSketch }: Props) {
  const mind = useRef<MindCanvasHandle>(null);
  const liquid = useRef<LiquidHandle>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pointerPick = useRef(false);
  const [answers, setAnswers] = useState<Answers>(() => (initialType ? withType(EMPTY, initialType) : EMPTY));
  const [step, setStep] = useState<Step>(initialSketch ? "sketch" : initialType ? "bhk" : "begin");
  const [stage, setStage] = useState<Stage>("asking");
  const [log, setLog] = useState<string[]>(() =>
    initialSketch ? ["Ready to read a sketch."] : initialType ? [TYPE_HEARD[initialType]] : ["Listening. Tell me about the home and the plot, and I'll work out the best layouts."]
  );
  const [options, setOptions] = useState<PlanOption[]>([]);
  const [picked, setPicked] = useState(0);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [heard, setHeard] = useState<{ understood: string[]; unmet: string[] }>({ understood: [], unmet: [] });
  const [error, setError] = useState<string | null>(null);
  const [auth, setAuth] = useState<"register" | "login" | null>(null);
  const [wide, setWide] = useState(true);

  const say = useCallback((line: string) => setLog((prev) => [...prev.slice(-5), line]), []);

  // Pick up answers from earlier in this tab (unless the landing page asked for something specific).
  useEffect(() => {
    if (initialType || initialSketch) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null") as { answers: Answers; step: Step } | null;
      if (saved?.answers?.homeType) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring from storage once after mount
        setAnswers({ ...EMPTY, ...saved.answers });
        setStep(saved.step ?? "type");
        setLog(["Picked up where you left off."]);
        liquid.current?.fill(3);
      }
    } catch {
      /* storage unavailable */
    }
    if (initialType) liquid.current?.fill(1);
  }, [initialType, initialSketch]);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ answers, step }));
    } catch {
      /* storage unavailable */
    }
  }, [answers, step]);

  const brief: PlanBrief | null = useMemo(
    () =>
      answers.homeType && answers.bhk
        ? {
            homeType: answers.homeType,
            bhk: answers.bhk,
            floors: answers.homeType === "apartment" ? 1 : answers.floors,
            extras: answers.extras,
            width: answers.width,
            depth: answers.depth,
            facing: answers.facing,
            setbacks: answers.homeType === "apartment" ? { front: 0, rear: 0, left: 0, right: 0 } : answers.setbacks,
            vastu: answers.vastu,
            notes: answers.notes.trim() ? answers.notes.trim().slice(0, NOTES_MAX) : undefined,
          }
        : null,
    [answers]
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Move focus to the new question, so keyboard and screen-reader users land on it.
  const firstFocus = useRef(true);
  const focusKey = stage === "plans" || stage === "sheet" || stage === "house" ? "plans" : `${step}-${stage}`;
  useEffect(() => {
    if (firstFocus.current) {
      firstFocus.current = false;
      return;
    }
    headingRef.current?.focus({ preventScroll: true });
  }, [focusKey]);

  // Wake the local AI model a step early, so it's loaded by the time the visitor asks for plans.
  const warmed = useRef(false);
  useEffect(() => {
    if (warmed.current || (step !== "rooms" && step !== "review")) return;
    warmed.current = true;
    fetch("/api/plans").catch(() => {});
  }, [step]);

  const go = (s: Step) => setStep(s);
  const advanceIfPointer = (to: Step) => {
    if (!pointerPick.current) return;
    pointerPick.current = false;
    setTimeout(() => setStep(to), 380);
  };

  function pickType(t: HomeType) {
    if (answers.homeType !== t) liquid.current?.absorb(HOME_TYPE_LABELS[t]);
    setAnswers((a) => (a.homeType === t ? a : withType(a, t)));
    say(TYPE_HEARD[t]);
    advanceIfPointer("bhk");
  }

  function pickBhk(n: number) {
    if (answers.bhk !== n) liquid.current?.absorb(`${n} BHK`);
    setAnswers((a) => ({ ...a, bhk: n }));
    say(describeBhk(n));
    advanceIfPointer("plot");
  }

  const plotTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastPlot = useRef<string | null>(null);
  function setPlot(width: number, depth: number) {
    const w = clampPlot(width, PLOT.maxWidth);
    const d = clampPlot(depth, PLOT.maxDepth);
    setAnswers((a) => ({ ...a, width: w, depth: d }));
    clearTimeout(plotTimer.current);
    plotTimer.current = setTimeout(() => {
      say(`${w} × ${d} ft plot. Fitting the rooms to it.`);
      if (lastPlot.current !== `${w}x${d}`) liquid.current?.absorb(`${w} × ${d} ft`, { mono: true });
      lastPlot.current = `${w}x${d}`;
    }, 450);
  }

  function setFacing(f: Facing) {
    if (answers.facing !== f) liquid.current?.absorb(`Road on the ${f}`);
    setAnswers((a) => ({ ...a, facing: f }));
    say(`Road on the ${f}. The entrance goes on that side${answers.vastu ? ", and the Vastu corners turn with it" : ""}.`);
  }

  function setFloors(n: number) {
    if (answers.floors !== n) liquid.current?.absorb(n === 1 ? "Ground floor only" : floorLabel(n), { mono: n > 1 });
    setAnswers((a) => ({ ...a, floors: n }));
    say(n === 1 ? "Single storey. Everything on the ground floor." : `${floorLabel(n)}. Bedrooms move upstairs, with a staircase on every floor.`);
  }

  function setVastu(on: boolean) {
    liquid.current?.absorb(on ? "Vastu" : "No Vastu");
    setAnswers((a) => ({ ...a, vastu: on }));
    say(on ? "Following Vastu: kitchen south-east, master bedroom south-west, pooja north-east." : "Vastu off. Layouts are judged on space, light and flow.");
  }

  function setSetback(side: keyof Setbacks, v: number) {
    setAnswers((a) => ({ ...a, setbacks: { ...a.setbacks, [side]: Math.max(0, Math.min(SETBACK_MAX, v || 0)) } }));
  }

  function changeExtra(room: ExtraRoom, delta: number) {
    const now = answers.extras[room] ?? 0;
    const next = Math.max(0, Math.min(EXTRA_MAX, now + delta));
    if (next === now) return;
    liquid.current?.absorb(`${delta > 0 ? "+" : "−"} ${room === "Bathroom" ? "Bathroom" : room}`);
    setAnswers((a) => ({ ...a, extras: { ...a.extras, [room]: next } }));
    say(delta > 0 ? `Added ${room === "Bathroom" ? "a bathroom" : `a ${room}`}.` : `Removed ${room === "Bathroom" ? "a bathroom" : `the ${room}`}.`);
  }

  /** The visitor's words join the blob as one drop, quoted, once they've finished typing. */
  const lastNotes = useRef("");
  function settleNotes() {
    const t = answers.notes.trim();
    if (!t || t === lastNotes.current) return;
    lastNotes.current = t;
    liquid.current?.absorb(`“${t.length > 26 ? `${t.slice(0, 24).trimEnd()}…` : t}”`);
    const { prefs, unmet } = readNotes(t);
    const got = (Object.keys(prefs) as PrefKey[]).filter((k) => prefs[k]);
    say(got.length ? `Noted: ${PREF_TEXT[got[0]].toLowerCase()}${got.length > 1 ? `, and ${plural(got.length - 1, "more wish")}` : ""}.` : unmet.length ? `Noted. I can't draw ${unmet[0]}, but I'll plan around the rest.` : "Noted. I'll read it with the plans.");
  }

  async function build() {
    if (!brief) return;
    setStage("building");
    setError(null);
    setAuth(null);
    liquid.current?.think(true);
    say(`Reading the plot: ${brief.width} × ${brief.depth} ft, road on the ${brief.facing}.`);
    const started = performance.now();
    const slow = setTimeout(() => say("Thinking it through with the local AI model. This can take up to a minute."), 2500);
    try {
      const res = await fetch("/api/plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(brief) });
      const body = (await res.json().catch(() => ({}))) as { options?: PlanOption[]; understood?: string[]; unmet?: string[]; ai?: { status: string; note?: string }; error?: string };
      clearTimeout(slow);
      if (!res.ok || !body.options?.length) throw new Error(body.error ?? "The planner didn't answer.");
      const aiUsed = body.ai?.status === "used";
      const aiCount = body.options.filter((o) => o.source === "ai").length;
      say(aiUsed ? `The AI suggested ideas; ${plural(aiCount, "made")} the shortlist.` : "Laid out with Spacify's planning rules.");
      setAiNote(aiUsed ? null : "These come from Spacify's planning rules. Ideas from the AI model will join them when it's switched on.");
      setHeard({ understood: body.understood ?? [], unmet: body.unmet ?? [] });
      if (body.understood?.length) say(`Planned around what you wrote: ${body.understood[0].toLowerCase()}${body.understood.length > 1 ? ", and more" : ""}.`);
      for (const o of body.options) {
        await new Promise((ok) => setTimeout(ok, 320));
        say(`${o.name}: ${o.score} / 100`);
      }
      const wait = 3200 - (performance.now() - started);
      if (wait > 0) await new Promise((ok) => setTimeout(ok, wait));
      liquid.current?.think(false);
      setOptions(body.options);
      setPicked(0);
      setStage("plans");
      await liquid.current?.split(body.options.map((o) => ({ title: o.name, score: o.score })));
      // A beat to see the drops, then they give way to the floor plans themselves
      await new Promise((ok) => setTimeout(ok, 1100));
      liquid.current?.setHidden(true);
      setStage("sheet");
      say(`${plural(body.options.length, "floor plan")}, best first. Download or share any of them.`);
    } catch (err) {
      clearTimeout(slow);
      const msg = err instanceof TypeError ? "Can't reach Spacify. Check your connection and try again." : (err as Error).message;
      setError(msg);
      setStage("error");
      say("The planning stopped. Nothing was lost.");
      liquid.current?.think(false);
    }
  }

  /** Shows a plan's 2D drawing (or its 3D model, if that's what's on screen). */
  function pickOption(i: number) {
    if (!options[i] || i === picked && stage !== "plans") return;
    setPicked(i);
    liquid.current?.setHidden(true);
    if (stage === "house") {
      mind.current?.reveal(options[i].rooms);
      say(`Raising ${options[i].name.toLowerCase()}. Drag it to turn it.`);
    } else {
      setStage("sheet");
      say(`${options[i].name}: the floor plan. Tap a room for its size.`);
    }
  }

  function show3d() {
    setStage("house");
    mind.current?.reveal(options[picked].rooms);
    say(`Raising ${options[picked].name.toLowerCase()}. Drag it to turn it.`);
  }

  function backTo2d() {
    setStage("sheet");
    mind.current?.unreveal();
  }

  /** The drops flow back into one blob and the questions come back. */
  async function changeAnswers() {
    setAuth(null);
    if (stage === "house") mind.current?.unreveal();
    liquid.current?.setHidden(false);
    setStage("asking");
    setStep("review");
    say("Back to your answers.");
    await liquid.current?.reform();
    setOptions([]);
  }

  /** Leaves the chosen plan for the studio, which opens with it. */
  function handOff() {
    const o = options[picked];
    if (!o || !brief) return;
    const handoff: Handoff = {
      name: `${brief.bhk} BHK ${HOME_TYPE_LABELS[brief.homeType].toLowerCase()}, ${brief.width}×${brief.depth}`,
      floors: Math.max(...o.rooms.map((r) => r.floor)),
      rooms: o.rooms,
    };
    try {
      sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(handoff));
    } catch {
      /* storage unavailable: the studio opens empty */
    }
  }

  const showingPlans = (stage === "plans" || stage === "sheet" || stage === "house") && options.length > 0;
  const house = stage === "house";
  const pathIndex = PATH.indexOf(step);
  const roomCount = brief ? floorRooms(brief).flat().length : 0;
  // Plot and floors only count once the visitor has reached the plot question.
  const plotKnown = stage !== "asking" || pathIndex >= PATH.indexOf("plot");
  const apartment = answers.homeType === "apartment";
  const sb = apartment ? { front: 0, rear: 0, left: 0, right: 0 } : answers.setbacks;
  const bw = Math.max(0, answers.width - sb.left - sb.right);
  const bl = Math.max(0, answers.depth - sb.front - sb.rear);

  // What the words read as so far (keywords, instant); the model reads them again with the plans.
  const notesRead = useMemo(() => readNotes(answers.notes), [answers.notes]);
  const notesHeard = (Object.keys(notesRead.prefs) as PrefKey[]).filter((k) => notesRead.prefs[k]);
  const notesUnmet = notesRead.unmet;

  // ─── Panels ─────────────────────────────────────────────

  function heading(children: React.ReactNode) {
    return (
      <h1 className="st-q" ref={headingRef} tabIndex={-1}>
        {children}
      </h1>
    );
  }

  function next(to: Step, disabled = false, label = "Next") {
    return (
      <button type="button" className="st-next" disabled={disabled} onClick={() => go(to)}>
        {label}
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M11 5l5 5-5 5" /></svg>
      </button>
    );
  }

  function back(to: Step) {
    return (
      <button type="button" className="st-back" onClick={() => go(to)}>
        Back
      </button>
    );
  }

  function cont(label: string, before?: () => void) {
    if (user) {
      return (
        <Link className="st-go" href="/design" onClick={before}>
          {label}
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M11 5l5 5-5 5" /></svg>
        </Link>
      );
    }
    return (
      <button
        type="button"
        className="st-go"
        onClick={() => {
          before?.();
          setAuth("register");
        }}
        aria-expanded={auth !== null}
      >
        {label}
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M11 5l5 5-5 5" /></svg>
      </button>
    );
  }

  function authSheet() {
    if (user || !auth) return null;
    return (
      <section className="st-auth" aria-label={auth === "register" ? "Create an account" : "Log in"}>
        <p className="st-auth-lede">
          {auth === "register"
            ? "Create a free account and the studio opens with this plan. Save it there to keep it."
            : "Welcome back. The studio opens with this plan as soon as you're in."}
        </p>
        <AuthForm key={auth} mode={auth} next="/design" onSwitch={() => setAuth(auth === "register" ? "login" : "register")} />
        <p className="st-auth-skip">
          Not ready? <Link href="/design?demo=1">Look around the demo studio</Link> first.
        </p>
      </section>
    );
  }

  let panel: React.ReactNode;
  if (stage === "building") {
    panel = (
      <div className="st-step" key="building">
        {heading(<>Finding your best plans</>)}
        <p className="st-help">
          Spacify is trying different arrangements on your plot, laying each one out to scale and scoring it for room sizes, daylight, how
          rooms connect{brief?.vastu ? " and Vastu" : ""}.
        </p>
        <div className="st-working" role="status">
          <span className="st-working-bar" />
          Working
        </div>
      </div>
    );
  } else if (showingPlans) {
    const o = options[picked];
    const floors = Math.max(...o.rooms.map((r) => r.floor));
    panel = (
      <div className="st-step" key="revealed">
        {heading(<>Your best plans</>)}
        <p className="st-help">
          {house
            ? "Drag the model to turn it. Pick another plan to compare it, or go back to the 2D plan."
            : `${plural(options.length, "floor plan")} for your ${o.plot.width} × ${o.plot.depth} ft plot, best first. Pick one to see its drawing; download or share it as an image.`}
        </p>
        <div className="st-options" role="radiogroup" aria-label="Plan options">
          {options.map((opt, i) => (
            <label key={opt.id} className={`st-option${i === picked ? " is-picked" : ""}`} onClick={() => pickOption(i)}>
              <input type="radio" name="option" checked={i === picked} onChange={() => {}} />
              <PlanThumb option={opt} />
              <span className="st-option-body">
                <span className="st-option-head">
                  <span className="st-option-name">{opt.name}</span>
                  <span className="st-option-score st-mono" aria-label={`Score ${opt.score} out of 100`}>{opt.score}</span>
                </span>
                {opt.source === "ai" && <span className="st-option-tag st-mono">AI idea</span>}
                <span className="st-option-why">{opt.why}</span>
              </span>
            </label>
          ))}
        </div>
        {(heard.understood.length > 0 || heard.unmet.length > 0) && (
          <div className="st-heard">
            {heard.understood.length > 0 && (
              <p>
                <span className="st-mono">Understood</span> {heard.understood.join(". ")}.
              </p>
            )}
            {heard.unmet.length > 0 && (
              <p>
                <span className="st-mono">Not drawn</span> {heard.unmet.join(", ")}: plans show rooms only.
              </p>
            )}
          </div>
        )}
        <div className="st-detail">
          <h2>{o.name}</h2>
          {o.highlights.length > 0 && (
            <ul className="st-good">
              {o.highlights.map((h) => (
                <li key={h}>
                  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10.5l4 4 8-9" /></svg>
                  {h}
                </li>
              ))}
            </ul>
          )}
          {o.watch.length > 0 && (
            <ul className="st-watch">
              {o.watch.map((w) => (
                <li key={w}>
                  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v7M10 15v.5" /></svg>
                  {w}
                </li>
              ))}
            </ul>
          )}
          <dl className="st-totals">
            <div><dt>Rooms</dt><dd><Cascade value={o.rooms.filter((r) => !/Passage|Staircase/.test(r.name)).length} /></dd></div>
            <div><dt>Sq ft built</dt><dd><Cascade value={fmt(o.builtUp)} /></dd></div>
            <div><dt>Floors</dt><dd><Cascade value={floorLabel(floors)} /></dd></div>
          </dl>
          {floors > 1 && (
            <div className="st-floor-thumbs">
              {Array.from({ length: floors }, (_, i) => (
                <figure key={i}>
                  <PlanThumb option={o} floor={i + 1} />
                  <figcaption className="st-mono">{FLOOR_NAMES[i]} floor</figcaption>
                </figure>
              ))}
            </div>
          )}
        </div>
        {aiNote && <p className="st-note">{aiNote}</p>}
        <div className="st-actions">
          {cont("Continue with this plan", handOff)}
          <button type="button" className="st-back" onClick={changeAnswers}>
            Change answers
          </button>
        </div>
        {authSheet()}
      </div>
    );
  } else if (step === "begin") {
    panel = (
      <div className="st-step" key="begin">
        {heading(<>How do you want to start?</>)}
        <div className="st-choices st-choices-big">
          <button type="button" className="st-choice" onClick={() => { say("Describing it. Starting with the kind of home."); go("type"); }}>
            <span className="st-choice-t">Help me plan it</span>
            <span className="st-choice-n">Tell us your plot and needs, get the best layouts</span>
          </button>
          <button type="button" className="st-choice" onClick={() => { say("Ready to read a sketch."); go("sketch"); }}>
            <span className="st-choice-t">I have a sketch</span>
            <span className="st-choice-n">Hand-drawn or digital, a photo is fine</span>
          </button>
        </div>
      </div>
    );
  } else if (step === "sketch") {
    panel = (
      <div className="st-step" key="sketch">
        {heading(<>Bring your sketch</>)}
        <p className="st-help">
          Take a photo or scan of it. In the studio, Spacify reads every labelled room and builds it to scale. Short labels like MB, B1, K,
          Pooja and WIC are understood, and sizes written as 14×13 are copied exactly.
        </p>
        <p className="st-note">The first read can take a minute while the model warms up.</p>
        <div className="st-actions">
          {cont("Continue to upload")}
          <button type="button" className="st-back" onClick={() => { say("Planning it instead."); go("type"); }}>
            Help me plan it instead
          </button>
        </div>
        {authSheet()}
      </div>
    );
  } else if (step === "type") {
    panel = (
      <div className="st-step" key="type">
        {heading(<>What are you building?</>)}
        <div className="st-choices" role="radiogroup" aria-label="Home type">
          {HOME_TYPES.map((t) => (
            <label key={t} className="st-choice" onPointerDown={() => (pointerPick.current = true)}>
              <input type="radio" name="homeType" checked={answers.homeType === t} onChange={() => pickType(t)} />
              <span className="st-choice-t">{HOME_TYPE_LABELS[t]}</span>
              <span className="st-choice-n">{TYPE_NOTES[t]}</span>
            </label>
          ))}
        </div>
        <div className="st-actions">
          {next("bhk", !answers.homeType)}
          {back("begin")}
        </div>
      </div>
    );
  } else if (step === "bhk") {
    panel = (
      <div className="st-step" key="bhk">
        {heading(<>How many bedrooms?</>)}
        <div className="st-bhk" role="radiogroup" aria-label="BHK">
          {BHK_OPTIONS.map((n) => (
            <label key={n} className="st-bhk-opt" onPointerDown={() => (pointerPick.current = true)}>
              <input type="radio" name="bhk" checked={answers.bhk === n} onChange={() => pickBhk(n)} />
              <span className="st-bhk-n">{n}</span>
              <span className="st-bhk-l">BHK</span>
            </label>
          ))}
        </div>
        {answers.bhk && <p className="st-help">{describeBhk(answers.bhk)}</p>}
        <div className="st-actions">
          {next("plot", !answers.bhk)}
          {back("type")}
        </div>
      </div>
    );
  } else if (step === "plot") {
    panel = (
      <div className="st-step" key="plot">
        {heading(apartment ? <>How big is the flat?</> : <>Tell us about the plot</>)}
        <div className="st-field">
          <span className="st-label" id="st-dims">{apartment ? "Outer size of the flat" : "Plot size"}</span>
          <div className="st-dims" role="group" aria-labelledby="st-dims">
            <label>
              <span className="st-sr">{apartment ? "Width" : "Width along the road"}, feet</span>
              <input type="number" inputMode="decimal" min={PLOT.min} max={PLOT.maxWidth} step={0.5} value={answers.width}
                onChange={(e) => setAnswers((a) => ({ ...a, width: Number(e.target.value) || a.width }))}
                onBlur={(e) => setPlot(Number(e.target.value), answers.depth)} />
            </label>
            <span aria-hidden="true">×</span>
            <label>
              <span className="st-sr">{apartment ? "Length" : "Depth from the road"}, feet</span>
              <input type="number" inputMode="decimal" min={PLOT.min} max={PLOT.maxDepth} step={0.5} value={answers.depth}
                onChange={(e) => setAnswers((a) => ({ ...a, depth: Number(e.target.value) || a.depth }))}
                onBlur={(e) => setPlot(answers.width, Number(e.target.value))} />
            </label>
            <span className="st-unit">ft</span>
          </div>
          <p className="st-dims-legend st-mono"><span>{apartment ? "width" : "along the road"}</span><span>{apartment ? "length" : "deep"}</span></p>
          {!apartment && (
            <div className="st-presets" aria-label="Common plot sizes">
              {PRESETS.map(([w, d]) => (
                <button key={`${w}x${d}`} type="button" className={answers.width === w && answers.depth === d ? "is-on" : ""} aria-pressed={answers.width === w && answers.depth === d} onClick={() => setPlot(w, d)}>
                  {w}×{d}
                </button>
              ))}
            </div>
          )}
        </div>
        <fieldset className="st-field">
          <legend>{apartment ? "The main door faces" : "The road is on the"}</legend>
          <div className="st-seg st-seg-4" role="radiogroup">
            {FACINGS.map((f) => (
              <label key={f}>
                <input type="radio" name="facing" checked={answers.facing === f} onChange={() => setFacing(f)} />
                <span>{FACING_LABEL[f]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {!apartment && (
          <fieldset className="st-field">
            <legend>Floors</legend>
            <div className="st-seg" role="radiogroup">
              {Array.from({ length: MAX_FLOORS }, (_, i) => i + 1).map((n) => (
                <label key={n}>
                  <input type="radio" name="floors" checked={answers.floors === n} onChange={() => setFloors(n)} />
                  <span>{floorLabel(n)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <label className="st-switch">
          <input type="checkbox" role="switch" checked={answers.vastu} onChange={(e) => setVastu(e.target.checked)} />
          <span className="st-switch-track" aria-hidden="true" />
          <span>Follow Vastu</span>
        </label>
        {!apartment && (
          <details className="st-setbacks">
            <summary>
              Setbacks <span className="st-mono">{sb.front} front · {sb.rear} rear · {sb.left} left · {sb.right} right</span>
            </summary>
            <p className="st-note">The open margin the rules ask you to leave at each edge. Check your local building rules.</p>
            <div className="st-setback-grid">
              {(["front", "rear", "left", "right"] as const).map((side) => (
                <label key={side}>
                  <span className="st-mono">{side}</span>
                  <input type="number" inputMode="decimal" min={0} max={SETBACK_MAX} step={0.5} value={answers.setbacks[side]} onChange={(e) => setSetback(side, Number(e.target.value))} />
                </label>
              ))}
            </div>
          </details>
        )}
        <p className="st-note st-mono">Buildable {bw} × {bl} ft · {fmt(Math.round(bw * bl))} sq ft per floor</p>
        <div className="st-actions">
          {next("rooms", bw < 10 || bl < 10)}
          {back("bhk")}
        </div>
      </div>
    );
  } else if (step === "rooms") {
    panel = (
      <div className="st-step" key="rooms">
        {heading(<>Anything else?</>)}
        <p className="st-help">
          Your {answers.bhk} BHK already has its bedrooms, kitchen, living room and {plural(bathroomsFor(answers.bhk ?? 1), "bathroom")}. Add or
          remove the rest.
        </p>
        <ul className="st-extras">
          {EXTRA_ROOMS.map((room) => {
            const n = answers.extras[room] ?? 0;
            return (
              <li key={room} className={n ? "is-on" : ""}>
                <span className="st-extra-name">{room === "Bathroom" ? "Extra bathroom" : room}</span>
                <div className="st-stepper">
                  <button type="button" onClick={() => changeExtra(room, -1)} disabled={n === 0} aria-label={`Remove ${room}`}>
                    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10h10" /></svg>
                  </button>
                  <span className="st-mono" aria-live="polite" aria-label={`${room}: ${n}`}>{n}</span>
                  <button type="button" onClick={() => changeExtra(room, 1)} disabled={n === EXTRA_MAX} aria-label={`Add ${room}`}>
                    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 10h10M10 5v10" /></svg>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <label className="st-notes">
          <span className="st-notes-label">In your own words <span className="st-mono">optional</span></span>
          <textarea
            value={answers.notes}
            maxLength={NOTES_MAX}
            rows={3}
            placeholder="My parents live with us and can't climb stairs. We have a car, and I'd like an open kitchen."
            onChange={(e) => setAnswers((a) => ({ ...a, notes: e.target.value }))}
            onBlur={settleNotes}
          />
          {notesHeard.length > 0 || notesUnmet.length > 0 ? (
            <span className="st-notes-heard" aria-live="polite">
              {notesHeard.length > 0 && <>Heard: {notesHeard.map((k) => PREF_TEXT[k].toLowerCase()).join("; ")}.</>}
              {notesUnmet.length > 0 && <> Can&apos;t draw {notesUnmet.join(", ")}.</>}
            </span>
          ) : (
            <span className="st-notes-heard">Who lives here, what matters, what to avoid. The planner reads it.</span>
          )}
        </label>
        <div className="st-actions">
          {next("review")}
          {back("plot")}
        </div>
      </div>
    );
  } else {
    const rooms = brief ? floorRooms(brief) : [];
    panel = (
      <div className="st-step" key="review">
        {heading(<>Ready to plan</>)}
        <p className="st-help">
          A {answers.bhk} BHK {answers.homeType ? HOME_TYPE_LABELS[answers.homeType].toLowerCase() : "home"} on a {answers.width} × {answers.depth} ft{" "}
          {apartment ? "flat" : "plot"}, road on the {answers.facing}{answers.vastu ? ", following Vastu" : ""}. Spacify will try different
          arrangements and keep the best.
        </p>
        {answers.notes.trim() && <blockquote className="st-quote">“{answers.notes.trim()}”</blockquote>}
        <div className="st-rooms">
          {rooms.map((list, i) => (
            <div key={i} className="st-floor">
              {rooms.length > 1 && <h2>{FLOOR_NAMES[i]} floor</h2>}
              <p className="st-roomlist">{list.join(" · ")}</p>
            </div>
          ))}
        </div>
        {error && (
          <p className="st-error" role="alert">
            {error}
          </p>
        )}
        <div className="st-actions">
          <button type="button" className="st-go" onClick={build} disabled={!brief}>
            {error ? "Try again" : "Find my best plans"}
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M11 5l5 5-5 5" /></svg>
          </button>
          {back("rooms")}
        </div>
      </div>
    );
  }

  const showPath = !showingPlans && stage !== "building" && pathIndex >= 0;

  return (
    <div className={`st${house ? " is-house" : ""}${stage === "sheet" ? " is-sheet" : ""}${stage === "building" ? " is-building" : ""}`}>
      <GoldVeins className="st-veins" progress={stage === "asking" || stage === "error" ? Math.max(0.08, (pathIndex + 1) / (PATH.length + 1)) : 1} />
      <MindCanvas ref={mind} houseOnly className="st-canvas" offset={wide ? -230 : 0} />
      <LiquidMind
        ref={liquid}
        className="st-liquid"
        spawn={wide ? "right" : "bottom"}
        center={wide ? BLOB_WIDE : BLOB_NARROW}
        picked={showingPlans ? picked : null}
        onPick={pickOption}
      />
      {house && (
        <button type="button" className="st-scene-back" onClick={backTo2d}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16 10H5M9 5l-5 5 5 5" /></svg>
          2D plan
        </button>
      )}
      {stage === "sheet" && options[picked] && brief && (
        <PlanSheet
          key={options[picked].id}
          option={options[picked]}
          meta={{
            title: `${options[picked].name}`,
            subtitle: `${brief.bhk} BHK ${HOME_TYPE_LABELS[brief.homeType].toLowerCase()} · ${brief.width} × ${brief.depth} ft plot · road on the ${brief.facing}`,
          }}
          on3d={show3d}
        />
      )}

      <header className="st-top">
        <Link href="/" className="st-logo" aria-label="Spacify home">
          Spac<span>i</span>fy
        </Link>
        {showPath && (
          <ol className="st-path" aria-label="Steps">
            {PATH.map((s, i) => (
              <li key={s} className={i < pathIndex ? "is-done" : i === pathIndex ? "is-now" : ""} aria-current={i === pathIndex ? "step" : undefined}>
                <button type="button" onClick={() => i < pathIndex && go(s)} disabled={i >= pathIndex}>
                  {PATH_LABELS[s]}
                </button>
              </li>
            ))}
          </ol>
        )}
        <div className="st-who">
          {user ? <Link href="/projects">{user.name.split(" ")[0]}&apos;s projects</Link> : <Link href="/login?next=%2Fstart">Log in</Link>}
        </div>
      </header>

      <aside className="st-panel">{panel}</aside>

      <div className="st-mind" aria-live="polite">
        <ol className="st-log">
          {log.slice(-3).map((line, i, arr) => (
            <li key={`${log.length}-${i}`} className={i === arr.length - 1 ? "is-new" : ""}>
              {line}
            </li>
          ))}
        </ol>
        <dl className="st-spec">
          <div><dt>Home</dt><dd>{answers.homeType ? HOME_TYPE_LABELS[answers.homeType] : "—"}</dd></div>
          <div><dt>BHK</dt><dd><Cascade value={answers.bhk ?? "—"} /></dd></div>
          <div><dt>Plot ft</dt><dd><Cascade value={plotKnown ? `${answers.width}×${answers.depth}` : "—"} /></dd></div>
          <div><dt>Floors</dt><dd><Cascade value={plotKnown ? floorLabel(apartment ? 1 : answers.floors) : "—"} /></dd></div>
          <div><dt>Rooms</dt><dd><Cascade value={answers.bhk ? roomCount : "—"} /></dd></div>
        </dl>
      </div>
    </div>
  );
}

/** Answers after picking a home type: its usual extras, plot size and floors (kept if the visitor already chose them). */
function withType(a: Answers, t: HomeType): Answers {
  const [w, d] = PLOT_FOR_TYPE[t];
  const untouchedPlot = !a.homeType || (a.width === PLOT_FOR_TYPE[a.homeType][0] && a.depth === PLOT_FOR_TYPE[a.homeType][1]);
  return {
    ...a,
    homeType: t,
    extras: { ...EXTRAS_FOR_TYPE[t] },
    floors: t === "apartment" ? 1 : a.floors,
    width: untouchedPlot ? w : a.width,
    depth: untouchedPlot ? d : a.depth,
  };
}
