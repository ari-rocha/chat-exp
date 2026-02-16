import { useEffect, useRef, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:4000/ws";

export default function App() {
  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState("");
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [visitorDraftBySession, setVisitorDraftBySession] = useState({});

  const activeIdRef = useRef("");
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const typingIdleTimerRef = useRef(null);
  const typingActiveRef = useRef(false);

  const sendWsEvent = (event, data) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ event, data }));
  };

  const sendTypingState = (active, sessionOverride) => {
    const sessionId = sessionOverride ?? activeIdRef.current;
    if (!sessionId) return;
    if (typingActiveRef.current === active && !sessionOverride) return;
    typingActiveRef.current = active;
    sendWsEvent("agent:typing", { sessionId, active });
  };

  const bumpTyping = () => {
    if (!activeIdRef.current) return;
    sendTypingState(true);
    if (typingIdleTimerRef.current) clearTimeout(typingIdleTimerRef.current);
    typingIdleTimerRef.current = setTimeout(() => {
      sendTypingState(false);
    }, 1200);
  };

  useEffect(() => {
    fetch(`${API_URL}/api/sessions`)
      .then((r) => r.json())
      .then((data) => setSessions(data.sessions ?? []))
      .catch((e) => console.error("failed to load sessions", e));

    let closedByCleanup = false;

    const connect = () => {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        sendWsEvent("agent:join", {});
        if (activeIdRef.current) {
          sendWsEvent("agent:watch-session", { sessionId: activeIdRef.current });
          sendWsEvent("agent:request-history", { sessionId: activeIdRef.current });
        }
      });

      ws.addEventListener("message", (event) => {
        let envelope;
        try {
          envelope = JSON.parse(event.data);
        } catch {
          return;
        }

        if (envelope?.event === "sessions:list") {
          setSessions(Array.isArray(envelope.data) ? envelope.data : []);
        }

        if (envelope?.event === "session:updated") {
          const session = envelope.data;
          setSessions((prev) => {
            const next = prev.filter((s) => s.id !== session.id);
            return [session, ...next];
          });
        }

        if (envelope?.event === "session:history") {
          setMessages(Array.isArray(envelope.data) ? envelope.data : []);
        }

        if (envelope?.event === "message:new") {
          const message = envelope.data;
          if (!message || message.sessionId !== activeIdRef.current) return;
          setMessages((prev) => {
            if (prev.some((m) => m.id === message.id)) return prev;
            return [...prev, message];
          });
          if (message.sender === "visitor") {
            setVisitorDraftBySession((prev) => {
              const next = { ...prev };
              delete next[message.sessionId];
              return next;
            });
          }
        }

        if (envelope?.event === "visitor:typing") {
          const payload = envelope.data ?? {};
          const sessionId = payload.sessionId;
          if (!sessionId) return;

          const active = Boolean(payload.active);
          const draft = String(payload.text ?? "");

          setVisitorDraftBySession((prev) => {
            const next = { ...prev };
            if (!active || draft.trim().length === 0) {
              delete next[sessionId];
            } else {
              next[sessionId] = draft;
            }
            return next;
          });
        }
      });

      ws.addEventListener("close", () => {
        if (closedByCleanup) return;
        typingActiveRef.current = false;
        reconnectTimerRef.current = setTimeout(connect, 800);
      });
    };

    connect();

    return () => {
      closedByCleanup = true;
      if (typingIdleTimerRef.current) clearTimeout(typingIdleTimerRef.current);
      sendTypingState(false);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) wsRef.current.close();
      wsRef.current = null;
    };
  }, []);

  useEffect(() => {
    const previous = activeIdRef.current;
    if (previous && previous !== activeId) {
      sendTypingState(false, previous);
      typingActiveRef.current = false;
      if (typingIdleTimerRef.current) clearTimeout(typingIdleTimerRef.current);
    }

    activeIdRef.current = activeId;
    if (!activeId) {
      setMessages([]);
      return;
    }

    sendWsEvent("agent:watch-session", { sessionId: activeId });
    sendWsEvent("agent:request-history", { sessionId: activeId });
  }, [activeId]);

  const send = (e) => {
    e.preventDefault();
    if (!activeId || !text.trim()) return;

    sendTypingState(false);
    sendWsEvent("agent:message", { sessionId: activeId, text: text.trim() });
    setText("");
  };

  return (
    <div className="shell">
      <aside className="sessions">
        <h1>Active Conversations</h1>
        {sessions.map((s) => (
          <button
            key={s.id}
            className={activeId === s.id ? "session active" : "session"}
            onClick={() => setActiveId(s.id)}
          >
            <strong>{s.id.slice(0, 8)}</strong>
            <span>{s.lastMessage?.text ?? "No messages yet"}</span>
          </button>
        ))}
      </aside>

      <main className="chat">
        <header>{activeId ? `Session: ${activeId}` : "Choose a session"}</header>
        <div className="messages">
          {messages.map((m) => (
            <div key={m.id} className={`msg ${m.sender}`}>
              <span>{m.sender}</span>
              <p>{m.text}</p>
            </div>
          ))}
          {activeId && visitorDraftBySession[activeId] && (
            <div className="msg visitor msg-draft">
              <span>visitor (typing)</span>
              <p>{visitorDraftBySession[activeId]}</p>
            </div>
          )}
        </div>
        <form onSubmit={send} className="input-row">
          <input
            placeholder="Reply as agent..."
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              bumpTyping();
            }}
            onBlur={() => sendTypingState(false)}
            disabled={!activeId}
          />
          <button type="submit" disabled={!activeId}>
            Send
          </button>
        </form>
      </main>
    </div>
  );
}
