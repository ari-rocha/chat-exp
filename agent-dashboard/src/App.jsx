import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addEdge,
  Background,
  ConnectionLineType,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:4000/ws";
const TOKEN_KEY = "agent_auth_token";

const FLOW_NODE_PRESETS = {
  trigger: { label: "Trigger", keywords: [] },
  message: { label: "Message", text: "Thanks for contacting us.", delayMs: 420 },
  ai: { label: "AI Reply", prompt: "Help the visitor solve their issue clearly.", delayMs: 700 },
  condition: { label: "Condition", contains: "refund" },
  end: { label: "End" }
};

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

function createNode(type, x = 120, y = 120) {
  const nodeId = `${type}-${crypto.randomUUID().slice(0, 8)}`;
  return {
    id: nodeId,
    type,
    position: { x, y },
    data: { ...FLOW_NODE_PRESETS[type], label: FLOW_NODE_PRESETS[type]?.label ?? type }
  };
}

function defaultFlowGraph() {
  const trigger = createNode("trigger", 120, 180);
  const ai = createNode("ai", 430, 180);
  const end = createNode("end", 740, 180);
  return {
    nodes: [trigger, ai, end],
    edges: [
      { id: `e-${trigger.id}-${ai.id}`, source: trigger.id, target: ai.id },
      { id: `e-${ai.id}-${end.id}`, source: ai.id, target: end.id }
    ]
  };
}

function normalizeNode(node, index = 0) {
  const x = Number(node?.position?.x);
  const y = Number(node?.position?.y);
  return {
    id: String(node?.id ?? `node-${crypto.randomUUID().slice(0, 8)}`),
    type: node?.type || "message",
    position: {
      x: Number.isFinite(x) ? x : 120 + index * 40,
      y: Number.isFinite(y) ? y : 140 + index * 30
    },
    data: typeof node?.data === "object" && node?.data !== null ? node.data : {}
  };
}

function normalizeEdge(edge, index = 0) {
  return {
    id: String(edge?.id ?? `e-${crypto.randomUUID().slice(0, 8)}-${index}`),
    source: String(edge?.source ?? ""),
    target: String(edge?.target ?? ""),
    sourceHandle: edge?.sourceHandle ?? null,
    targetHandle: edge?.targetHandle ?? null,
    data: typeof edge?.data === "object" && edge?.data !== null ? edge.data : {}
  };
}

export default function App() {
  const [view, setView] = useState("conversations");

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

  const [flows, setFlows] = useState([]);
  const [activeFlowId, setActiveFlowId] = useState("");
  const [flowName, setFlowName] = useState("Untitled flow");
  const [flowDescription, setFlowDescription] = useState("");
  const [flowEnabled, setFlowEnabled] = useState(true);
  const [flowSaveStatus, setFlowSaveStatus] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState("");

  const [flowNodes, setFlowNodes, onFlowNodesChange] = useNodesState([]);
  const [flowEdges, setFlowEdges, onFlowEdgesChange] = useEdgesState([]);

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

  const activeFlow = useMemo(() => flows.find((flow) => flow.id === activeFlowId) ?? null, [flows, activeFlowId]);

  const selectedNode = useMemo(
    () => flowNodes.find((node) => node.id === selectedNodeId) ?? null,
    [flowNodes, selectedNodeId]
  );

  const sessionPreview = (session) => {
    const draft = visitorDraftBySession[session.id];
    if (draft) return `Typing: ${draft}`;
    return session.lastMessage?.text ?? "No messages yet";
  };

  const loadFlowIntoEditor = useCallback((flow) => {
    if (!flow) return;
    setFlowName(flow.name ?? "Untitled flow");
    setFlowDescription(flow.description ?? "");
    setFlowEnabled(Boolean(flow.enabled));
    const safeNodes = (Array.isArray(flow.nodes) ? flow.nodes : []).map((node, index) => normalizeNode(node, index));
    const safeEdges = (Array.isArray(flow.edges) ? flow.edges : [])
      .map((edge, index) => normalizeEdge(edge, index))
      .filter((edge) => edge.source && edge.target);
    setFlowNodes(safeNodes);
    setFlowEdges(safeEdges);
    setSelectedNodeId("");
  }, [setFlowEdges, setFlowNodes]);

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
    }, 900);
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

  const setHandover = async (active) => {
    await patchActiveSession("handover", { active });
  };

  const loadBootstrap = async (authToken) => {
    const [meRes, sessionsRes, teamsRes, inboxesRes, channelsRes, agentsRes, flowsRes] = await Promise.all([
      apiFetch("/api/auth/me", authToken),
      apiFetch("/api/sessions", authToken),
      apiFetch("/api/teams", authToken),
      apiFetch("/api/inboxes", authToken),
      apiFetch("/api/channels", authToken),
      apiFetch("/api/agents", authToken),
      apiFetch("/api/flows", authToken)
    ]);

    setAgent(meRes.agent ?? null);
    setSessions(sessionsRes.sessions ?? []);
    setTeams(teamsRes.teams ?? []);
    setInboxes(inboxesRes.inboxes ?? []);
    setChannels(channelsRes.channels ?? []);
    setAgents(agentsRes.agents ?? []);

    const nextFlows = flowsRes.flows ?? [];
    setFlows(nextFlows);
    if (nextFlows[0]) {
      setActiveFlowId(nextFlows[0].id);
      loadFlowIntoEditor(nextFlows[0]);
    } else {
      const defaultGraph = defaultFlowGraph();
      setFlowNodes(defaultGraph.nodes);
      setFlowEdges(defaultGraph.edges);
      setFlowName("Untitled flow");
      setFlowDescription("");
      setFlowEnabled(true);
    }
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
    setFlows([]);
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

  const createFlow = async () => {
    const graph = defaultFlowGraph();
    const payload = await apiFetch("/api/flows", token, {
      method: "POST",
      body: JSON.stringify({
        name: `Flow ${flows.length + 1}`,
        description: "",
        enabled: true,
        nodes: graph.nodes,
        edges: graph.edges
      })
    });

    const created = payload.flow;
    if (!created) return;
    setFlows((prev) => [...prev, created]);
    setActiveFlowId(created.id);
    loadFlowIntoEditor(created);
    setView("flows");
  };

  const saveFlow = async () => {
    if (!token || !activeFlowId) return;
    setFlowSaveStatus("Saving...");
    try {
      const nodesPayload = flowNodes.map((node, index) => normalizeNode(node, index));
      const edgesPayload = flowEdges
        .map((edge, index) => normalizeEdge(edge, index))
        .filter((edge) => edge.source && edge.target);
      const payload = await apiFetch(`/api/flows/${activeFlowId}`, token, {
        method: "PATCH",
        body: JSON.stringify({
          name: flowName,
          description: flowDescription,
          enabled: flowEnabled,
          nodes: nodesPayload,
          edges: edgesPayload
        })
      });

      const saved = payload.flow;
      if (!saved) {
        setFlowSaveStatus("Save failed");
        return;
      }

      setFlows((prev) => prev.map((flow) => (flow.id === saved.id ? saved : flow)));
      setFlowSaveStatus("Saved");
      setTimeout(() => setFlowSaveStatus(""), 1200);
    } catch (error) {
      setFlowSaveStatus(error.message);
    }
  };

  const deleteCurrentFlow = async () => {
    if (!token || !activeFlowId) return;
    await apiFetch(`/api/flows/${activeFlowId}`, token, { method: "DELETE" });

    setFlows((prev) => {
      const next = prev.filter((flow) => flow.id !== activeFlowId);
      const fallback = next[0];
      if (fallback) {
        setActiveFlowId(fallback.id);
        loadFlowIntoEditor(fallback);
      } else {
        setActiveFlowId("");
        setFlowNodes([]);
        setFlowEdges([]);
      }
      return next;
    });

    setSessions((prev) => prev.map((session) => (session.flowId === activeFlowId ? { ...session, flowId: null } : session)));
  };

  const onFlowConnect = useCallback(
    (connection) => {
      setFlowEdges((prev) => addEdge({ ...connection, id: `e-${crypto.randomUUID().slice(0, 8)}` }, prev));
    },
    [setFlowEdges]
  );

  const addFlowNode = (type) => {
    const x = 120 + Math.floor(Math.random() * 280);
    const y = 120 + Math.floor(Math.random() * 280);
    const node = createNode(type, x, y);
    setFlowNodes((prev) => [...prev, node]);
    setSelectedNodeId(node.id);
  };

  const updateSelectedNodeData = (patch) => {
    if (!selectedNodeId) return;
    setFlowNodes((prev) =>
      prev.map((node) =>
        node.id === selectedNodeId
          ? {
              ...node,
              data: {
                ...(node.data ?? {}),
                ...patch
              }
            }
          : node
      )
    );
  };

  const removeSelectedNode = () => {
    if (!selectedNodeId) return;
    setFlowNodes((prev) => prev.filter((node) => node.id !== selectedNodeId));
    setFlowEdges((prev) => prev.filter((edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId));
    setSelectedNodeId("");
  };

  if (!token) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-100 p-6">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">
            {authMode === "register" ? "Create Agent Account" : "Agent Sign In"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">Access your inboxes, teams and flow automations.</p>

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
      <div className="grid h-full w-full grid-rows-[56px_1fr]">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4">
          <div className="flex items-center gap-2">
            <Button
              variant={view === "conversations" ? "default" : "outline"}
              size="sm"
              onClick={() => setView("conversations")}
            >
              Conversations
            </Button>
            <Button variant={view === "flows" ? "default" : "outline"} size="sm" onClick={() => setView("flows")}>
              Flow Builder
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="secondary">{agent?.status || "offline"}</Badge>
            <Button size="sm" variant="outline" onClick={logout}>
              Logout
            </Button>
          </div>
        </header>

        {view === "conversations" ? (
          <div className="grid min-h-0 grid-cols-[320px_1fr_320px] bg-slate-50 max-[1080px]:grid-cols-[1fr]">
            <aside className="border-r border-slate-200 bg-white max-[1080px]:hidden">
              <div className="flex items-center justify-between border-b border-slate-200 p-4">
                <div>
                  <h2 className="text-sm font-semibold">Conversations</h2>
                  <p className="text-xs text-slate-500">{sessions.length} total</p>
                </div>
                <Button size="sm" variant="outline" onClick={createFlow}>
                  + Flow
                </Button>
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

              <ScrollArea className="h-[calc(100vh-182px)] p-2">
                <div className="space-y-2">
                  {sessions.map((session) => {
                    const isActive = session.id === activeId;
                    return (
                      <button
                        key={session.id}
                        onClick={() => setActiveId(session.id)}
                        className={`w-full rounded-lg border px-3 py-2 text-left ${
                          isActive
                            ? "border-blue-200 bg-blue-50"
                            : "border-transparent hover:border-slate-200 hover:bg-slate-50"
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

            <section className="grid min-h-0 grid-rows-[1fr_90px] bg-slate-100">
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
                      <div
                        className={`dashboard-md ${message.sender === "agent" ? "dashboard-md-agent" : ""}`}
                      >
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {String(message.text ?? "")}
                        </ReactMarkdown>
                      </div>
                      <time
                        className={`mt-1 block text-right text-[11px] ${
                          message.sender === "agent" ? "text-blue-100" : "text-slate-400"
                        }`}
                      >
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
                <Button
                  type="submit"
                  disabled={!activeId || !text.trim()}
                  className="h-10 self-end bg-blue-600 text-white hover:bg-blue-700"
                >
                  Send
                </Button>
              </form>
            </section>

            <aside className="border-l border-slate-200 bg-white p-4 max-[1080px]:hidden">
              <h3 className="text-sm font-semibold">Routing & Notes</h3>
              <p className="mb-4 text-xs text-slate-500">Inboxes, teams, assignees, channels, flow and notes.</p>

              <div className="space-y-3 text-sm">
                <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-600">Agent Handover</span>
                    <Badge variant={activeSession?.handoverActive ? "default" : "secondary"}>
                      {activeSession?.handoverActive ? "Human" : "Bot"}
                    </Badge>
                  </div>
                  <Button
                    size="sm"
                    className="w-full"
                    variant={activeSession?.handoverActive ? "outline" : "default"}
                    disabled={!activeId}
                    onClick={() => setHandover(!Boolean(activeSession?.handoverActive))}
                  >
                    {activeSession?.handoverActive ? "Return To Bot" : "Take Over As Agent"}
                  </Button>
                </div>

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
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
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
                      <option key={channel} value={channel}>
                        {channel}
                      </option>
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
                      <option key={inbox.id} value={inbox.id}>
                        {inbox.name}
                      </option>
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
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs text-slate-500">Flow</label>
                  <select
                    className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
                    value={activeSession?.flowId || ""}
                    onChange={(e) => patchActiveSession("flow", { flowId: e.target.value || null })}
                    disabled={!activeId}
                  >
                    <option value="">No flow</option>
                    {flows.map((flow) => (
                      <option key={flow.id} value={flow.id}>
                        {flow.name}
                      </option>
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
        ) : (
          <div className="grid min-h-0 grid-cols-[280px_1fr_320px] bg-slate-50 max-[1200px]:grid-cols-[1fr]">
            <aside className="border-r border-slate-200 bg-white p-3 max-[1200px]:hidden">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Flows</h3>
                <Button size="sm" onClick={createFlow}>
                  New
                </Button>
              </div>

              <ScrollArea className="h-[calc(100vh-120px)] pr-2">
                <div className="space-y-2">
                  {flows.map((flow) => (
                    <button
                      key={flow.id}
                      onClick={() => {
                        setActiveFlowId(flow.id);
                        loadFlowIntoEditor(flow);
                      }}
                      className={`w-full rounded-md border px-3 py-2 text-left ${
                        flow.id === activeFlowId ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white"
                      }`}
                    >
                      <p className="text-sm font-medium text-slate-900">{flow.name}</p>
                      <p className="text-xs text-slate-500">{flow.description || "No description"}</p>
                      <p className="mt-1 text-[11px] uppercase text-slate-400">{flow.enabled ? "enabled" : "disabled"}</p>
                    </button>
                  ))}
                  {flows.length === 0 && <p className="text-xs text-slate-400">No flows yet.</p>}
                </div>
              </ScrollArea>
            </aside>

            <section className="grid min-h-0 grid-rows-[56px_1fr]">
              <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3">
                <Input value={flowName} onChange={(e) => setFlowName(e.target.value)} placeholder="Flow name" className="max-w-sm" />
                <Badge variant={flowEnabled ? "default" : "secondary"}>{flowEnabled ? "enabled" : "disabled"}</Badge>
                <Button variant="outline" size="sm" onClick={() => setFlowEnabled((v) => !v)}>
                  Toggle
                </Button>
                <Button size="sm" onClick={saveFlow} disabled={!activeFlowId}>
                  Save Flow
                </Button>
                <Button size="sm" variant="destructive" onClick={deleteCurrentFlow} disabled={!activeFlowId}>
                  Delete
                </Button>
                {flowSaveStatus && <span className="text-xs text-slate-500">{flowSaveStatus}</span>}
              </div>

              <div className="relative min-h-0 bg-slate-100">
                <ReactFlow
                  nodes={flowNodes}
                  edges={flowEdges}
                  onNodesChange={onFlowNodesChange}
                  onEdgesChange={onFlowEdgesChange}
                  onConnect={onFlowConnect}
                  onSelectionChange={({ nodes }) => setSelectedNodeId(nodes?.[0]?.id || "")}
                  fitView
                  connectionLineType={ConnectionLineType.SmoothStep}
                >
                  <MiniMap pannable zoomable />
                  <Controls />
                  <Background gap={24} size={1.5} color="#d7dce5" />
                </ReactFlow>
              </div>
            </section>

            <aside className="border-l border-slate-200 bg-white p-3 max-[1200px]:hidden">
              <h3 className="text-sm font-semibold">Flow Inspector</h3>
              <p className="mb-3 text-xs text-slate-500">Add nodes, edit node data, and configure AI behavior.</p>

              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" onClick={() => addFlowNode("trigger")}>+ Trigger</Button>
                <Button size="sm" variant="outline" onClick={() => addFlowNode("condition")}>+ Condition</Button>
                <Button size="sm" variant="outline" onClick={() => addFlowNode("message")}>+ Message</Button>
                <Button size="sm" variant="outline" onClick={() => addFlowNode("ai")}>+ AI</Button>
                <Button size="sm" variant="outline" onClick={() => addFlowNode("end")}>+ End</Button>
              </div>

              <Separator className="my-4" />

              <label className="mb-1 block text-xs text-slate-500">Description</label>
              <Textarea
                rows={3}
                value={flowDescription}
                onChange={(e) => setFlowDescription(e.target.value)}
                placeholder="What this flow does"
              />

              <Separator className="my-4" />

              {selectedNode ? (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected Node</p>
                  <Input
                    value={selectedNode.data?.label || ""}
                    onChange={(e) => updateSelectedNodeData({ label: e.target.value })}
                    placeholder="Label"
                  />
                  <p className="text-[11px] text-slate-500">Type: {selectedNode.type}</p>

                  {(selectedNode.type === "message" || selectedNode.type === "condition") && (
                    <Input
                      value={selectedNode.data?.text || ""}
                      onChange={(e) => updateSelectedNodeData({ text: e.target.value })}
                      placeholder="Message text"
                    />
                  )}

                  {selectedNode.type === "trigger" && (
                    <Input
                      value={Array.isArray(selectedNode.data?.keywords) ? selectedNode.data.keywords.join(", ") : ""}
                      onChange={(e) =>
                        updateSelectedNodeData({
                          keywords: e.target.value
                            .split(",")
                            .map((item) => item.trim())
                            .filter(Boolean)
                        })
                      }
                      placeholder="keywords, comma separated"
                    />
                  )}

                  {selectedNode.type === "condition" && (
                    <Input
                      value={selectedNode.data?.contains || ""}
                      onChange={(e) => updateSelectedNodeData({ contains: e.target.value })}
                      placeholder="Contains text"
                    />
                  )}

                  {selectedNode.type === "ai" && (
                    <Textarea
                      rows={4}
                      value={selectedNode.data?.prompt || ""}
                      onChange={(e) => updateSelectedNodeData({ prompt: e.target.value })}
                      placeholder="AI instruction prompt"
                    />
                  )}

                  {(selectedNode.type === "message" || selectedNode.type === "ai") && (
                    <Input
                      type="number"
                      min={100}
                      max={6000}
                      value={selectedNode.data?.delayMs ?? 420}
                      onChange={(e) => updateSelectedNodeData({ delayMs: Number(e.target.value || 420) })}
                      placeholder="Delay ms"
                    />
                  )}

                  <Button size="sm" variant="destructive" onClick={removeSelectedNode}>
                    Remove Node
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-slate-400">Select a node to edit its fields.</p>
              )}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
