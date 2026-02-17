import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:4000/ws";

const icon = (
  <svg viewBox="0 0 48 48" aria-hidden="true">
    <circle cx="24" cy="24" r="24" fill="var(--gold)" />
    <path
      d="M24 11c-6.3 0-11.5 4.9-11.5 10.9 0 3.6 1.8 6.8 4.7 8.8V37l5.1-3.2c.6.1 1.2.1 1.7.1 6.4 0 11.5-4.9 11.5-11S30.4 11 24 11Zm-4 10.2a1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 1 0 3.6Zm8 0a1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 1 0 3.6Z"
      fill="#000"
    />
  </svg>
);

export default function App() {
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState(
    localStorage.getItem("chat_session_id") || "",
  );
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [ready, setReady] = useState(false);
  const [agentTyping, setAgentTyping] = useState(false);
  const [dismissedSuggestionsFor, setDismissedSuggestionsFor] = useState("");

  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const visitorTypingIdleTimerRef = useRef(null);
  const tempIdRef = useRef(0);
  const listRef = useRef(null);
  const stickToBottomRef = useRef(true);

  const sendWsEvent = (event, data) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ event, data }));
  };

  const latestSuggestionSource = useMemo(() => {
    if (!Array.isArray(messages) || messages.length === 0) return null;
    const last = messages[messages.length - 1];
    if (!last || last.sender !== "agent") return null;
    if (!Array.isArray(last.suggestions) || last.suggestions.length === 0) {
      return null;
    }
    return last;
  }, [messages]);

  const sendVisitorTyping = (nextText, forceActive) => {
    if (!sessionId) return;
    const normalized = String(nextText ?? "");
    const active =
      typeof forceActive === "boolean"
        ? forceActive
        : normalized.trim().length > 0;

    sendWsEvent("visitor:typing", {
      sessionId,
      text: normalized,
      active,
    });
  };

  const mergeMessage = (incoming) => {
    if (!incoming || typeof incoming !== "object") return;
    setMessages((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      if (list.some((m) => m.id === incoming.id)) return list;
      return [...list, incoming].sort((a, b) => {
        return String(a.createdAt || "").localeCompare(
          String(b.createdAt || ""),
        );
      });
    });
  };

  const loadHistory = async (id) => {
    const res = await fetch(`${API_URL}/api/session/${id}/messages`);
    const data = await res.json();
    setMessages(Array.isArray(data.messages) ? data.messages : []);
    setReady(true);
  };

  useEffect(() => {
    const boot = async () => {
      if (sessionId) return;
      const res = await fetch(`${API_URL}/api/session`, { method: "POST" });
      const data = await res.json();
      setSessionId(data.sessionId);
      localStorage.setItem("chat_session_id", data.sessionId);
    };

    boot().catch((error) => console.error("session bootstrap failed", error));
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;

    let closedByCleanup = false;
    setAgentTyping(false);

    const connect = () => {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        sendWsEvent("widget:join", { sessionId });
      });

      ws.addEventListener("message", (event) => {
        let envelope;
        try {
          envelope = JSON.parse(event.data);
        } catch {
          return;
        }

        if (envelope?.event === "session:history") {
          const history = Array.isArray(envelope.data) ? envelope.data : [];
          setMessages((prev) => {
            const current = Array.isArray(prev) ? prev : [];
            if (current.length > 0 && history.length === 0) return current;
            const byId = new Map();
            [...current, ...history].forEach((m) => {
              if (m?.id) byId.set(m.id, m);
            });
            return [...byId.values()].sort((a, b) => {
              return String(a.createdAt || "").localeCompare(
                String(b.createdAt || ""),
              );
            });
          });
          setReady(true);
        }

        if (envelope?.event === "message:new") {
          mergeMessage(envelope.data);
        }

        if (envelope?.event === "typing") {
          const payload = envelope.data ?? {};
          if (payload.sessionId !== sessionId) return;
          if (payload.sender !== "agent") return;
          setAgentTyping(Boolean(payload.active));
        }
      });

      ws.addEventListener("close", () => {
        if (closedByCleanup) return;
        reconnectTimerRef.current = setTimeout(connect, 800);
      });
    };

    setReady(false);
    loadHistory(sessionId).catch((error) =>
      console.error("failed to load history", error),
    );
    connect();

    return () => {
      closedByCleanup = true;
      if (visitorTypingIdleTimerRef.current)
        clearTimeout(visitorTypingIdleTimerRef.current);
      sendVisitorTyping("", false);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) wsRef.current.close();
      wsRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!listRef.current) return;
    if (!stickToBottomRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, agentTyping, open]);

  const onBodyScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 40;
  };

  const send = (e) => {
    e.preventDefault();
    if (!text.trim() || !sessionId) return;
    sendText(text.trim());
  };

  const sendText = (value) => {
    if (!value || !sessionId) return;
    const tempId = `temp-${Date.now()}-${tempIdRef.current++}`;
    const optimistic = {
      id: tempId,
      sessionId,
      sender: "visitor",
      text: value,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...(Array.isArray(prev) ? prev : []), optimistic]);
    setDismissedSuggestionsFor("");
    sendVisitorTyping("", false);
    setText("");

    fetch(`${API_URL}/api/session/${sessionId}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sender: "visitor", text: value }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (!data?.message) return;
        setMessages((prev) => {
          const list = Array.isArray(prev) ? prev : [];
          const withoutTemp = list.filter((m) => m.id !== tempId);
          if (withoutTemp.some((m) => m.id === data.message.id))
            return withoutTemp;
          return [...withoutTemp, data.message];
        });
      })
      .catch((error) => {
        console.error("failed to send message", error);
        setMessages((prev) =>
          Array.isArray(prev) ? prev.filter((m) => m.id !== tempId) : [],
        );
      });
  };

  const sendSuggestion = (value) => {
    if (latestSuggestionSource?.id) {
      setDismissedSuggestionsFor(latestSuggestionSource.id);
    }
    sendText(String(value || "").trim());
  };

  const canSend = text.trim().length > 0;

  return (
    <div className="widget-host">
      <button
        className={`launcher ${open ? "launcher-open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-label="Toggle chat"
      >
        {icon}
      </button>

      <section className={`panel ${open ? "panel-open" : "panel-closed"}`}>
        <header className="panel-header">
          <div className="left-actions">
            <button
              type="button"
              className="header-btn icon-settings"
              aria-label="Settings"
              title="Settings"
            >
              ⋮
            </button>
            {/* <button type="button" className="header-btn icon-brand" aria-label="Brand">
              a
            </button> */}
          </div>
          <div className="right-actions">
            <button
              type="button"
              className="header-btn"
              onClick={() => setOpen(false)}
              aria-label="Minimize"
            >
              −
            </button>
            <button
              type="button"
              className="header-btn"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </header>

        <main className="panel-body" ref={listRef} onScroll={onBodyScroll}>
          <div className="messages-stack">
            {ready && (
              <p className="today today-open-animate">
                Today
              </p>
            )}
            {messages.map((m, index) => {
              const next = messages[index + 1];
              const isAgent = m.sender === "agent";
              const showAgentIcon = isAgent && (!next || next.sender !== "agent");
              return (
              <div
                key={m.id}
                className={`row row-${m.sender} row-open-animate`}
              >
                {m.sender === "system" ? (
                  <div className="system-pill">{String(m.text ?? "")}</div>
                ) : (
                  <>
                    {isAgent &&
                      (showAgentIcon ? (
                        <span className="mini-icon">a</span>
                      ) : (
                        <span className="mini-icon-spacer" aria-hidden="true" />
                      ))}
                    <div className={`bubble bubble-${m.sender}`}>
                      <div className="md-content">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {String(m.text ?? "")}
                        </ReactMarkdown>
                      </div>
                    </div>
                  </>
                )}
              </div>
              );
            })}
            {agentTyping && (
              <div
                className="row row-agent row-typing row-open-animate"
              >
                <span className="mini-icon">a</span>
                <div
                  className="bubble bubble-agent typing-bubble"
                  aria-label="Agent is typing"
                >
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                </div>
              </div>
            )}
            {latestSuggestionSource &&
              latestSuggestionSource.id !== dismissedSuggestionsFor && (
                <div className="row row-suggestions row-open-animate">
                  <div className="suggestion-row">
                    {latestSuggestionSource.suggestions.slice(0, 4).map((item, idx) => (
                      <button
                        key={`${latestSuggestionSource.id}-s-${idx}`}
                        type="button"
                        className="suggestion-chip"
                        onClick={() => sendSuggestion(item)}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
              )}
          </div>
        </main>

        <form className="composer" onSubmit={send}>
          <input
            value={text}
            onChange={(e) => {
              const next = e.target.value;
              setText(next);
              sendVisitorTyping(next);
              if (visitorTypingIdleTimerRef.current) {
                clearTimeout(visitorTypingIdleTimerRef.current);
              }
              visitorTypingIdleTimerRef.current = setTimeout(() => {
                sendVisitorTyping(next, false);
              }, 1200);
            }}
            onBlur={() => sendVisitorTyping("", false)}
            placeholder="Message..."
            aria-label="Message input"
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={!canSend}
            className={canSend ? "send-active" : ""}
          >
            ↑
          </button>
        </form>

        <footer className="privacy">Privacy</footer>
      </section>
    </div>
  );
}
