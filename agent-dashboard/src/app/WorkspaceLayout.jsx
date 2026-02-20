import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  MessageSquare,
  Search,
  Settings,
  Smile,
  UserRound,
  Workflow,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

const NAV_ITEMS = [
  { id: "conversations", icon: MessageSquare, title: "Conversations" },
  { id: "flows", icon: Workflow, title: "Flow Builder" },
  { id: "contacts", icon: UserRound, title: "Contacts" },
  { id: "settings", icon: Settings, title: "Settings" },
  { id: "csat", icon: Smile, title: "CSAT" },
];

const STATUS_ITEMS = [
  { id: "active", label: "Active" },
  { id: "all", label: "All" },
  { id: "open", label: "Agent" },
  { id: "awaiting", label: "Awaiting agent" },
  { id: "closed", label: "Paused" },
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
  agent,
  updateAgentStatus,
  channelCounts,
  filteredSessions,
  activeId,
  setActiveId,
  formatTime,
  sessionPreview,
  mainPanel,
  detailsPanel,
  showConversationPanels = true,
  onOpenSettings,
}) {
  const [viewportWidth, setViewportWidth] = useState(() => {
    if (typeof window === "undefined") return 1440;
    return window.innerWidth;
  });
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);
  const [sidebarSections, setSidebarSections] = useState({
    status: true,
    channel: true,
    agent: true,
  });
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
  const showDesktopDetailsPanel = viewportWidth > 1280 && Boolean(detailsPanel);
  const showDesktopSidebar =
    showConversationPanels &&
    !isMobileLayout &&
    viewportWidth > 1280 &&
    !collapsedPanels.workspaceSidebar;
  const showDesktopConversationList = !collapsedPanels.conversationList;
  const showDesktopDetails = showDesktopDetailsPanel && !collapsedPanels.details;
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

  const statusCount = {
    active: openCount + waitingCount,
    all: sessions.length,
    open: openCount,
    awaiting: waitingCount,
    closed: closedCount,
  };
  const toggleSidebarSection = (key) => {
    setSidebarSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };
  const toggleDesktopPanel = (key) => {
    setCollapsedPanels((prev) => ({ ...prev, [key]: !prev[key] }));
  };

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
                  className={`crm-rail-btn ${isActive ? "active" : ""}`}
                  title={item.title}
                >
                  <Icon size={16} />
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
          <aside className="crm-sidebar-panel relative flex min-h-0 flex-col border-r border-slate-200 bg-[#fbfcfe]">
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
                  onClick={() => toggleSidebarSection("status")}
                >
                  <span>Status</span>
                  {sidebarSections.status ? (
                    <ChevronDown size={14} className="text-slate-400" />
                  ) : (
                    <ChevronRight size={14} className="text-slate-400" />
                  )}
                </button>
                {sidebarSections.status ? (
                  <div className="space-y-1.5">
                    {STATUS_ITEMS.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setConversationFilter(item.id)}
                        className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-left text-xs ${
                          conversationFilter === item.id
                            ? "border-blue-200 bg-blue-50 text-blue-700"
                            : "border-slate-200 bg-white text-slate-600"
                        }`}
                      >
                        <span>{item.label}</span>
                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                          {statusCount[item.id] ?? 0}
                        </span>
                      </button>
                    ))}
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
                    {channelCounts.map(([channel, count]) => (
                      <div
                        key={channel}
                        className="flex items-center justify-between rounded-lg px-2 py-1.5 text-xs text-slate-600"
                      >
                        <span className="capitalize">{channel}</span>
                        <span>{count}</span>
                      </div>
                    ))}
                    {channelCounts.length === 0 ? (
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
                  <select
                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-700"
                    value={agent?.status || "online"}
                    onChange={(e) => updateAgentStatus(e.target.value)}
                  >
                    <option value="online">online</option>
                    <option value="away">away</option>
                    <option value="paused">paused</option>
                  </select>
                ) : null}
              </div>
            </div>
          </aside>
        ) : null}

        {showConversationPanels ? (
          isMobileLayout ? (
          activeId ? (
            <div className="relative flex h-full min-h-0 flex-col bg-white">
              {detailsPanel ? (
                <button
                  type="button"
                  onClick={() => setMobileDetailsOpen(true)}
                  className="absolute right-3 top-3 z-20 inline-flex h-8 items-center rounded-md border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700 shadow-sm"
                >
                  Contact
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
                        <select
                          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
                          value={conversationFilter}
                          onChange={(e) => setConversationFilter(e.target.value)}
                        >
                          {STATUS_ITEMS.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.label}
                            </option>
                          ))}
                        </select>
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
                                className={`w-full rounded-xl border px-3 py-2 text-left transition ${
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
