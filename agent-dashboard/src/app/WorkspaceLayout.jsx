import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AtSign,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Inbox,
  MessageSquare,
  Search,
  Settings,
  Smile,
  UserMinus,
  UserRound,
  Workflow,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

const NAV_ITEMS = [
  { id: "conversations", icon: MessageSquare, title: "Conversations" },
  { id: "inbox", icon: Inbox, title: "Inbox" },
  { id: "flows", icon: Workflow, title: "Flow Builder" },
  { id: "contacts", icon: UserRound, title: "Contacts" },
  { id: "settings", icon: Settings, title: "Settings" },
  { id: "csat", icon: Smile, title: "CSAT" },
];

const STATUS_ITEMS = [
  { id: "active", label: "Active" },
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "awaiting", label: "Pending" },
  { id: "resolved", label: "Resolved" },
  { id: "snoozed", label: "Snoozed" },
];

const STATUS_FILTER_OPTIONS = [
  { id: "active", label: "Active", color: "bg-blue-500" },
  { id: "all", label: "All", color: "bg-slate-500" },
  { id: "open", label: "Open", color: "bg-emerald-500" },
  { id: "awaiting", label: "Pending", color: "bg-amber-500" },
  { id: "resolved", label: "Resolved", color: "bg-teal-500" },
  { id: "snoozed", label: "Snoozed", color: "bg-violet-500" },
];

const AGENT_INBOX_ITEMS = [
  { id: "mine", label: "Mine", icon: MessageSquare },
  { id: "unassigned", label: "Unassigned", icon: UserMinus },
  { id: "mentions", label: "Mentions", icon: AtSign },
  { id: "all", label: "All", icon: Inbox },
];

const AGENT_STATUS_OPTIONS = [
  { id: "online", label: "Online", color: "bg-emerald-500" },
  { id: "away", label: "Away", color: "bg-amber-500" },
  { id: "paused", label: "Paused", color: "bg-slate-400" },
];

function titleCase(value) {
  return String(value || "").replace(/^\w/, (m) => m.toUpperCase());
}

function visitorIdToPhone(session) {
  const raw = String(session?.visitorId || "");
  if (!raw) return "";
  const value = raw.startsWith("whatsapp:") ? raw.slice("whatsapp:".length) : raw;
  return value.trim();
}

function getSessionTitle(session, linkedContact = null) {
  if (!session) return "Unknown user";
  const base =
    linkedContact?.displayName ||
    linkedContact?.email ||
    linkedContact?.phone ||
    session.contactName ||
    session.contactEmail ||
    session.contactPhone ||
    session.displayName ||
    session.name ||
    session.phone ||
    visitorIdToPhone(session);
  if (base) return base;
  return `Visitor ${String(session.id || "").slice(0, 6)}`;
}

function getSessionSubtitle(session) {
  const preview = String(
    session.lastMessageText || session.lastMessage || "",
  ).trim();
  return preview || "Hi, I want to ask something...";
}

export function sessionInitials(session, linkedContact = null) {
  const title = getSessionTitle(session, linkedContact);
  return (
    title
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((chunk) => chunk[0]?.toUpperCase())
      .join("") || "U"
  );
}

export default function WorkspaceLayout({
  view,
  setView,
  sessions,
  conversationSearch,
  setConversationSearch,
  openCount,
  waitingCount,
  closedCount,
  conversationFilter,
  setConversationFilter,
  inboxScope = "mine",
  setInboxScope,
  inboxCounts = {},
  teamScope = "all",
  setTeamScope,
  teamCounts = {},
  teams = [],
  channelScope = "all",
  setChannelScope,
  channelFilters = [],
  tagScope = "all",
  setTagScope,
  tagFilters = [],
  agent,
  updateAgentStatus,
  filteredSessions,
  activeId,
  setActiveId,
  formatTime,
  sessionPreview,
  mainPanel,
  detailsPanel,
  showConversationPanels = true,
  onOpenSettings,
  unreadNotificationsCount = 0,
}) {
  const [viewportWidth, setViewportWidth] = useState(() => {
    if (typeof window === "undefined") return 1440;
    return window.innerWidth;
  });
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);
  const [sidebarSections, setSidebarSections] = useState({
    teams: true,
    channel: true,
    tags: false,
    agent: true,
  });
  const [agentStatusMenuOpen, setAgentStatusMenuOpen] = useState(false);
  const [statusFilterMenuOpen, setStatusFilterMenuOpen] = useState(false);
  const agentStatusMenuRef = useRef(null);
  const statusFilterMenuRef = useRef(null);
  const [collapsedPanels, setCollapsedPanels] = useState({
    workspaceSidebar: false,
    conversationList: false,
    details: false,
  });

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const isMobileLayout = viewportWidth <= 1024;
  useEffect(() => {
    if (!isMobileLayout || !activeId) {
      setMobileDetailsOpen(false);
    }
  }, [isMobileLayout, activeId]);
  useEffect(() => {
    if (
      (!agentStatusMenuOpen && !statusFilterMenuOpen) ||
      typeof window === "undefined"
    ) {
      return undefined;
    }
    const onClickOutside = (event) => {
      if (
        agentStatusMenuRef.current &&
        !agentStatusMenuRef.current.contains(event.target)
      ) {
        setAgentStatusMenuOpen(false);
      }
      if (
        statusFilterMenuRef.current &&
        !statusFilterMenuRef.current.contains(event.target)
      ) {
        setStatusFilterMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onClickOutside);
    return () => window.removeEventListener("mousedown", onClickOutside);
  }, [agentStatusMenuOpen, statusFilterMenuOpen]);
  const showDesktopDetailsPanel = viewportWidth > 1280 && Boolean(detailsPanel);
  const showDesktopSidebar =
    showConversationPanels &&
    !isMobileLayout &&
    viewportWidth > 1280 &&
    !collapsedPanels.workspaceSidebar;
  const showDesktopConversationList = !collapsedPanels.conversationList;
  const showDesktopDetails = showDesktopDetailsPanel && !collapsedPanels.details;
  const activeAgentStatus =
    AGENT_STATUS_OPTIONS.find((item) => item.id === (agent?.status || "online")) ||
    AGENT_STATUS_OPTIONS[0];
  const activeStatusFilter =
    STATUS_FILTER_OPTIONS.find((item) => item.id === conversationFilter) ||
    STATUS_FILTER_OPTIONS[0];
  const surfaceGridClass = (() => {
    if (showConversationPanels) {
      if (isMobileLayout) return "grid-cols-[1fr]";
      return showDesktopSidebar
        ? "grid-cols-[64px_250px_1fr]"
        : "grid-cols-[64px_1fr]";
    }
    if (detailsPanel) {
      return viewportWidth > 1280
        ? "grid-cols-[64px_1fr_300px]"
        : "grid-cols-[64px_1fr]";
    }
    return "grid-cols-[64px_1fr]";
  })();

  const toggleSidebarSection = (key) => {
    setSidebarSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };
  const toggleDesktopPanel = (key) => {
    setCollapsedPanels((prev) => ({ ...prev, [key]: !prev[key] }));
  };
  const renderInboxScopeTabs = (className = "") => (
    <div className={`flex items-center gap-1 overflow-x-auto py-1 ${className}`.trim()}>
      {AGENT_INBOX_ITEMS.map((item) => {
        const count =
          Number(inboxCounts?.[item.id] ?? 0) ||
          (item.id === "all" ? sessions.length : 0);
        const isActive = inboxScope === item.id;
        return (
          <button
            key={`scope-tab-${item.id}`}
            type="button"
            onClick={() => setInboxScope?.(item.id)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
              isActive
                ? "border-blue-200 bg-blue-50 text-blue-700"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            <span>{item.label}</span>
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                isActive ? "bg-white/80 text-blue-700" : "bg-slate-100 text-slate-500"
              }`}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="conversation-workspace h-full w-full">
      <div
        className={`crm-surface grid h-full min-h-0 overflow-hidden bg-white ${surfaceGridClass}`}
      >
        <aside className="crm-rail flex min-h-0 flex-col items-center justify-between border-r border-slate-200 py-3 max-[1024px]:hidden">
          <div className="flex flex-col items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-red-500 text-[10px] font-bold text-white">
              Q
            </div>
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = view === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (item.id === "settings") {
                      onOpenSettings?.();
                    } else {
                      setView(item.id);
                    }
                  }}
                  className={`crm-rail-btn relative ${isActive ? "active" : ""}`}
                  title={item.title}
                >
                  <Icon size={16} />
                  {item.id === "inbox" && unreadNotificationsCount > 0 ? (
                    <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-semibold text-white">
                      {Math.min(99, unreadNotificationsCount)}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <button type="button" className="crm-rail-avatar" title="Account">
            {String(agent?.name || "Agent")
              .split(" ")
              .slice(0, 2)
              .map((v) => v[0]?.toUpperCase())
              .join("")}
          </button>
        </aside>

        {showDesktopSidebar ? (
          <aside className="crm-sidebar-panel relative flex min-h-0 flex-col border-r border-slate-200 bg-white">
            {viewportWidth > 1280 ? (
              <button
                type="button"
                onClick={() => toggleDesktopPanel("workspaceSidebar")}
                className="absolute -right-3 top-4 z-30 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm hover:text-slate-700"
                title="Collapse chat list"
                aria-label="Collapse chat list"
              >
                <ChevronLeft size={14} />
              </button>
            ) : null}
            <div className="border-b border-slate-200 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">Chat</h2>
                <Badge variant="outline" className="text-[10px]">
                  {sessions.length}
                </Badge>
              </div>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-2.5 text-slate-400"
                  size={14}
                />
                <Input
                  value={conversationSearch}
                  onChange={(e) => setConversationSearch(e.target.value)}
                  placeholder="Search chat"
                  className="h-9 rounded-lg border-slate-200 bg-white pl-8"
                />
              </div>
            </div>

            <div className="space-y-4 p-4">
              <div>
                <button
                  type="button"
                  className="mb-2 flex w-full items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                  onClick={() => toggleSidebarSection("teams")}
                >
                  <span>Teams</span>
                  {sidebarSections.teams ? (
                    <ChevronDown size={14} className="text-slate-400" />
                  ) : (
                    <ChevronRight size={14} className="text-slate-400" />
                  )}
                </button>
                {sidebarSections.teams ? (
                  <div className="space-y-1.5">
                    <button
                      type="button"
                      onClick={() => setTeamScope?.("all")}
                      className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-left text-xs ${
                        teamScope === "all"
                          ? "border-blue-200 bg-blue-50 text-blue-700"
                          : "border-slate-200 bg-white text-slate-600"
                      }`}
                    >
                      <span>All teams</span>
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                        {Number(teamCounts?.all ?? sessions.length)}
                      </span>
                    </button>
                    {teams.map((team) => {
                      const count = Number(teamCounts?.[team.id] ?? 0);
                      const isActive = teamScope === team.id;
                      return (
                        <button
                          key={team.id}
                          type="button"
                          onClick={() => setTeamScope?.(team.id)}
                          className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-left text-xs ${
                            isActive
                              ? "border-blue-200 bg-blue-50 text-blue-700"
                              : "border-slate-200 bg-white text-slate-600"
                          }`}
                        >
                          <span className="truncate">{team.name}</span>
                          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                            {count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              <div>
                <button
                  type="button"
                  className="mb-2 flex w-full items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                  onClick={() => toggleSidebarSection("tags")}
                >
                  <span>Tags</span>
                  {sidebarSections.tags ? (
                    <ChevronDown size={14} className="text-slate-400" />
                  ) : (
                    <ChevronRight size={14} className="text-slate-400" />
                  )}
                </button>
                {sidebarSections.tags ? (
                  <div className="space-y-1.5">
                    {tagFilters.map((tag) => {
                      const isActive = tagScope === tag.id;
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => setTagScope?.(tag.id)}
                          className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-left text-xs ${
                            isActive
                              ? "border-blue-200 bg-blue-50 text-blue-700"
                              : "border-slate-200 bg-white text-slate-600"
                          }`}
                        >
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{ backgroundColor: tag.color || "#94a3b8" }}
                            />
                            <span className="truncate">{tag.name}</span>
                          </span>
                          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                            {Number(tag.count || 0)}
                          </span>
                        </button>
                      );
                    })}
                    {tagFilters.length === 0 ? (
                      <p className="text-xs text-slate-400">No tags</p>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div>
                <button
                  type="button"
                  className="mb-2 flex w-full items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                  onClick={() => toggleSidebarSection("channel")}
                >
                  <span>Channel</span>
                  {sidebarSections.channel ? (
                    <ChevronDown size={14} className="text-slate-400" />
                  ) : (
                    <ChevronRight size={14} className="text-slate-400" />
                  )}
                </button>
                {sidebarSections.channel ? (
                  <div className="space-y-1.5">
                    {channelFilters.map((channel) => {
                      const isActive = channelScope === channel.id;
                      return (
                        <button
                          key={channel.id}
                          type="button"
                          onClick={() => setChannelScope?.(channel.id)}
                          className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-left text-xs ${
                            isActive
                              ? "border-blue-200 bg-blue-50 text-blue-700"
                              : "border-slate-200 bg-white text-slate-600"
                          }`}
                        >
                          <span className="truncate">{channel.name}</span>
                          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                            {Number(channel.count || 0)}
                          </span>
                        </button>
                      );
                    })}
                    {channelFilters.length === 0 ? (
                      <p className="text-xs text-slate-400">No channels</p>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div>
                <button
                  type="button"
                  className="mb-2 flex w-full items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-500"
                  onClick={() => toggleSidebarSection("agent")}
                >
                  <span>Agent</span>
                  {sidebarSections.agent ? (
                    <ChevronDown size={14} className="text-slate-400" />
                  ) : (
                    <ChevronRight size={14} className="text-slate-400" />
                  )}
                </button>
                {sidebarSections.agent ? (
                  <div className="relative" ref={agentStatusMenuRef}>
                    <button
                      type="button"
                      onClick={() => setAgentStatusMenuOpen((prev) => !prev)}
                      className="inline-flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 hover:bg-slate-50"
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${activeAgentStatus.color}`}
                        />
                        {activeAgentStatus.label}
                      </span>
                      <ChevronDown size={13} className="text-slate-500" />
                    </button>
                    {agentStatusMenuOpen ? (
                      <div className="absolute z-30 mt-1 w-full rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                        {AGENT_STATUS_OPTIONS.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => {
                              updateAgentStatus(option.id);
                              setAgentStatusMenuOpen(false);
                            }}
                            className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs ${
                              option.id === activeAgentStatus.id
                                ? "bg-blue-50 text-blue-700"
                                : "text-slate-700 hover:bg-slate-50"
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              <span
                                className={`h-2.5 w-2.5 rounded-full ${option.color}`}
                              />
                              {option.label}
                            </span>
                            {option.id === activeAgentStatus.id ? (
                              <span className="text-[10px] font-medium">Selected</span>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </aside>
        ) : null}

        {showConversationPanels ? (
          isMobileLayout ? (
          activeId ? (
            <div className="relative flex h-full min-h-0 flex-col bg-white">
              {detailsPanel && !mobileDetailsOpen ? (
                <button
                  type="button"
                  onClick={() => setMobileDetailsOpen(true)}
                  className="absolute right-3 top-16 z-30 inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-lg"
                  title="Open contact panel"
                  aria-label="Open contact panel"
                >
                  <CircleUserRound size={16} />
                </button>
              ) : null}
              <div className="min-h-0 flex-1">{mainPanel}</div>
              {detailsPanel && mobileDetailsOpen ? (
                <div className="absolute inset-0 z-40 flex bg-black/35">
                  <button
                    type="button"
                    className="flex-1"
                    onClick={() => setMobileDetailsOpen(false)}
                    aria-label="Close contact panel"
                  />
                  <div className="h-full w-[min(92vw,380px)] border-l border-slate-200 bg-white shadow-xl">
                    <div className="flex items-center justify-end border-b border-slate-200 p-2">
                      <button
                        type="button"
                        onClick={() => setMobileDetailsOpen(false)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600"
                        aria-label="Close contact panel"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div className="h-[calc(100%-49px)] min-h-0 overflow-hidden">
                      {detailsPanel}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col bg-white">
              <div className="border-b border-slate-200 p-3">
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-3 top-2.5 text-slate-400"
                    size={14}
                  />
                  <Input
                    value={conversationSearch}
                    onChange={(e) => setConversationSearch(e.target.value)}
                    placeholder="Search chat"
                    className="h-9 rounded-lg border-slate-200 bg-white pl-8"
                  />
                </div>
                {renderInboxScopeTabs("mt-2")}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                <div className="space-y-1.5">
                  {filteredSessions.map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() => setActiveId(session.id)}
                      className="w-full rounded-xl border border-transparent bg-white px-3 py-2 text-left transition hover:border-slate-200 hover:bg-slate-50"
                    >
                      <div className="mb-1 flex items-start justify-between gap-3">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {getSessionTitle(session)}
                        </p>
                        <span className="shrink-0 text-[10px] text-slate-400">
                          {formatTime(session.updatedAt)}
                        </span>
                      </div>
                      <p className="truncate text-xs text-slate-500">
                        {sessionPreview(session) || getSessionSubtitle(session)}
                      </p>
                    </button>
                  ))}
                  {filteredSessions.length === 0 ? (
                    <p className="px-2 py-6 text-xs text-slate-400">
                      No conversations found.
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          )
          ) : (
          <div className="relative min-h-0">
            {viewportWidth > 1280 && collapsedPanels.workspaceSidebar ? (
              <button
                type="button"
                onClick={() => toggleDesktopPanel("workspaceSidebar")}
                className="absolute left-1 top-4 z-30 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm hover:text-slate-700"
                title="Expand chat list"
                aria-label="Expand chat list"
              >
                <ChevronRight size={14} />
              </button>
            ) : null}
            <ResizablePanelGroup direction="horizontal" className="min-h-0">
              {showDesktopConversationList ? (
                <>
                  <ResizablePanel defaultSize={32} minSize={20} className="min-h-0">
                    <aside className="crm-list relative flex h-full min-h-0 flex-col bg-white">
                      <button
                        type="button"
                        onClick={() => toggleDesktopPanel("conversationList")}
                        className="absolute -right-3 top-4 z-30 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm hover:text-slate-700"
                        title="Collapse conversations"
                        aria-label="Collapse conversations"
                      >
                        <ChevronLeft size={14} />
                      </button>
                      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                        <div className="flex items-center gap-2">
                          <CircleUserRound size={16} className="text-slate-500" />
                          <p className="text-sm font-semibold text-slate-900">
                            Conversations
                          </p>
                        </div>
                        <div className="relative" ref={statusFilterMenuRef}>
                          <button
                            type="button"
                            onClick={() => setStatusFilterMenuOpen((prev) => !prev)}
                            className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-700 hover:bg-slate-50"
                          >
                            <span
                              className={`h-2 w-2 rounded-full ${activeStatusFilter.color}`}
                            />
                            <span>{activeStatusFilter.label}</span>
                            <ChevronDown size={12} className="text-slate-500" />
                          </button>
                          {statusFilterMenuOpen ? (
                            <div className="absolute right-0 z-30 mt-1 w-44 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                              {STATUS_FILTER_OPTIONS.map((option) => (
                                <button
                                  key={option.id}
                                  type="button"
                                  onClick={() => {
                                    setConversationFilter(option.id);
                                    setStatusFilterMenuOpen(false);
                                  }}
                                  className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs ${
                                    option.id === activeStatusFilter.id
                                      ? "bg-blue-50 text-blue-700"
                                      : "text-slate-700 hover:bg-slate-50"
                                  }`}
                                >
                                  <span className="flex items-center gap-2">
                                    <span
                                      className={`h-2.5 w-2.5 rounded-full ${option.color}`}
                                    />
                                    {option.label}
                                  </span>
                                  {option.id === activeStatusFilter.id ? (
                                    <span className="text-[10px] font-medium">
                                      Selected
                                    </span>
                                  ) : null}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <div className="border-b border-slate-200 px-3 py-2">
                        {renderInboxScopeTabs()}
                      </div>

                      <ScrollArea className="h-full p-2">
                        <div className="space-y-1.5">
                          {filteredSessions.map((session) => {
                            const isActive = session.id === activeId;
                            return (
                              <button
                                key={session.id}
                                type="button"
                                onClick={() => setActiveId(session.id)}
                                className={`crm-session-item w-full rounded-xl border px-3 py-2 text-left transition ${
                                  isActive
                                    ? "border-blue-200 bg-blue-50"
                                    : "border-transparent bg-white hover:border-slate-200 hover:bg-slate-50"
                                }`}
                              >
                                <div className="mb-1 flex items-start justify-between gap-3">
                                  <p className="truncate text-sm font-medium text-slate-900">
                                    {getSessionTitle(session)}
                                  </p>
                                  <span className="shrink-0 text-[10px] text-slate-400">
                                    {formatTime(session.updatedAt)}
                                  </span>
                                </div>
                                <p className="truncate text-xs text-slate-500">
                                  {sessionPreview(session) ||
                                    getSessionSubtitle(session)}
                                </p>
                                {(session.tags || []).length > 0 ? (
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {session.tags.slice(0, 3).map((tag) => (
                                      <span
                                        key={`${session.id}-tag-${tag.id}`}
                                        className="rounded-full border px-1.5 py-0.5 text-[10px] font-medium"
                                        style={{
                                          borderColor: tag.color || "#cbd5e1",
                                          color: tag.color || "#475569",
                                          backgroundColor: `${tag.color || "#cbd5e1"}15`,
                                        }}
                                      >
                                        {tag.name}
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
                                <div className="mt-1.5 flex items-center justify-between">
                                  <p className="text-[10px] uppercase tracking-wide text-slate-400">
                                    {titleCase(session.channel)} •{" "}
                                    {session.status || "open"}
                                  </p>
                                  {(session.unreadCount || 0) > 0 ? (
                                    <span className="rounded-full bg-orange-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                      {session.unreadCount}
                                    </span>
                                  ) : null}
                                </div>
                              </button>
                            );
                          })}
                          {filteredSessions.length === 0 ? (
                            <p className="px-2 py-6 text-xs text-slate-400">
                              No conversations found.
                            </p>
                          ) : null}
                        </div>
                      </ScrollArea>
                    </aside>
                  </ResizablePanel>
                  <ResizableHandle withHandle />
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => toggleDesktopPanel("conversationList")}
                  className="absolute left-1 top-14 z-30 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm hover:text-slate-700"
                  title="Expand conversations"
                  aria-label="Expand conversations"
                >
                  <ChevronRight size={14} />
                </button>
              )}

              <ResizablePanel
                defaultSize={showDesktopDetails ? 45 : 68}
                minSize={30}
                className="min-h-0"
              >
                {mainPanel}
              </ResizablePanel>

              {showDesktopDetails ? (
                <>
                  <ResizableHandle withHandle />
                  <ResizablePanel
                    defaultSize={23}
                    minSize={16}
                    className="min-h-0"
                  >
                    <div className="relative h-full min-h-0">
                      <button
                        type="button"
                        onClick={() => toggleDesktopPanel("details")}
                        className="absolute -left-3 top-4 z-30 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm hover:text-slate-700"
                        title="Collapse contact panel"
                        aria-label="Collapse contact panel"
                      >
                        <ChevronRight size={14} />
                      </button>
                      {detailsPanel}
                    </div>
                  </ResizablePanel>
                </>
              ) : showDesktopDetailsPanel ? (
                <button
                  type="button"
                  onClick={() => toggleDesktopPanel("details")}
                  className="absolute right-1 top-4 z-30 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm hover:text-slate-700"
                  title="Expand contact panel"
                  aria-label="Expand contact panel"
                >
                  <ChevronLeft size={14} />
                </button>
              ) : null}
            </ResizablePanelGroup>
          </div>
          )
        ) : (
          <>
            {mainPanel}
            {detailsPanel || null}
          </>
        )}
      </div>
    </div>
  );
}
