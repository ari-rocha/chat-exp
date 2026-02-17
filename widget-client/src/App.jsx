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
  const [carouselSelections, setCarouselSelections] = useState({});
  const [selectSelections, setSelectSelections] = useState({});
  const [formInputs, setFormInputs] = useState({});
  const [quickInputs, setQuickInputs] = useState({});

  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const visitorTypingIdleTimerRef = useRef(null);
  const tempIdRef = useRef(0);
  const listRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const openRef = useRef(open);

  const sendWsEvent = (event, data) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ event, data }));
  };

  useEffect(() => {
    openRef.current = open;
  }, [open]);

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
        if (openRef.current) {
          sendWsEvent("widget:opened", { sessionId });
        }
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

        if (envelope?.event === "session:switched") {
          const nextSessionId = envelope?.data?.sessionId;
          if (!nextSessionId || nextSessionId === sessionId) return;
          setSessionId(nextSessionId);
          localStorage.setItem("chat_session_id", nextSessionId);
          setMessages([]);
          setReady(false);
          setAgentTyping(false);
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
    if (!open || !sessionId) return;
    sendWsEvent("widget:opened", { sessionId });
  }, [open, sessionId]);

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
    if (chatClosed) return;
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
        const nextSessionId = data?.sessionId;
        if (nextSessionId && nextSessionId !== sessionId) {
          setSessionId(nextSessionId);
          localStorage.setItem("chat_session_id", nextSessionId);
          setMessages([]);
          setReady(false);
          setAgentTyping(false);
        }
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

  const selectKey = (messageId, itemIndex) => `${messageId}:${itemIndex}`;
  const formKey = (messageId) => `form:${messageId}`;

  const canSend = text.trim().length > 0;
  const chatClosed = useMemo(() => {
    if (!Array.isArray(messages) || messages.length === 0) return false;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message?.sender !== "system") continue;
      const text = String(message?.text || "").toLowerCase();
      if (text.includes("reopened")) return false;
      if (text.includes("you have ended the chat")) return true;
      if (text.includes("conversation closed")) return true;
    }
    return false;
  }, [messages]);

  const startNewChat = async () => {
    const res = await fetch(`${API_URL}/api/session`, { method: "POST" });
    const data = await res.json();
    if (!data?.sessionId) return;
    setSessionId(data.sessionId);
    localStorage.setItem("chat_session_id", data.sessionId);
    setMessages([]);
    setReady(false);
    setText("");
    setAgentTyping(false);
    setDismissedSuggestionsFor("");
  };

  const endCurrentChat = async () => {
    if (!sessionId) return;
    await fetch(`${API_URL}/api/session/${sessionId}/close`, { method: "POST" });
  };

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
              className="end-chat-btn"
              onClick={() => endCurrentChat().catch((error) => console.error("failed to end chat", error))}
              disabled={!sessionId || chatClosed}
            >
              End Chat
            </button>
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
                    <div className="message-stack">
                      <div className={`bubble bubble-${m.sender}`}>
                        <div className="md-content">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {String(m.text ?? "")}
                          </ReactMarkdown>
                        </div>
                      </div>
                    {m.sender === "agent" && m.widget?.type === "buttons" && Array.isArray(m.widget?.buttons) && (
                        <div className="message-widget buttons-widget">
                          {m.widget.buttons.slice(0, 6).map((button, idx) => (
                            <button
                              key={`${m.id}-btn-${idx}`}
                              type="button"
                              className="suggestion-chip"
                              onClick={() => sendSuggestion(button?.value || button?.label || "")}
                            >
                              {button?.label || "Option"}
                            </button>
                          ))}
                        </div>
                    )}
                    {m.sender === "agent" && m.widget?.type === "link_preview" && (
                      <a
                        className="message-widget link-preview-card"
                        href={m.widget?.url || "#"}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {m.widget?.image ? (
                          <img
                            src={m.widget.image}
                            alt={m.widget?.title || "Link preview"}
                            loading="lazy"
                          />
                        ) : null}
                        <div className="link-preview-body">
                          <p className="link-preview-site">{m.widget?.siteName || "Link"}</p>
                          <h4>{m.widget?.title || m.widget?.url || "Open link"}</h4>
                          {m.widget?.description ? <p>{m.widget.description}</p> : null}
                          <span className="link-preview-url">{m.widget?.url || ""}</span>
                        </div>
                      </a>
                    )}
                    {m.sender === "agent" && m.widget?.type === "select" && Array.isArray(m.widget?.options) && (
                      <div className="message-widget inline-form-widget">
                        <select
                          className="carousel-select"
                          value={selectSelections[m.id] || ""}
                          onChange={(e) =>
                            setSelectSelections((prev) => ({ ...prev, [m.id]: e.target.value }))
                          }
                        >
                          <option value="">{m.widget?.placeholder || "Select one"}</option>
                          {m.widget.options.map((opt, optIdx) => {
                            const label = typeof opt === "string" ? opt : opt?.label || opt?.value || "Option";
                            const value = typeof opt === "string" ? opt : opt?.value || label;
                            return (
                              <option key={`${m.id}-select-${optIdx}`} value={value}>
                                {label}
                              </option>
                            );
                          })}
                        </select>
                        <button
                          type="button"
                          className="inline-submit"
                          disabled={!selectSelections[m.id]}
                          onClick={() => {
                            const value = selectSelections[m.id];
                            if (!value) return;
                            sendSuggestion(value);
                            setSelectSelections((prev) => ({ ...prev, [m.id]: "" }));
                          }}
                        >
                          {m.widget?.buttonLabel || "Send"}
                        </button>
                      </div>
                    )}
                    {m.sender === "agent" && m.widget?.type === "input_form" && Array.isArray(m.widget?.fields) && (
                      <div className="message-widget inline-form-widget">
                        {m.widget.fields.map((field, fIdx) => (
                          <input
                            key={`${m.id}-field-${fIdx}`}
                            className="inline-input"
                            type={field?.type || "text"}
                            placeholder={field?.placeholder || field?.label || field?.name || "Field"}
                            value={formInputs[formKey(m.id)]?.[field?.name || `f${fIdx}`] || ""}
                            onChange={(e) =>
                              setFormInputs((prev) => ({
                                ...prev,
                                [formKey(m.id)]: {
                                  ...(prev[formKey(m.id)] || {}),
                                  [field?.name || `f${fIdx}`]: e.target.value
                                }
                              }))
                            }
                          />
                        ))}
                        <button
                          type="button"
                          className="inline-submit"
                          onClick={() => {
                            const values = formInputs[formKey(m.id)] || {};
                            const missing = m.widget.fields.some((field, fIdx) => {
                              if (field?.required === false) return false;
                              const key = field?.name || `f${fIdx}`;
                              return !String(values[key] || "").trim();
                            });
                            if (missing) return;
                            const payload = m.widget.fields
                              .map((field, fIdx) => {
                                const key = field?.name || `f${fIdx}`;
                                const label = field?.label || key;
                                return `${label}: ${values[key] || ""}`;
                              })
                              .join(", ");
                            sendSuggestion(payload);
                            setFormInputs((prev) => ({ ...prev, [formKey(m.id)]: {} }));
                          }}
                        >
                          {m.widget?.submitLabel || "Submit"}
                        </button>
                      </div>
                    )}
                    {m.sender === "agent" && m.widget?.type === "quick_input" && (
                      <div className="message-widget crisp-input-widget">
                        <input
                          className="crisp-input"
                          type={m.widget?.inputType || "text"}
                          placeholder={m.widget?.placeholder || "Type here..."}
                          value={quickInputs[m.id] || ""}
                          onChange={(e) =>
                            setQuickInputs((prev) => ({ ...prev, [m.id]: e.target.value }))
                          }
                        />
                        <button
                          type="button"
                          className="crisp-send"
                          disabled={!String(quickInputs[m.id] || "").trim()}
                          onClick={() => {
                            const value = String(quickInputs[m.id] || "").trim();
                            if (!value) return;
                            sendSuggestion(value);
                            setQuickInputs((prev) => ({ ...prev, [m.id]: "" }));
                          }}
                        >
                          {m.widget?.buttonLabel || "Send"}
                        </button>
                      </div>
                    )}
                    {m.sender === "agent" && m.widget?.type === "carousel" && Array.isArray(m.widget?.items) && (
                        <div className="message-widget carousel-widget">
                          {m.widget.items.slice(0, 8).map((item, idx) => (
                            <article key={`${m.id}-item-${idx}`} className="carousel-card">
                              {item?.imageUrl ? (
                                <img src={item.imageUrl} alt={item?.title || "Item"} loading="lazy" />
                              ) : null}
                              <h4>{item?.title || "Item"}</h4>
                              {item?.description ? <p>{item.description}</p> : null}
                              {item?.price ? <strong>{item.price}</strong> : null}
                              {(Array.isArray(item?.selectOptions) || Array.isArray(item?.options)) && (
                                <select
                                  className="carousel-select"
                                  value={carouselSelections[selectKey(m.id, idx)] || ""}
                                  onChange={(e) =>
                                    setCarouselSelections((prev) => ({
                                      ...prev,
                                      [selectKey(m.id, idx)]: e.target.value
                                    }))
                                  }
                                >
                                  <option value="">Select an option</option>
                                  {(item.selectOptions || item.options).map((opt, optIdx) => {
                                    if (typeof opt === "string") {
                                      return (
                                        <option key={`${m.id}-item-${idx}-o-${optIdx}`} value={opt}>
                                          {opt}
                                        </option>
                                      );
                                    }
                                    const label = opt?.label || opt?.value || `Option ${optIdx + 1}`;
                                    const value = opt?.value || label;
                                    return (
                                      <option key={`${m.id}-item-${idx}-o-${optIdx}`} value={value}>
                                        {label}
                                      </option>
                                    );
                                  })}
                                </select>
                              )}
                              <div className="carousel-actions">
                                {Array.isArray(item?.buttons) && item.buttons.length > 0 ? (
                                  item.buttons.slice(0, 2).map((button, bIdx) => (
                                    <button
                                      key={`${m.id}-item-${idx}-b-${bIdx}`}
                                      type="button"
                                      className="carousel-action"
                                      onClick={() => {
                                        const picked = carouselSelections[selectKey(m.id, idx)];
                                        sendSuggestion(
                                          picked || button?.value || button?.label || item?.title || ""
                                        );
                                      }}
                                    >
                                      {button?.label || "View"}
                                    </button>
                                  ))
                                ) : (
                                  <button
                                    type="button"
                                    className="carousel-action"
                                    onClick={() => {
                                      const picked = carouselSelections[selectKey(m.id, idx)];
                                      sendSuggestion(picked || item?.title || "");
                                    }}
                                  >
                                    View
                                  </button>
                                )}
                              </div>
                            </article>
                          ))}
                        </div>
                      )}
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

        {chatClosed ? (
          <div className="composer composer-closed">
            <button
              type="button"
              className="new-chat-btn"
              onClick={() => startNewChat().catch((error) => console.error("failed to start chat", error))}
            >
              Start new chat
            </button>
          </div>
        ) : (
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
        )}

        <footer className="privacy">Privacy</footer>
      </section>
    </div>
  );
}
