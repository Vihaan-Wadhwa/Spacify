"use client";

import { useEffect, useState } from "react";
import { LiquidMind } from "@/components/start/LiquidMind";

const WIDE_CENTER: [number, number] = [0.72, 0.5];
const NARROW_CENTER: [number, number] = [0.5, 0.42];

/** The landing hero's scene: the /start blob taking in a sample house, thinking, and splitting into plans, on a loop. */
export function HeroMind() {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return <LiquidMind demo className="lp-hero-scene" spawn={wide ? "right" : "bottom"} center={wide ? WIDE_CENTER : NARROW_CENTER} />;
}
