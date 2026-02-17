import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CircleUserRound,
  MessageSquare,
  Paintbrush,
  Search,
  Smile,
  UserRound,
  Workflow,
} from "lucide-react";

const NAV_ITEMS = [
  { id: "conversations", icon: MessageSquare, title: "Conversations" },
  { id: "flows", icon: Workflow, title: "Flow Builder" },
  { id: "contacts", icon: UserRound, title: "Contacts" },
  { id: "customization", icon: Paintbrush, title: "Customization" },
  { id: "csat", icon: Smile, title: "CSAT" },
];

const STATUS_ITEMS = [
  { id: "all", label: "All" },
  { id: "open", label: "Agent" },
  { id: "awaiting", label: "Awaiting agent" },
  { id: "closed", label: "Paused" },
];

function titleCase(value) {
  return String(value || "").replace(/^\\w/, (m) => m.toUpperCase());
}

function getSessionTitle(session) {
  if (!session) return "Unknown user";
  const base = session.contactName || session.displayName || session.name;
  if (base) return base;
  return `Visitor ${String(session.id || "").slice(0, 6)}`;
}

function getSessionSubtitle(session) {
  const preview = String(session.lastMessageText || session.lastMessage || "").trim();
  return preview || "Hi, I want to ask something...";
}

export function sessionInitials(session) {
  const title = getSessionTitle(session);
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
}) {
  const statusCount = {
    all: sessions.length,
    open: openCount,
    awaiting: waitingCount,
    closed: closedCount,
  };

  return (
    <div className="conversation-workspace h-full w-full p-4 max-[980px]:p-2">
      <div
        className={`crm-surface grid h-full min-h-0 overflow-hidden rounded-2xl border border-slate-300 bg-white max-[980px]:grid-cols-[1fr] ${
          showConversationPanels
            ? "grid-cols-[64px_250px_1fr_320px_300px] max-[1500px]:grid-cols-[64px_240px_1fr_300px] max-[1220px]:grid-cols-[64px_240px_1fr]"
            : detailsPanel
              ? "grid-cols-[64px_1fr_300px] max-[1500px]:grid-cols-[64px_1fr]"
              : "grid-cols-[64px_1fr]"
        }`}
      >
        <aside className="crm-rail flex min-h-0 flex-col items-center justify-between border-r border-slate-200 py-3 max-[980px]:hidden">
          <div className="flex flex-col items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-red-500 text-[10px] font-bold text-white">Q</div>
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = view === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setView(item.id)}
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

        {showConversationPanels ? (
          <aside className="crm-inbox flex min-h-0 flex-col border-r border-slate-200 bg-[#fbfcfe] max-[1220px]:hidden">
          <div className="border-b border-slate-200 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Chat</h2>
              <Badge variant="outline" className="text-[10px]">{sessions.length}</Badge>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 text-slate-400" size={14} />
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
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Inbox</p>
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
            </div>

            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Channel</p>
              <div className="space-y-1.5">
                {channelCounts.map(([channel, count]) => (
                  <div key={channel} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-xs text-slate-600">
                    <span className="capitalize">{channel}</span>
                    <span>{count}</span>
                  </div>
                ))}
                {channelCounts.length === 0 ? <p className="text-xs text-slate-400">No channels</p> : null}
              </div>
            </div>

            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Agent</p>
              <select
                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-700"
                value={agent?.status || "online"}
                onChange={(e) => updateAgentStatus(e.target.value)}
              >
                <option value="online">online</option>
                <option value="away">away</option>
                <option value="paused">paused</option>
              </select>
            </div>
          </div>
          </aside>
        ) : null}

        {showConversationPanels ? (
          <aside className="crm-list flex min-h-0 flex-col border-r border-slate-200 bg-white max-[980px]:hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div className="flex items-center gap-2">
              <CircleUserRound size={16} className="text-slate-500" />
              <p className="text-sm font-semibold text-slate-900">Conversations</p>
            </div>
            <Badge variant="secondary" className="text-[10px]">Newest</Badge>
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
                      <p className="truncate text-sm font-medium text-slate-900">{getSessionTitle(session)}</p>
                      <span className="shrink-0 text-[10px] text-slate-400">{formatTime(session.updatedAt)}</span>
                    </div>
                    <p className="truncate text-xs text-slate-500">{sessionPreview(session) || getSessionSubtitle(session)}</p>
                    <div className="mt-1.5 flex items-center justify-between">
                      <p className="text-[10px] uppercase tracking-wide text-slate-400">{titleCase(session.channel)} • {session.status || "open"}</p>
                      {(session.unreadCount || 0) > 0 ? (
                        <span className="rounded-full bg-orange-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">{session.unreadCount}</span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
              {filteredSessions.length === 0 ? <p className="px-2 py-6 text-xs text-slate-400">No conversations found.</p> : null}
            </div>
          </ScrollArea>
          </aside>
        ) : null}

        {mainPanel}

        {detailsPanel || null}
      </div>
    </div>
  );
}
