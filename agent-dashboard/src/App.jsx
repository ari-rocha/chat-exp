import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:4000/ws";
const TOKEN_KEY = "agent_auth_token";

const formatTime = (iso) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

async function apiFetch(path, token, options = {}) {
  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || `request failed: ${response.status}`);
  }
  return payload;
}

export default function App() {
  const [token, setToken] = useState(localStorage.getItem(TOKEN_KEY) || "");
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "" });
  const [authError, setAuthError] = useState("");

  const [agent, setAgent] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [messages, setMessages] = useState([]);
  const [activeId, setActiveId] = useState("");
  const [text, setText] = useState("");
  const [visitorDraftBySession, setVisitorDraftBySession] = useState({});

  const [agents, setAgents] = useState([]);
  const [teams, setTeams] = useState([]);
  const [inboxes, setInboxes] = useState([]);
  const [channels, setChannels] = useState([]);
  const [notes, setNotes] = useState([]);
  const [noteText, setNoteText] = useState("");

  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const typingIdleTimerRef = useRef(null);
  const typingActiveRef = useRef(false);
  const activeIdRef = useRef("");
  const bottomRef = useRef(null);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeId) ?? null,
    [sessions, activeId]
  );

  const sessionPreview = (session) => {
    const draft = visitorDraftBySession[session.id];
    if (draft) return `Typing: ${draft}`;
    return session.lastMessage?.text ?? "No messages yet";
  };

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

  const patchActiveSession = async (route, body) => {
    if (!token || !activeId) return;
    const payload = await apiFetch(`/api/session/${activeId}/${route}`, token, {
      method: "PATCH",
      body: JSON.stringify(body)
    });

    if (!payload?.session) return;

    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== payload.session.id);
      return [payload.session, ...next];
    });
  };

  const loadBootstrap = async (authToken) => {
    const [meRes, sessionsRes, teamsRes, inboxesRes, channelsRes, agentsRes] = await Promise.all([
      apiFetch("/api/auth/me", authToken),
      apiFetch("/api/sessions", authToken),
      apiFetch("/api/teams", authToken),
      apiFetch("/api/inboxes", authToken),
      apiFetch("/api/channels", authToken),
      apiFetch("/api/agents", authToken)
    ]);

    setAgent(meRes.agent ?? null);
    setSessions(sessionsRes.sessions ?? []);
    setTeams(teamsRes.teams ?? []);
    setInboxes(inboxesRes.inboxes ?? []);
    setChannels(channelsRes.channels ?? []);
    setAgents(agentsRes.agents ?? []);
  };

  const connectSocket = (authToken) => {
    let closedByCleanup = false;

    const connect = () => {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        sendWsEvent("agent:join", { token: authToken });
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

        if (envelope?.event === "auth:error") {
          localStorage.removeItem(TOKEN_KEY);
          setToken("");
          setAgent(null);
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
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) wsRef.current.close();
      wsRef.current = null;
    };
  };

  useEffect(() => {
    if (!token) return;

    let cleanupSocket = () => {};

    loadBootstrap(token)
      .then(() => {
        cleanupSocket = connectSocket(token);
      })
      .catch((error) => {
        console.error(error);
        localStorage.removeItem(TOKEN_KEY);
        setToken("");
        setAgent(null);
      });

    return () => cleanupSocket();
  }, [token]);

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
      setNotes([]);
      return;
    }

    sendWsEvent("agent:watch-session", { sessionId: activeId });
    sendWsEvent("agent:request-history", { sessionId: activeId });

    if (token) {
      apiFetch(`/api/session/${activeId}/notes`, token)
        .then((payload) => setNotes(payload.notes ?? []))
        .catch((error) => console.error("failed to load notes", error));
    }
  }, [activeId, token]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, activeId, visitorDraftBySession]);

  const submitAuth = async (e) => {
    e.preventDefault();
    setAuthError("");
    try {
      const path = authMode === "register" ? "/api/auth/register" : "/api/auth/login";
      const payload = await apiFetch(path, "", {
        method: "POST",
        body: JSON.stringify(authForm)
      });
      localStorage.setItem(TOKEN_KEY, payload.token);
      setToken(payload.token);
      setAuthForm({ name: "", email: "", password: "" });
    } catch (error) {
      setAuthError(error.message);
    }
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setAgent(null);
    setSessions([]);
    setMessages([]);
    setActiveId("");
    setNotes([]);
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (!activeId || !text.trim()) return;
    sendTypingState(false);
    sendWsEvent("agent:message", { sessionId: activeId, text: text.trim() });
    setText("");
  };

  const saveNote = async () => {
    if (!token || !activeId || !noteText.trim()) return;
    const payload = await apiFetch(`/api/session/${activeId}/notes`, token, {
      method: "POST",
      body: JSON.stringify({ text: noteText.trim() })
    });
    setNotes((prev) => [...prev, payload.note]);
    setNoteText("");
  };

  const updateAgentStatus = async (status) => {
    if (!token) return;
    const payload = await apiFetch("/api/agent/status", token, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
    setAgent(payload.agent);
  };

  if (!token) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-100 p-6">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">
            {authMode === "register" ? "Create Agent Account" : "Agent Sign In"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">Access your inboxes, teams and omnichannel sessions.</p>

          <form className="mt-4 space-y-3" onSubmit={submitAuth}>
            {authMode === "register" && (
              <Input
                placeholder="Full name"
                value={authForm.name}
                onChange={(e) => setAuthForm((p) => ({ ...p, name: e.target.value }))}
                required
              />
            )}
            <Input
              type="email"
              placeholder="Email"
              value={authForm.email}
              onChange={(e) => setAuthForm((p) => ({ ...p, email: e.target.value }))}
              required
            />
            <Input
              type="password"
              placeholder="Password"
              value={authForm.password}
              onChange={(e) => setAuthForm((p) => ({ ...p, password: e.target.value }))}
              required
            />
            {authError && <p className="text-sm text-red-600">{authError}</p>}
            <Button className="w-full bg-blue-600 text-white hover:bg-blue-700" type="submit">
              {authMode === "register" ? "Register" : "Login"}
            </Button>
          </form>

          <button
            className="mt-4 text-sm text-blue-700"
            onClick={() => setAuthMode((m) => (m === "register" ? "login" : "register"))}
          >
            {authMode === "register" ? "Already have an account? Login" : "Need an account? Register"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-slate-100 text-slate-900">
      <div className="grid h-full w-full grid-cols-[320px_1fr_320px] bg-slate-50 max-[1080px]:grid-cols-[1fr]">
        <aside className="border-r border-slate-200 bg-white max-[1080px]:hidden">
          <div className="flex items-center justify-between border-b border-slate-200 p-4">
            <div>
              <h2 className="text-sm font-semibold">Conversations</h2>
              <p className="text-xs text-slate-500">{sessions.length} total</p>
            </div>
            <Badge variant="secondary">{agent?.status || "offline"}</Badge>
          </div>

          <div className="p-3">
            <label className="mb-1 block text-xs text-slate-500">Status</label>
            <select
              className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
              value={agent?.status || "online"}
              onChange={(e) => updateAgentStatus(e.target.value)}
            >
              <option value="online">online</option>
              <option value="away">away</option>
              <option value="paused">paused</option>
            </select>
          </div>

          <ScrollArea className="h-[calc(100vh-126px)] p-2">
            <div className="space-y-2">
              {sessions.map((session) => {
                const isActive = session.id === activeId;
                return (
                  <button
                    key={session.id}
                    onClick={() => setActiveId(session.id)}
                    className={`w-full rounded-lg border px-3 py-2 text-left ${
                      isActive ? "border-blue-200 bg-blue-50" : "border-transparent hover:border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <strong>{session.id.slice(0, 8)}</strong>
                      <span className="text-slate-400">{formatTime(session.updatedAt)}</span>
                    </div>
                    <p className="truncate text-xs text-slate-500">{sessionPreview(session)}</p>
                    <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">
                      {session.channel} {session.assigneeAgentId ? "• assigned" : "• unassigned"}
                    </p>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </aside>

        <section className="grid min-h-0 grid-rows-[56px_1fr_90px] bg-slate-100">
          <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4">
            <div>
              <p className="text-sm font-semibold">{activeId || "No active conversation"}</p>
              <p className="text-xs text-slate-500">Omni-channel workspace</p>
            </div>
            <Button size="sm" variant="outline" onClick={logout}>Logout</Button>
          </div>

          <ScrollArea className="h-full p-4">
            <div className="space-y-3">
              {messages.map((message) => (
                <article
                  key={message.id}
                  className={`max-w-[72%] rounded-xl border px-3 py-2 text-sm ${
                    message.sender === "agent"
                      ? "ml-auto border-blue-200 bg-blue-600 text-white"
                      : "border-slate-200 bg-white text-slate-900"
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{message.text}</p>
                  <time className={`mt-1 block text-right text-[11px] ${message.sender === "agent" ? "text-blue-100" : "text-slate-400"}`}>
                    {formatTime(message.createdAt)}
                  </time>
                </article>
              ))}

              {activeId && visitorDraftBySession[activeId] && (
                <article className="max-w-[72%] rounded-xl border border-dashed border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
                  <p className="whitespace-pre-wrap break-words">{visitorDraftBySession[activeId]}</p>
                  <time className="mt-1 block text-right text-[11px] text-slate-400">typing...</time>
                </article>
              )}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          <form onSubmit={sendMessage} className="grid grid-cols-[1fr_auto] gap-2 border-t border-slate-200 bg-white p-3">
            <Textarea
              placeholder={activeId ? "Type your reply..." : "Select a conversation to reply"}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                bumpTyping();
              }}
              onBlur={() => sendTypingState(false)}
              disabled={!activeId}
              rows={2}
              className="min-h-10 resize-none"
            />
            <Button type="submit" disabled={!activeId || !text.trim()} className="h-10 self-end bg-blue-600 text-white hover:bg-blue-700">
              Send
            </Button>
          </form>
        </section>

        <aside className="border-l border-slate-200 bg-white p-4 max-[1080px]:hidden">
          <h3 className="text-sm font-semibold">Routing & Notes</h3>
          <p className="mb-4 text-xs text-slate-500">Inboxes, teams, assignees, channels and notes.</p>

          <div className="space-y-3 text-sm">
            <div>
              <label className="mb-1 block text-xs text-slate-500">Assignee</label>
              <select
                className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
                value={activeSession?.assigneeAgentId || ""}
                onChange={(e) => patchActiveSession("assignee", { agentId: e.target.value || null })}
                disabled={!activeId}
              >
                <option value="">Unassigned</option>
                {agents.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-500">Channel</label>
              <select
                className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
                value={activeSession?.channel || "web"}
                onChange={(e) => patchActiveSession("channel", { channel: e.target.value })}
                disabled={!activeId}
              >
                {channels.map((channel) => (
                  <option key={channel} value={channel}>{channel}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-500">Inbox</label>
              <select
                className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
                value={activeSession?.inboxId || ""}
                onChange={(e) => patchActiveSession("inbox", { inboxId: e.target.value || null })}
                disabled={!activeId}
              >
                <option value="">None</option>
                {inboxes.map((inbox) => (
                  <option key={inbox.id} value={inbox.id}>{inbox.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-500">Team</label>
              <select
                className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
                value={activeSession?.teamId || ""}
                onChange={(e) => patchActiveSession("team", { teamId: e.target.value || null })}
                disabled={!activeId}
              >
                <option value="">None</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </div>
          </div>

          <Separator className="my-4" />

          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</p>
          <Textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Add a note for this conversation"
            rows={3}
            disabled={!activeId}
          />
          <Button className="mt-2 w-full" variant="secondary" onClick={saveNote} disabled={!activeId || !noteText.trim()}>
            Save Note
          </Button>

          <ScrollArea className="mt-3 h-[300px] rounded-md border border-slate-200 p-2">
            <div className="space-y-2">
              {notes.map((note) => (
                <div key={note.id} className="rounded-md border border-slate-200 bg-slate-50 p-2 text-sm text-slate-700">
                  <p>{note.text}</p>
                  <p className="mt-1 text-[11px] text-slate-400">{formatTime(note.createdAt)}</p>
                </div>
              ))}
              {notes.length === 0 && <p className="text-xs text-slate-400">No notes yet.</p>}
            </div>
          </ScrollArea>
        </aside>
      </div>
    </div>
  );
}
