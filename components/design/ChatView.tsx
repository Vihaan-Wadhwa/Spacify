"use client";

import { useEffect, useRef, useState } from "react";

type Message = { id: number; role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Suggest wall colours for living room",
  "Best kitchen layout for small space",
  "Vastu tips for master bedroom",
  "False ceiling ideas",
  "Marble vs vitrified tiles",
];

const GREETING =
  "Hi! I'm your Spacify design assistant. I can suggest wall colours, kitchen layouts, flooring, false ceiling designs, Vastu tips, and more. What would you like help with?";

type Props = {
  visible: boolean;
  /** Plain-English summary of the current rooms, sent along so replies fit the project. */
  projectContext: string;
  /** Saved project id; when set, answers are logged to the ai_suggestions table. */
  projectId: number | null;
};

export function ChatView({ visible, projectContext, projectId }: Props) {
  const [messages, setMessages] = useState<Message[]>([{ id: 0, role: "assistant", content: GREETING }]);
  const [input, setInput] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [offline, setOffline] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nextId = useRef(1);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, waiting]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || waiting) return;
    const history = messages.slice(1).slice(-10).map(({ role, content }) => ({ role, content }));
    setMessages((m) => [...m, { id: nextId.current++, role: "user", content: message }]);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setWaiting(true);

    let reply: string;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history, projectContext, projectId: projectId ?? undefined }),
      });
      const data = (await res.json()) as { reply?: string; source?: string; error?: string };
      reply = data.reply ?? data.error ?? "Something went wrong. Please try again.";
      setOffline(data.source === "fallback");
    } catch {
      reply = "I couldn't reach the server. Check your connection and try again.";
      setOffline(true);
    }
    setMessages((m) => [...m, { id: nextId.current++, role: "assistant", content: reply }]);
    setWaiting(false);
  }

  return (
    <div className="chat-view" style={visible ? undefined : { display: "none" }}>
      <div className="chat-header">
        <div className="chat-avatar">✦</div>
        <div className="chat-header-info">
          <h4>Spacify AI</h4>
          <p>{offline ? "Offline answers — connect the chat workflow for full AI" : "Interior design assistant"}</p>
        </div>
        <div className={`chat-status${offline ? " offline" : ""}`} />
      </div>

      <div className="chat-messages" ref={listRef}>
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role === "assistant" ? "ai" : "user"}`}>
            <div className="msg-avatar">{m.role === "assistant" ? "✦" : "👤"}</div>
            <div className="msg-bubble">{m.content}</div>
          </div>
        ))}
        {waiting && (
          <div className="msg ai">
            <div className="msg-avatar">✦</div>
            <div className="msg-bubble">
              <div className="typing-indicator" aria-label="Spacify AI is typing">
                <div className="typing-dot" />
                <div className="typing-dot" />
                <div className="typing-dot" />
              </div>
            </div>
          </div>
        )}
      </div>

      {messages.length === 1 && (
        <div className="chat-suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s} className="suggestion" onClick={() => send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="chat-input-row">
        <textarea
          ref={inputRef}
          className="chat-input"
          placeholder="Ask about colours, layouts, materials..."
          rows={1}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 100)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
        />
        <button className="chat-send" onClick={() => send(input)} disabled={waiting || !input.trim()} aria-label="Send">
          ↑
        </button>
      </div>
    </div>
  );
}
