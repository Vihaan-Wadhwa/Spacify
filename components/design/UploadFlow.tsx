"use client";

import { useEffect, useState } from "react";
import { compressImage } from "@/lib/browser";
import type { RoomDraft } from "@/lib/rooms";

type UploadState =
  | { kind: "idle" }
  | { kind: "analysing"; preview: string }
  | { kind: "found"; preview: string; rooms: RoomDraft[] }
  | { kind: "error"; preview: string | null; message: string };

type Props = {
  showEmptyState: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onAccept: (rooms: RoomDraft[]) => void;
  onShowTutorial: () => void;
  onAddManually: () => void;
};

/** The "upload your sketch" card, plus the preview/analysis overlay that follows an upload. */
export function UploadFlow({ showEmptyState, inputRef, onAccept, onShowTutorial, onAddManually }: Props) {
  const [state, setState] = useState<UploadState>({ kind: "idle" });

  async function handleFile(file: File | undefined) {
    if (!file) return;
    let image: Awaited<ReturnType<typeof compressImage>>;
    try {
      // 1024px keeps handwritten labels legible for the vision model while staying ~150 KB.
      image = await compressImage(file, 1024, 0.8);
    } catch (err) {
      setState({ kind: "error", preview: null, message: (err as Error).message });
      return;
    }
    setState({ kind: "analysing", preview: image.dataUrl });
    try {
      const res = await fetch("/api/sketch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: image.base64, mimeType: image.mimeType, width: image.width, height: image.height }),
      });
      const data = (await res.json()) as { rooms?: RoomDraft[]; error?: string };
      if (res.ok && data.rooms?.length) setState({ kind: "found", preview: image.dataUrl, rooms: data.rooms });
      else setState({ kind: "error", preview: image.dataUrl, message: data.error ?? "Could not detect rooms. Try a clearer sketch or add rooms manually." });
    } catch {
      setState({ kind: "error", preview: image.dataUrl, message: "Couldn't reach the server. Check your connection, or add rooms manually." });
    }
  }

  function reset() {
    setState({ kind: "idle" });
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      {showEmptyState && (
        <div className="empty-state">
          <div className="upload-card">
            <div className="upload-icon">⬆</div>
            <h3>Upload your sketch</h3>
            <p>A photo of a hand-drawn floor plan or a digital drawing. AI will read the rooms and build your 3D model.</p>
            <button className="upload-btn" onClick={() => inputRef.current?.click()}>Upload sketch</button>
            <p className="hint">JPG or PNG · hand-drawn or digital</p>
            <div className="upload-divider"><span>or</span></div>
            <div className="upload-links">
              <button className="manual-btn" onClick={onShowTutorial}>View sketch tutorial →</button>
              <button className="manual-btn" onClick={onAddManually}>Add rooms manually</button>
            </div>
          </div>
        </div>
      )}

      {state.kind !== "idle" && (
        <div className="upload-overlay">
          {/* eslint-disable-next-line @next/next/no-img-element -- local data URL preview, nothing to optimise */}
          {state.preview && <img src={state.preview} alt="Your uploaded sketch" />}

          {state.kind === "analysing" && (
            <AnalysingStatus />
          )}

          {state.kind === "found" && (
            <div className="upload-actions">
              <p>
                Found {state.rooms.length} rooms: {state.rooms.map((r) => r.name).join(", ")}. Ready to build your 3D model.
              </p>
              <div className="row">
                <button
                  className="upload-btn"
                  onClick={() => {
                    onAccept(state.rooms);
                    reset();
                  }}
                >
                  Build 3D model →
                </button>
                <button className="manual-btn" onClick={reset}>Cancel</button>
              </div>
            </div>
          )}

          {state.kind === "error" && (
            <div className="upload-actions">
              <p>{state.message}</p>
              <div className="row">
                <button className="upload-btn" onClick={() => { reset(); inputRef.current?.click(); }}>Try another sketch</button>
                <button className="manual-btn" onClick={() => { reset(); onAddManually(); }}>Enter rooms manually →</button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** Spinner with a seconds counter — a busy sketch can take a while, so show that it's still working. */
function AnalysingStatus() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="upload-actions">
      <div className="upload-status">
        <span className="spinner">◌</span>
        <span>Analysing your sketch with AI... {seconds > 0 && `${seconds}s`}</span>
      </div>
      {seconds >= 15 && <p className="hint">Busy sketches can take up to a minute.</p>}
    </div>
  );
}
