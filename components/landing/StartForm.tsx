"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const ROOM_OPTIONS = [
  "Master bedroom",
  "Bedroom 2",
  "Bedroom 3",
  "Kitchen",
  "Living room",
  "Bathroom",
  "Pooja room",
  "Study",
  "Walk-in closet",
  "Balcony",
  "Store room",
];

type SubmitState = "idle" | "error" | "loading";

export function StartForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [selectedRooms, setSelectedRooms] = useState<Set<string>>(new Set());
  const [state, setState] = useState<SubmitState>("idle");

  function toggleRoom(room: string) {
    setSelectedRooms((prev) => {
      const next = new Set(prev);
      if (next.has(room)) next.delete(room);
      else next.add(room);
      return next;
    });
  }

  function handleSubmit() {
    if (!name.trim() || !email.trim()) {
      setState("error");
      setTimeout(() => setState("idle"), 2000);
      return;
    }
    // TODO (Task 4): create the user/project via /api/projects before redirecting.
    setState("loading");
    setTimeout(() => router.push("/design?new=1"), 1200);
  }

  const label =
    state === "error" ? "Please fill name & email" : state === "loading" ? "Setting up your project..." : "Create my project →";

  return (
    <div>
      <div className="form-group">
        <label htmlFor="sf-name">Your name</label>
        <input id="sf-name" type="text" placeholder="Rahul Sharma" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="form-group">
        <label htmlFor="sf-email">Email address</label>
        <input id="sf-email" type="email" placeholder="rahul@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="form-group">
        <label htmlFor="sf-type">Project type</label>
        <select id="sf-type" defaultValue="Residential — apartment">
          <option>Residential — apartment</option>
          <option>Residential — independent house</option>
          <option>Villa / bungalow</option>
          <option>Commercial</option>
        </select>
      </div>
      <div className="form-group">
        <label htmlFor="sf-area">Total area (sq ft)</label>
        <input id="sf-area" type="number" placeholder="1200" />
      </div>
      <div className="form-group">
        <label htmlFor="sf-floors">Number of floors</label>
        <input id="sf-floors" type="number" placeholder="1" min={1} max={10} />
      </div>
      <div className="form-group">
        <label>Rooms needed</label>
        <div className="room-grid">
          {ROOM_OPTIONS.map((room) => (
            <span
              key={room}
              role="checkbox"
              aria-checked={selectedRooms.has(room)}
              tabIndex={0}
              className={`room-chip${selectedRooms.has(room) ? " selected" : ""}`}
              onClick={() => toggleRoom(room)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && toggleRoom(room)}
            >
              {room}
            </span>
          ))}
        </div>
      </div>
      <div className="form-group">
        <label htmlFor="sf-notes">Any special requirements</label>
        <textarea id="sf-notes" placeholder="Vastu-compliant layout, corner plot, open kitchen preference..." />
      </div>
      <button className={`submit-btn${state === "idle" ? "" : ` ${state}`}`} onClick={handleSubmit} disabled={state === "loading"}>
        {label}
      </button>
    </div>
  );
}
