import WorkspaceLayout from "@/app/WorkspaceLayout";
import AuthView from "@/features/auth/AuthView";
import ContactsView from "@/features/contacts/ContactsView";
import ConversationsView from "@/features/conversations/ConversationsView";
import CsatView from "@/features/csat/CsatView";
import CustomizationView from "@/features/customization/CustomizationView";
import FlowsView from "@/features/flows/FlowsView";
import { addEdge, useEdgesState, useNodesState } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:4000/ws";
const TOKEN_KEY = "agent_auth_token";
const API_BASE = API_URL.replace(/\/+$/, "");

function resolveApiUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("data:") ||
    value.startsWith("blob:")
  ) {
    return value;
  }
  if (value.startsWith("/")) return `${API_BASE}${value}`;
  return `${API_BASE}/${value}`;
}

const FLOW_NODE_PRESETS = {
  trigger: { label: "Trigger", on: "widget_open", keywords: [] },
  message: {
    label: "Message",
    text: "Thanks for contacting us.",
    delayMs: 420,
  },
  buttons: {
    label: "Buttons",
    text: "Choose an option:",
    delayMs: 420,
    buttons: ["Bot's Technical Documentation", "Test"],
  },
  carousel: {
    label: "Carousel",
    text: "Here are some products you might like:",
    delayMs: 520,
    items: [
      {
        title: "Starter Plan",
        description: "Good for small teams getting started.",
        price: "$29/mo",
        imageUrl: "",
        buttons: [{ label: "View", value: "View Starter Plan" }],
      },
    ],
  },
  select: {
    label: "Select",
    text: "Please choose one option:",
    delayMs: 420,
    placeholder: "Select one",
    buttonLabel: "Send",
    options: ["Bot's Technical Documentation", "Pricing", "Talk to sales"],
  },
  input_form: {
    label: "Input Form",
    text: "Please fill your information:",
    delayMs: 420,
    submitLabel: "Submit",
    fields: [
      {
        name: "first_name",
        label: "First name",
        placeholder: "John",
        type: "text",
        required: true,
      },
      {
        name: "last_name",
        label: "Last name",
        placeholder: "Doe",
        type: "text",
        required: true,
      },
      {
        name: "email",
        label: "Email",
        placeholder: "john@company.com",
        type: "email",
        required: true,
      },
    ],
  },
  quick_input: {
    label: "Quick Input",
    text: "How should we get back to you?",
    delayMs: 420,
    placeholder: "martha.collins@gmail.com",
    buttonLabel: "Send",
    inputType: "email",
  },
  ai: {
    label: "Question Classifier",
    prompt:
      "Classify the user's question and route it to the most relevant branch.",
    classes: ["Sales questions", "Product support", "Other questions"],
    delayMs: 450,
  },
  condition: {
    label: "Condition",
    rules: [{ attribute: "message", operator: "contains", value: "" }],
    logicOperator: "and",
    outputs: [],
  },
  end: {
    label: "End",
    behavior: "close",
    closeMessage: "",
    handoverMessage: "",
  },
  wait: {
    label: "Wait",
    duration: 60,
    unit: "seconds",
  },
  assign: {
    label: "Assign",
    assignTo: "team",
    teamName: "",
    agentEmail: "",
    message: "",
  },
  close_conversation: {
    label: "Close Conversation",
    message: "",
    sendCsat: false,
  },
  csat: {
    label: "CSAT Rating",
    text: "How would you rate your experience?",
    ratingType: "emoji",
    delayMs: 420,
  },
  tag: {
    label: "Tag",
    action: "add",
    tags: [""],
  },
  set_attribute: {
    label: "Set Attribute",
    target: "contact",
    attributeName: "",
    attributeValue: "",
  },
  note: {
    label: "Note",
    text: "",
  },
  webhook: {
    label: "Webhook",
    url: "",
    method: "POST",
    headers: "{}",
    body: "{}",
  },
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
  const isFormData =
    typeof FormData !== "undefined" && options.body instanceof FormData;
  if (!headers.has("Content-Type") && options.body && !isFormData) {
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
    data: {
      ...FLOW_NODE_PRESETS[type],
      label: FLOW_NODE_PRESETS[type]?.label ?? type,
    },
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
      { id: `e-${ai.id}-${end.id}`, source: ai.id, target: end.id },
    ],
  };
}

function normalizeNode(node, index = 0) {
  const x = Number(node?.position?.x);
  const y = Number(node?.position?.y);
  const data =
    typeof node?.data === "object" && node?.data !== null
      ? { ...node.data }
      : {};
  const type = node?.type || "message";

  if (type === "ai") {
    if (!data.label || data.label === "AI Reply") {
      data.label = "Question Classifier";
    }
    if (!Array.isArray(data.classes) || data.classes.length === 0) {
      data.classes = ["Sales questions", "Product support", "Other questions"];
    }
    if (
      !data.prompt ||
      data.prompt === "Help the visitor solve their issue clearly."
    ) {
      data.prompt =
        "Classify the user's question and route it to the most relevant branch.";
    }
  }

  return {
    id: String(node?.id ?? `node-${crypto.randomUUID().slice(0, 8)}`),
    type,
    position: {
      x: Number.isFinite(x) ? x : 120 + index * 40,
      y: Number.isFinite(y) ? y : 140 + index * 30,
    },
    data,
  };
}

function normalizeEdge(edge, index = 0) {
  return {
    id: String(edge?.id ?? `e-${crypto.randomUUID().slice(0, 8)}-${index}`),
    source: String(edge?.source ?? ""),
    target: String(edge?.target ?? ""),
    sourceHandle: edge?.sourceHandle ?? null,
    targetHandle: edge?.targetHandle ?? null,
    data:
      typeof edge?.data === "object" && edge?.data !== null ? edge.data : {},
  };
}

export default function App() {
  const [view, setViewRaw] = useState("conversations");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState(
    localStorage.getItem("agent_dashboard_theme") || "light",
  );

  // Intercept "customization" view to open settings dialog instead
  const setView = (v) => {
    if (v === "customization") {
      setSettingsOpen(true);
      return;
    }
    setViewRaw(v);
  };

  const [token, setToken] = useState(localStorage.getItem(TOKEN_KEY) || "");
  const [authStage, setAuthStage] = useState("login");
  const [authForm, setAuthForm] = useState({
    fullName: "",
    email: "",
    password: "",
    workspaceName: "",
    workspaceUsername: "",
    invitationToken: "",
    loginTicket: "",
  });
  const [workspaceChoices, setWorkspaceChoices] = useState([]);
  const [authError, setAuthError] = useState("");

  const [agent, setAgent] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [messages, setMessages] = useState([]);
  const [activeId, setActiveId] = useState("");
  const [text, setText] = useState("");
  const [conversationSearch, setConversationSearch] = useState("");
  const [conversationFilter, setConversationFilter] = useState("active");
  const [visitorDraftBySession, setVisitorDraftBySession] = useState({});
  const [cannedReplies, setCannedReplies] = useState([]);
  const [cannedPanelOpen, setCannedPanelOpen] = useState(false);
  const [messageAudience, setMessageAudience] = useState("user");
  const [newCanned, setNewCanned] = useState({
    title: "",
    body: "",
    shortcut: "",
    category: "",
  });
  const [cannedSaving, setCannedSaving] = useState(false);

  const [agents, setAgents] = useState([]);
  const [teams, setTeams] = useState([]);
  const [channels, setChannels] = useState([]);
  const [channelRecords, setChannelRecords] = useState([]);
  const [notes, setNotes] = useState([]);
  const [noteText, setNoteText] = useState("");
  const [tenants, setTenants] = useState([]);
  const [tenantSettings, setTenantSettings] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [csatReport, setCsatReport] = useState({
    count: 0,
    average: 0,
    surveys: [],
  });
  const [newContact, setNewContact] = useState({
    displayName: "",
    email: "",
    phone: "",
  });

  const [tags, setTags] = useState([]);
  const [attributeDefs, setAttributeDefs] = useState([]);
  const [sessionTags, setSessionTags] = useState([]);
  const [sessionContact, setSessionContact] = useState(null);
  const [previousConversations, setPreviousConversations] = useState([]);
  const [conversationAttrs, setConversationAttrs] = useState([]);
  const [newConvAttrKey, setNewConvAttrKey] = useState("");
  const [newConvAttrValue, setNewConvAttrValue] = useState("");

  const [flows, setFlows] = useState([]);
  const [activeFlowId, setActiveFlowId] = useState("");
  const [flowName, setFlowName] = useState("Untitled flow");
  const [flowDescription, setFlowDescription] = useState("");
  const [flowEnabled, setFlowEnabled] = useState(true);
  const [flowSaveStatus, setFlowSaveStatus] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState("");

  const [flowNodes, setFlowNodes, onFlowNodesChange] = useNodesState([]);
  const [flowEdges, setFlowEdges, onFlowEdgesChange] = useEdgesState([]);
  const [flowInputVariables, setFlowInputVariables] = useState([]);
  const [flowAiTool, setFlowAiTool] = useState(false);
  const [flowAiToolDescription, setFlowAiToolDescription] = useState("");

  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const typingIdleTimerRef = useRef(null);
  const typingActiveRef = useRef(false);
  const activeIdRef = useRef("");
  const bottomRef = useRef(null);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeId) ?? null,
    [sessions, activeId],
  );
  const isActiveSessionClosed = (activeSession?.status || "open") === "closed";

  const activeFlow = useMemo(
    () => flows.find((flow) => flow.id === activeFlowId) ?? null,
    [flows, activeFlowId],
  );

  const selectedNode = useMemo(
    () => flowNodes.find((node) => node.id === selectedNodeId) ?? null,
    [flowNodes, selectedNodeId],
  );

  useEffect(() => {
    localStorage.setItem("agent_dashboard_theme", theme);
  }, [theme]);

  const sessionPreview = (session) => {
    const draft = visitorDraftBySession[session.id];
    if (draft) return `Typing: ${draft}`;
    return session.lastMessage?.text ?? "No messages yet";
  };

  const filteredSessions = useMemo(() => {
    const query = conversationSearch.trim().toLowerCase();
    const byStatus = sessions.filter((session) => {
      const status = session.status || "open";
      if (conversationFilter === "active") {
        return status !== "closed";
      }
      if (conversationFilter === "all") return true;
      return status === conversationFilter;
    });
    if (!query) return byStatus;
    return byStatus.filter((session) => {
      const draft = visitorDraftBySession[session.id];
      const preview = (
        draft
          ? `Typing: ${draft}`
          : (session.lastMessage?.text ?? "No messages yet")
      ).toLowerCase();
      const id = session.id.toLowerCase();
      return id.includes(query) || preview.includes(query);
    });
  }, [
    sessions,
    conversationSearch,
    conversationFilter,
    visitorDraftBySession,
  ]);

  const openCount = useMemo(
    () =>
      sessions.filter((session) => (session.status || "open") === "open")
        .length,
    [sessions],
  );
  const waitingCount = useMemo(
    () =>
      sessions.filter((session) => (session.status || "open") === "awaiting")
        .length,
    [sessions],
  );
  const closedCount = useMemo(
    () =>
      sessions.filter((session) => (session.status || "open") === "closed")
        .length,
    [sessions],
  );
  const channelCounts = useMemo(() => {
    const map = new Map();
    // Seed with all registered channel types so they always appear
    for (const rec of channelRecords) {
      const key = rec.channelType || rec.channel_type;
      if (key && !map.has(key)) map.set(key, 0);
    }
    for (const session of sessions) {
      if (session.channel) {
        map.set(session.channel, (map.get(session.channel) || 0) + 1);
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [sessions, channelRecords]);

  const slashQuery = useMemo(() => {
    const trimmed = text.trimStart();
    if (!trimmed.startsWith("/")) return "";
    return trimmed.slice(1).trim().toLowerCase();
  }, [text]);

  const filteredCannedReplies = useMemo(() => {
    const query = slashQuery;
    if (!query) return cannedReplies;
    return cannedReplies.filter((reply) => {
      const shortcut = (reply.shortcut || "").trim().toLowerCase();
      const normalizedShortcut = shortcut.startsWith("/")
        ? shortcut.slice(1)
        : shortcut;
      const haystack = [reply.title, reply.body, reply.category]
        .join(" ")
        .toLowerCase();
      return (
        normalizedShortcut.includes(query) ||
        shortcut.includes(`/${query}`) ||
        haystack.includes(query)
      );
    });
  }, [cannedReplies, slashQuery]);

  const loadFlowIntoEditor = useCallback(
    (flow) => {
      if (!flow) return;
      setFlowName(flow.name ?? "Untitled flow");
      setFlowDescription(flow.description ?? "");
      setFlowEnabled(Boolean(flow.enabled));
      const safeNodes = (Array.isArray(flow.nodes) ? flow.nodes : []).map(
        (node, index) => normalizeNode(node, index),
      );
      const safeEdges = (Array.isArray(flow.edges) ? flow.edges : [])
        .map((edge, index) => normalizeEdge(edge, index))
        .filter((edge) => edge.source && edge.target);
      setFlowNodes(safeNodes);
      setFlowEdges(safeEdges);
      setFlowInputVariables(
        Array.isArray(flow.inputVariables) ? flow.inputVariables : [],
      );
      setFlowAiTool(Boolean(flow.aiTool));
      setFlowAiToolDescription(flow.aiToolDescription ?? "");
      setSelectedNodeId("");
    },
    [setFlowEdges, setFlowNodes],
  );

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
      body: JSON.stringify(body),
    });

    if (!payload?.session) return;

    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== payload.session.id);
      return [payload.session, ...next];
    });
  };

  const loadBootstrap = async (authToken) => {
    const [
      meRes,
      sessionsRes,
      teamsRes,
      channelsRes,
      agentsRes,
      flowsRes,
      cannedRes,
      tenantsRes,
      settingsRes,
      contactsRes,
      csatRes,
      tagsRes,
      attrDefsRes,
    ] = await Promise.all([
      apiFetch("/api/auth/me", authToken),
      apiFetch("/api/sessions", authToken),
      apiFetch("/api/teams", authToken),
      apiFetch("/api/channels", authToken),
      apiFetch("/api/agents", authToken),
      apiFetch("/api/flows", authToken),
      apiFetch("/api/canned-replies", authToken),
      apiFetch("/api/tenants", authToken),
      apiFetch("/api/tenant/settings", authToken),
      apiFetch("/api/contacts", authToken),
      apiFetch("/api/reports/csat", authToken),
      apiFetch("/api/tags", authToken),
      apiFetch("/api/attribute-definitions", authToken),
    ]);

    setAgent(meRes.agent ?? null);
    setSessions(sessionsRes.sessions ?? []);
    setTeams(teamsRes.teams ?? []);
    setChannels(channelsRes.channels ?? []);
    setChannelRecords(channelsRes.channelRecords ?? []);
    setAgents(agentsRes.agents ?? []);
    setCannedReplies(cannedRes.cannedReplies ?? []);
    setTenants(tenantsRes.tenants ?? []);
    setTenantSettings(settingsRes.settings ?? null);
    setContacts(contactsRes.contacts ?? []);
    setCsatReport({
      count: csatRes.count ?? 0,
      average: csatRes.average ?? 0,
      surveys: csatRes.surveys ?? [],
    });
    setTags(tagsRes.tags ?? []);
    setAttributeDefs(attrDefsRes.attributeDefinitions ?? []);

    const nextFlows = flowsRes.flows ?? [];
    setFlows(nextFlows);
    if (nextFlows[0]) {
      setActiveFlowId(nextFlows[0].id);
      loadFlowIntoEditor(nextFlows[0]);
    } else {
      setFlowNodes([]);
      setFlowEdges([]);
      setFlowName("");
      setFlowDescription("");
      setFlowEnabled(true);
      setActiveFlowId("");
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
          sendWsEvent("agent:watch-session", {
            sessionId: activeIdRef.current,
          });
          sendWsEvent("agent:request-history", {
            sessionId: activeIdRef.current,
          });
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
      setSessionTags([]);
      setSessionContact(null);
      setPreviousConversations([]);
      setConversationAttrs([]);
      setNewConvAttrKey("");
      setNewConvAttrValue("");
      return;
    }

    sendWsEvent("agent:watch-session", { sessionId: activeId });
    sendWsEvent("agent:request-history", { sessionId: activeId });

    if (token) {
      apiFetch(`/api/session/${activeId}/notes`, token)
        .then((payload) => setNotes(payload.notes ?? []))
        .catch((error) => console.error("failed to load notes", error));
      apiFetch(`/api/session/${activeId}/tags`, token)
        .then((payload) => setSessionTags(payload.tags ?? []))
        .catch((error) => console.error("failed to load session tags", error));
      apiFetch(`/api/session/${activeId}/attributes`, token)
        .then((payload) => setConversationAttrs(payload.attributes ?? []))
        .catch((error) => console.error("failed to load conv attrs", error));
    }
  }, [activeId, token]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, activeId, visitorDraftBySession]);

  /* ── Load linked contact when activeSession changes ── */
  useEffect(() => {
    const cid = activeSession?.contactId;
    if (!cid || !token) {
      setSessionContact(null);
      setPreviousConversations([]);
      return;
    }
    apiFetch(`/api/contacts/${cid}`, token)
      .then((payload) => setSessionContact(payload.contact ?? null))
      .catch(() => setSessionContact(null));
  }, [activeSession?.contactId, token]);

  useEffect(() => {
    const cid = sessionContact?.id;
    if (!cid || !token) {
      setPreviousConversations([]);
      return;
    }
    apiFetch(`/api/contacts/${cid}/conversations`, token)
      .then((payload) => setPreviousConversations(payload.conversations ?? []))
      .catch(() => setPreviousConversations([]));
  }, [sessionContact?.id, token]);

  const loginAuth = async (e) => {
    e.preventDefault();
    setAuthError("");
    try {
      const payload = await apiFetch("/api/auth/login", "", {
        method: "POST",
        body: JSON.stringify({
          email: authForm.email,
          password: authForm.password,
        }),
      });
      if (payload.workspaceSelectionRequired) {
        setWorkspaceChoices(payload.workspaces ?? []);
        setAuthForm((prev) => ({
          ...prev,
          loginTicket: payload.loginTicket || "",
        }));
        setAuthStage("workspace-picker");
        return;
      }
      if (payload.token) {
        localStorage.setItem(TOKEN_KEY, payload.token);
        setToken(payload.token);
        setAuthForm({
          fullName: "",
          email: "",
          password: "",
          workspaceName: "",
          workspaceUsername: "",
          invitationToken: "",
          loginTicket: "",
        });
        setWorkspaceChoices([]);
        setAuthStage("login");
      }
    } catch (error) {
      setAuthError(error.message);
    }
  };

  const signupAccount = async (e) => {
    e.preventDefault();
    setAuthError("");
    try {
      const payload = await apiFetch("/api/auth/signup", "", {
        method: "POST",
        body: JSON.stringify({
          fullName: authForm.fullName,
          email: authForm.email,
          password: authForm.password,
        }),
      });
      setAuthForm((prev) => ({
        ...prev,
        loginTicket: payload.loginTicket || "",
      }));
      setAuthStage("signup-choice");
    } catch (error) {
      setAuthError(error.message);
    }
  };

  const createWorkspaceFromSignup = async (e) => {
    e.preventDefault();
    setAuthError("");
    try {
      const payload = await apiFetch("/api/workspaces", "", {
        method: "POST",
        body: JSON.stringify({
          name: authForm.workspaceName,
          workspaceUsername: authForm.workspaceUsername,
          loginTicket: authForm.loginTicket,
        }),
      });
      if (payload.token) {
        localStorage.setItem(TOKEN_KEY, payload.token);
        setToken(payload.token);
      }
    } catch (error) {
      setAuthError(error.message);
    }
  };

  const joinWorkspaceFromSignup = async (e) => {
    e.preventDefault();
    setAuthError("");
    try {
      const payload = await apiFetch("/api/invitations/accept", "", {
        method: "POST",
        body: JSON.stringify({
          loginTicket: authForm.loginTicket,
          invitationToken: authForm.invitationToken,
        }),
      });
      if (payload.token) {
        localStorage.setItem(TOKEN_KEY, payload.token);
        setToken(payload.token);
      }
    } catch (error) {
      setAuthError(error.message);
    }
  };

  const pickWorkspaceAfterLogin = async (workspaceUsername) => {
    setAuthError("");
    try {
      const payload = await apiFetch("/api/auth/select-workspace", "", {
        method: "POST",
        body: JSON.stringify({
          loginTicket: authForm.loginTicket,
          workspaceUsername,
        }),
      });
      if (payload.token) {
        localStorage.setItem(TOKEN_KEY, payload.token);
        setToken(payload.token);
      }
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
    setCannedReplies([]);
    setTags([]);
    setSessionTags([]);
    setSessionContact(null);
    setPreviousConversations([]);
    setConversationAttrs([]);
    setContacts([]);
    setChannelRecords([]);
    setAuthStage("login");
    setWorkspaceChoices([]);
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (
      messageAudience === "user" &&
      (activeSession?.status || "open") === "closed"
    ) {
      return;
    }
    if (!activeId || !text.trim()) return;
    sendTypingState(false);
    sendWsEvent("agent:message", {
      sessionId: activeId,
      text: text.trim(),
      internal: messageAudience === "team",
    });
    setText("");
    setMessageAudience("user");
    setCannedPanelOpen(false);
  };

  const sendAttachment = async (file, text = "") => {
    if (
      messageAudience === "user" &&
      (activeSession?.status || "open") === "closed"
    ) {
      return;
    }
    if (!token || !activeId || !file) return false;

    const formData = new FormData();
    formData.append("file", file);
    const payload = await apiFetch("/api/uploads/attachment", token, {
      method: "POST",
      body: formData,
    });
    const uploaded = payload?.file;
    if (!uploaded?.url) return false;

    sendWsEvent("agent:attachment", {
      sessionId: activeId,
      url: uploaded.url,
      fileName: uploaded.fileName || file.name || "attachment",
      mimeType: uploaded.mimeType || file.type || "application/octet-stream",
      attachmentType: uploaded.attachmentType || "",
      text: String(text || "").trim(),
      internal: messageAudience === "team",
    });
    setMessageAudience("user");
    setCannedPanelOpen(false);
    return true;
  };

  const listWhatsappTemplates = async (sessionId) => {
    if (!token || !sessionId) return [];
    const payload = await apiFetch(
      `/api/session/${sessionId}/whatsapp/templates`,
      token,
    );
    return Array.isArray(payload?.templates) ? payload.templates : [];
  };

  const sendWhatsappTemplate = async (
    sessionId,
    { templateName, languageCode, parameters },
  ) => {
    if (!token || !sessionId) return;
    await apiFetch(`/api/session/${sessionId}/whatsapp/template`, token, {
      method: "POST",
      body: JSON.stringify({
        templateName,
        languageCode,
        parameters: Array.isArray(parameters) ? parameters : [],
      }),
    });
  };

  const saveNote = async () => {
    if (!token || !activeId || !noteText.trim()) return;
    const payload = await apiFetch(`/api/session/${activeId}/notes`, token, {
      method: "POST",
      body: JSON.stringify({ text: noteText.trim() }),
    });
    setNotes((prev) => [...prev, payload.note]);
    setNoteText("");
  };

  const updateAgentStatus = async (status) => {
    if (!token) return;
    const payload = await apiFetch("/api/agent/status", token, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    setAgent(payload.agent);
  };

  const saveTenantSettings = async () => {
    if (!token || !tenantSettings) return;
    const payload = await apiFetch("/api/tenant/settings", token, {
      method: "PATCH",
      body: JSON.stringify(tenantSettings),
    });
    setTenantSettings(payload.settings ?? null);
  };

  const createContact = async (e) => {
    e.preventDefault();
    if (!token) return;
    const payload = await apiFetch("/api/contacts", token, {
      method: "POST",
      body: JSON.stringify(newContact),
    });
    if (payload.contact) {
      setContacts((prev) => [payload.contact, ...prev]);
      setNewContact({ displayName: "", email: "", phone: "" });
    }
  };

  const deleteContact = async (contactId) => {
    if (!token || !contactId) return;
    await apiFetch(`/api/contacts/${contactId}`, token, { method: "DELETE" });
    setContacts((prev) => prev.filter((c) => c.id !== contactId));
  };

  const patchContact = async (contactId, patch) => {
    if (!token || !contactId) return;
    const payload = await apiFetch(`/api/contacts/${contactId}`, token, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    if (payload.contact) {
      setContacts((prev) =>
        prev.map((c) => (c.id === contactId ? payload.contact : c)),
      );
      if (sessionContact?.id === contactId) setSessionContact(payload.contact);
    }
  };

  const addSessionTag = async (tagId) => {
    if (!token || !activeId || !tagId) return;
    await apiFetch(`/api/session/${activeId}/tags`, token, {
      method: "POST",
      body: JSON.stringify({ tagId }),
    });
    const payload = await apiFetch(`/api/session/${activeId}/tags`, token);
    setSessionTags(payload.tags ?? []);
  };

  const removeSessionTag = async (tagId) => {
    if (!token || !activeId || !tagId) return;
    await apiFetch(`/api/session/${activeId}/tags/${tagId}`, token, {
      method: "DELETE",
    });
    setSessionTags((prev) => prev.filter((t) => t.id !== tagId));
  };

  const patchSessionContact = async (contactId) => {
    if (!token || !activeId) return;
    const payload = await apiFetch(`/api/session/${activeId}/contact`, token, {
      method: "PATCH",
      body: JSON.stringify({ contactId: contactId || null }),
    });
    if (payload?.session) {
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== payload.session.id);
        return [payload.session, ...next];
      });
    }
    if (contactId) {
      apiFetch(`/api/contacts/${contactId}`, token)
        .then((res) => setSessionContact(res.contact ?? null))
        .catch(() => setSessionContact(null));
    } else {
      setSessionContact(null);
    }
  };

  const addConversationAttr = async () => {
    if (!token || !activeId || !(newConvAttrKey || "").trim()) return;
    await apiFetch(`/api/session/${activeId}/attributes`, token, {
      method: "POST",
      body: JSON.stringify({
        attributeKey: newConvAttrKey.trim(),
        attributeValue: newConvAttrValue.trim(),
      }),
    });
    const payload = await apiFetch(
      `/api/session/${activeId}/attributes`,
      token,
    );
    setConversationAttrs(payload.attributes ?? []);
    setNewConvAttrKey("");
    setNewConvAttrValue("");
  };

  const deleteConversationAttr = async (attrKey) => {
    if (!token || !activeId || !attrKey) return;
    await apiFetch(
      `/api/session/${activeId}/attributes/${encodeURIComponent(attrKey)}`,
      token,
      { method: "DELETE" },
    );
    setConversationAttrs((prev) =>
      prev.filter((a) => a.attributeKey !== attrKey),
    );
  };

  const patchSessionMeta = async (patch) => {
    if (!activeId) return;
    await patchActiveSession("meta", patch);
  };

  const resolveTemplate = (body) => {
    if (!body) return "";
    return body
      .replaceAll("{{agent_name}}", agent?.name || "Agent")
      .replaceAll("{{visitor_id}}", activeSession?.id?.slice(0, 8) || "visitor")
      .replaceAll("{{channel}}", activeSession?.channel || "web");
  };

  const insertCannedReply = (reply) => {
    const expanded = resolveTemplate(reply?.body || "");
    if (!expanded.trim()) return;
    setText((prev) => (prev.trim() ? `${prev}\n${expanded}` : expanded));
    setCannedPanelOpen(false);
  };

  const createCannedReply = async (e) => {
    e.preventDefault();
    if (!token || !newCanned.title.trim() || !newCanned.body.trim()) return;
    setCannedSaving(true);
    try {
      const payload = await apiFetch("/api/canned-replies", token, {
        method: "POST",
        body: JSON.stringify({
          title: newCanned.title.trim(),
          body: newCanned.body.trim(),
          shortcut: newCanned.shortcut.trim(),
          category: newCanned.category.trim(),
        }),
      });
      const created = payload.cannedReply;
      if (created) {
        setCannedReplies((prev) =>
          [...prev, created].sort((a, b) => a.title.localeCompare(b.title)),
        );
        setNewCanned({ title: "", body: "", shortcut: "", category: "" });
      }
    } finally {
      setCannedSaving(false);
    }
  };

  const deleteCannedReply = async (replyId) => {
    if (!token || !replyId) return;
    await apiFetch(`/api/canned-replies/${replyId}`, token, {
      method: "DELETE",
    });
    setCannedReplies((prev) => prev.filter((reply) => reply.id !== replyId));
  };

  const createFlow = async () => {
    if (!token) return;
    const graph = defaultFlowGraph();
    const payload = await apiFetch("/api/flows", token, {
      method: "POST",
      body: JSON.stringify({
        name: `Flow ${flows.length + 1}`,
        description: "",
        enabled: true,
        nodes: graph.nodes,
        edges: graph.edges,
      }),
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
      const nodesPayload = flowNodes.map((node, index) =>
        normalizeNode(node, index),
      );
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
          edges: edgesPayload,
          inputVariables: flowInputVariables,
          aiTool: flowAiTool,
          aiToolDescription: flowAiToolDescription,
        }),
      });

      const saved = payload.flow;
      if (!saved) {
        setFlowSaveStatus("Save failed");
        return;
      }

      setFlows((prev) =>
        prev.map((flow) => (flow.id === saved.id ? saved : flow)),
      );
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

    setSessions((prev) =>
      prev.map((session) =>
        session.flowId === activeFlowId
          ? { ...session, flowId: null }
          : session,
      ),
    );
  };

  const onFlowConnect = useCallback(
    (connection) => {
      setFlowEdges((prev) =>
        addEdge(
          { ...connection, id: `e-${crypto.randomUUID().slice(0, 8)}` },
          prev,
        ),
      );
    },
    [setFlowEdges],
  );

  const addFlowNode = (type, x, y) => {
    const px = x ?? 120 + Math.floor(Math.random() * 280);
    const py = y ?? 120 + Math.floor(Math.random() * 280);
    const node = createNode(type, px, py);
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
                ...patch,
              },
            }
          : node,
      ),
    );
  };

  const carouselItemsText = Array.isArray(selectedNode?.data?.items)
    ? selectedNode.data.items
        .map((item) =>
          [
            item?.title || "",
            item?.description || "",
            item?.price || "",
            item?.imageUrl || "",
          ].join(" | "),
        )
        .join("\n")
    : "";

  const renderMessageWidget = (message) => {
    const widget = message?.widget;
    if (!widget) return null;
    if (message?.sender !== "agent" && widget.type !== "attachment") return null;

    if (widget.type === "link_preview") {
      return (
        <a
          className="agent-widget agent-link-preview"
          href={widget.url || "#"}
          target="_blank"
          rel="noreferrer noopener"
        >
          {widget.image ? (
            <img
              src={widget.image}
              alt={widget.title || "Preview"}
              loading="lazy"
            />
          ) : null}
          <div className="agent-link-body">
            <p className="agent-link-site">{widget.siteName || "Link"}</p>
            <h4>{widget.title || widget.url || "Open link"}</h4>
            {widget.description ? <p>{widget.description}</p> : null}
            <span>{widget.url || ""}</span>
          </div>
        </a>
      );
    }

    if (widget.type === "attachment") {
      const attachmentType = String(
        widget.attachmentType || widget.kind || "file",
      ).toLowerCase();
      const isAgentTone = message?.sender === "agent";
      const canPreviewImage =
        attachmentType === "image" || attachmentType === "sticker";
      const canPreviewAudio =
        attachmentType === "audio" || attachmentType === "voice";
      const canPreviewVideo = attachmentType === "video";
      const title =
        widget.filename ||
        widget.title ||
        (attachmentType === "voice"
          ? "Voice Message"
          : attachmentType === "audio"
            ? "Audio"
            : attachmentType === "image"
              ? "Image"
              : attachmentType === "video"
                ? "Video"
                : attachmentType === "document"
                  ? "Document"
                  : attachmentType === "location"
                    ? "Location"
                    : "Attachment");
      const href = resolveApiUrl(widget.url || widget.mapUrl || "");
      const caption =
        widget.caption || widget.description || (href ? "" : message?.text || "");

      return (
        <div
          className={`agent-widget agent-attachment ${isAgentTone ? "agent-attachment-agent" : "agent-attachment-neutral"}`}
        >
          {canPreviewImage && href ? (
            <a href={href} target="_blank" rel="noreferrer noopener">
              <img
                src={href}
                alt={title}
                className="agent-attachment-image"
                loading="lazy"
              />
            </a>
          ) : null}
          {canPreviewAudio && href ? (
            <audio controls preload="metadata" className="agent-attachment-audio">
              <source src={href} type={widget.mimeType || "audio/mpeg"} />
            </audio>
          ) : null}
          {canPreviewVideo && href ? (
            <video
              controls
              preload="metadata"
              className="agent-attachment-video"
              src={href}
            />
          ) : null}
          <div className="agent-attachment-meta">
            <strong>{title}</strong>
            {caption ? <p>{caption}</p> : null}
            {href ? (
              <a href={href} target="_blank" rel="noreferrer noopener">
                Open {attachmentType}
              </a>
            ) : null}
          </div>
        </div>
      );
    }

    if (widget.type === "buttons" && Array.isArray(widget.buttons)) {
      return (
        <div className="agent-widget agent-buttons">
          {widget.buttons.slice(0, 8).map((button, idx) => (
            <button
              key={`${message.id}-ab-${idx}`}
              type="button"
              className="agent-pill"
            >
              {button?.label || "Option"}
            </button>
          ))}
        </div>
      );
    }

    if (widget.type === "select" && Array.isArray(widget.options)) {
      return (
        <div className="agent-widget agent-inline">
          <select className="agent-select" defaultValue="">
            <option value="">{widget.placeholder || "Select one"}</option>
            {widget.options.map((opt, idx) => {
              const label =
                typeof opt === "string"
                  ? opt
                  : opt?.label || opt?.value || "Option";
              const value = typeof opt === "string" ? opt : opt?.value || label;
              return (
                <option key={`${message.id}-so-${idx}`} value={value}>
                  {label}
                </option>
              );
            })}
          </select>
          <button type="button" className="agent-submit">
            {widget.buttonLabel || "Send"}
          </button>
        </div>
      );
    }

    if (widget.type === "quick_input") {
      return (
        <div className="agent-widget agent-inline">
          <input
            className="agent-input"
            type={widget.inputType || "text"}
            placeholder={widget.placeholder || "Type value"}
          />
          <button type="button" className="agent-submit">
            {widget.buttonLabel || "Send"}
          </button>
        </div>
      );
    }

    if (widget.type === "input_form" && Array.isArray(widget.fields)) {
      return (
        <div className="agent-widget agent-form">
          {widget.fields.slice(0, 8).map((field, idx) => (
            <input
              key={`${message.id}-f-${idx}`}
              className="agent-input"
              type={field?.type || "text"}
              placeholder={
                field?.placeholder || field?.label || field?.name || "Field"
              }
            />
          ))}
          <button type="button" className="agent-submit">
            {widget.submitLabel || "Submit"}
          </button>
        </div>
      );
    }

    if (widget.type === "carousel" && Array.isArray(widget.items)) {
      return (
        <div className="agent-widget agent-carousel">
          {widget.items.slice(0, 8).map((item, idx) => (
            <article
              key={`${message.id}-c-${idx}`}
              className="agent-carousel-card"
            >
              {item?.imageUrl ? (
                <img
                  src={item.imageUrl}
                  alt={item?.title || "Item"}
                  loading="lazy"
                />
              ) : null}
              <h4>{item?.title || "Item"}</h4>
              {item?.description ? <p>{item.description}</p> : null}
              {item?.price ? <strong>{item.price}</strong> : null}
              <button type="button" className="agent-submit">
                {(Array.isArray(item?.buttons) && item.buttons[0]?.label) ||
                  "View"}
              </button>
            </article>
          ))}
        </div>
      );
    }

    return null;
  };

  const removeSelectedNode = () => {
    if (!selectedNodeId) return;
    setFlowNodes((prev) => prev.filter((node) => node.id !== selectedNodeId));
    setFlowEdges((prev) =>
      prev.filter(
        (edge) =>
          edge.source !== selectedNodeId && edge.target !== selectedNodeId,
      ),
    );
    setSelectedNodeId("");
  };

  if (!token) {
    return (
      <AuthView
        authStage={authStage}
        authForm={authForm}
        setAuthForm={setAuthForm}
        workspaceChoices={workspaceChoices}
        authError={authError}
        loginAuth={loginAuth}
        signupAccount={signupAccount}
        createWorkspaceFromSignup={createWorkspaceFromSignup}
        joinWorkspaceFromSignup={joinWorkspaceFromSignup}
        pickWorkspaceAfterLogin={pickWorkspaceAfterLogin}
        setAuthStage={setAuthStage}
      />
    );
  }

  if (view === "conversations") {
    return (
      <div
        className={`agent-dashboard-shell ${theme === "dark" ? "theme-dark" : "theme-light"}`}
      >
        <ConversationsView
          view={view}
          setView={setView}
          sessions={sessions}
          createFlow={createFlow}
          conversationSearch={conversationSearch}
          setConversationSearch={setConversationSearch}
          openCount={openCount}
          waitingCount={waitingCount}
          closedCount={closedCount}
          conversationFilter={conversationFilter}
          setConversationFilter={setConversationFilter}
          agent={agent}
          updateAgentStatus={updateAgentStatus}
          channelCounts={channelCounts}
          filteredSessions={filteredSessions}
          activeId={activeId}
          setActiveId={setActiveId}
          formatTime={formatTime}
          sessionPreview={sessionPreview}
          activeSession={activeSession}
          messages={messages}
          visitorDraftBySession={visitorDraftBySession}
          bottomRef={bottomRef}
          sendMessage={sendMessage}
          sendAttachment={sendAttachment}
          listWhatsappTemplates={listWhatsappTemplates}
          sendWhatsappTemplate={sendWhatsappTemplate}
          messageAudience={messageAudience}
          setMessageAudience={setMessageAudience}
          cannedPanelOpen={cannedPanelOpen}
          setCannedPanelOpen={setCannedPanelOpen}
          patchSessionMeta={patchSessionMeta}
          isActiveSessionClosed={isActiveSessionClosed}
          slashQuery={slashQuery}
          filteredCannedReplies={filteredCannedReplies}
          insertCannedReply={insertCannedReply}
          deleteCannedReply={deleteCannedReply}
          text={text}
          setText={setText}
          bumpTyping={bumpTyping}
          sendTypingState={sendTypingState}
          sendWsEvent={sendWsEvent}
          cannedReplies={cannedReplies}
          resolveTemplate={resolveTemplate}
          agents={agents}
          teams={teams}
          channels={channels}
          flows={flows}
          patchActiveSession={patchActiveSession}
          noteText={noteText}
          setNoteText={setNoteText}
          saveNote={saveNote}
          notes={notes}
          createCannedReply={createCannedReply}
          newCanned={newCanned}
          setNewCanned={setNewCanned}
          cannedSaving={cannedSaving}
          renderMessageWidget={renderMessageWidget}
          contacts={contacts}
          tags={tags}
          sessionTags={sessionTags}
          sessionContact={sessionContact}
          previousConversations={previousConversations}
          conversationAttrs={conversationAttrs}
          addSessionTag={addSessionTag}
          removeSessionTag={removeSessionTag}
          patchSessionContact={patchSessionContact}
          addConversationAttr={addConversationAttr}
          deleteConversationAttr={deleteConversationAttr}
          newConvAttrKey={newConvAttrKey}
          setNewConvAttrKey={setNewConvAttrKey}
          newConvAttrValue={newConvAttrValue}
          setNewConvAttrValue={setNewConvAttrValue}
          tenantSettings={tenantSettings}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <CustomizationView
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          tenantSettings={tenantSettings}
          setTenantSettings={setTenantSettings}
          saveTenantSettings={saveTenantSettings}
          tenants={tenants}
          agent={agent}
          agents={agents}
          teams={teams}
          setTeams={setTeams}
          channels={channels}
          setChannels={setChannels}
          channelRecords={channelRecords}
          setChannelRecords={setChannelRecords}
          cannedReplies={cannedReplies}
          setCannedReplies={setCannedReplies}
          tags={tags}
          setTags={setTags}
          apiFetch={apiFetch}
          token={token}
        />
      </div>
    );
  }

  const mainPanel =
    view === "flows" ? (
      <section className="crm-main h-full min-h-0 bg-[#f8f9fb]">
        <FlowsView
          flows={flows}
          createFlow={createFlow}
          activeFlowId={activeFlowId}
          setActiveFlowId={setActiveFlowId}
          loadFlowIntoEditor={loadFlowIntoEditor}
          flowName={flowName}
          setFlowName={setFlowName}
          flowEnabled={flowEnabled}
          setFlowEnabled={setFlowEnabled}
          saveFlow={saveFlow}
          deleteCurrentFlow={deleteCurrentFlow}
          flowSaveStatus={flowSaveStatus}
          flowNodes={flowNodes}
          flowEdges={flowEdges}
          onFlowNodesChange={onFlowNodesChange}
          onFlowEdgesChange={onFlowEdgesChange}
          onFlowConnect={onFlowConnect}
          setSelectedNodeId={setSelectedNodeId}
          addFlowNode={addFlowNode}
          flowDescription={flowDescription}
          setFlowDescription={setFlowDescription}
          selectedNode={selectedNode}
          updateSelectedNodeData={updateSelectedNodeData}
          carouselItemsText={carouselItemsText}
          removeSelectedNode={removeSelectedNode}
          attributeDefs={attributeDefs}
          setAttributeDefs={setAttributeDefs}
          apiFetch={apiFetch}
          token={token}
          flowInputVariables={flowInputVariables}
          setFlowInputVariables={setFlowInputVariables}
          flowAiTool={flowAiTool}
          setFlowAiTool={setFlowAiTool}
          flowAiToolDescription={flowAiToolDescription}
          setFlowAiToolDescription={setFlowAiToolDescription}
        />
      </section>
    ) : view === "contacts" ? (
      <section className="crm-main h-full min-h-0 bg-[#f8f9fb]">
        <ContactsView
          contacts={contacts}
          newContact={newContact}
          setNewContact={setNewContact}
          createContact={createContact}
          deleteContact={deleteContact}
          patchContact={patchContact}
          tags={tags}
          apiFetch={apiFetch}
          token={token}
          formatTime={formatTime}
        />
      </section>
    ) : view === "csat" ? (
      <section className="crm-main h-full min-h-0 bg-[#f8f9fb]">
        <CsatView csatReport={csatReport} />
      </section>
    ) : null;

  return (
    <div
      className={`agent-dashboard-shell ${theme === "dark" ? "theme-dark" : "theme-light"}`}
    >
      <WorkspaceLayout
        view={view}
        setView={setView}
        sessions={sessions}
        conversationSearch={conversationSearch}
        setConversationSearch={setConversationSearch}
        openCount={openCount}
        waitingCount={waitingCount}
        closedCount={closedCount}
        conversationFilter={conversationFilter}
        setConversationFilter={setConversationFilter}
        agent={agent}
        updateAgentStatus={updateAgentStatus}
        channelCounts={channelCounts}
        filteredSessions={filteredSessions}
        activeId={activeId}
        setActiveId={setActiveId}
        formatTime={formatTime}
        sessionPreview={sessionPreview}
        mainPanel={mainPanel}
        showConversationPanels={false}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <CustomizationView
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        tenantSettings={tenantSettings}
        setTenantSettings={setTenantSettings}
        saveTenantSettings={saveTenantSettings}
        tenants={tenants}
        agent={agent}
        agents={agents}
        teams={teams}
        setTeams={setTeams}
        channels={channels}
        setChannels={setChannels}
        channelRecords={channelRecords}
        setChannelRecords={setChannelRecords}
        cannedReplies={cannedReplies}
        setCannedReplies={setCannedReplies}
        tags={tags}
        setTags={setTags}
        apiFetch={apiFetch}
        token={token}
      />
    </div>
  );
}
