import WorkspaceLayout, { sessionInitials } from "@/app/WorkspaceLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  AtSign,
  CirclePause,
  ClipboardList,
  Globe,
  House,
  Image,
  MessageCircle,
  Paperclip,
  Phone,
  Plus,
  Send,
  Smile,
  Tag,
  Users,
  X,
} from "lucide-react";
import { useState as useStateReact } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function MessageAvatar({ message, tenantSettings }) {
  const [hover, setHover] = useStateReact(false);
  const isBot =
    message.agentId === "__bot__" || (!message.agentId && !message.agentName);
  const avatarUrl =
    message.agentAvatarUrl || (isBot ? tenantSettings?.botAvatarUrl : "") || "";
  const name =
    message.agentName || (isBot ? tenantSettings?.botName || "Bot" : "Agent");
  const initials = (() => {
    if (!name) return "A";
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name[0].toUpperCase();
  })();

  return (
    <div
      className="relative inline-flex flex-shrink-0"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={name}
          className="h-6 w-6 rounded-full object-cover ring-2 ring-white"
        />
      ) : (
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white ring-2 ring-white ${
            isBot
              ? "bg-gradient-to-br from-emerald-500 to-teal-500"
              : "bg-gradient-to-br from-violet-500 to-indigo-500"
          }`}
        >
          {initials}
        </span>
      )}
      {hover && (
        <div className="absolute bottom-full right-0 mb-1.5 z-50 whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white shadow-lg pointer-events-none">
          {name}
          <div className="absolute top-full right-2 -mt-px h-0 w-0 border-x-4 border-t-4 border-x-transparent border-t-slate-900" />
        </div>
      )}
    </div>
  );
}

function getSessionTitle(session) {
  if (!session) return "No conversation selected";
  const base = session.contactName || session.displayName || session.name;
  if (base) return base;
  return `Visitor ${String(session.id || "").slice(0, 6)}`;
}

export default function ConversationsView({
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
  activeSession,
  messages,
  visitorDraftBySession,
  bottomRef,
  sendMessage,
  messageAudience,
  setMessageAudience,
  cannedPanelOpen,
  setCannedPanelOpen,
  patchSessionMeta,
  isActiveSessionClosed,
  slashQuery,
  filteredCannedReplies,
  insertCannedReply,
  deleteCannedReply,
  text,
  setText,
  bumpTyping,
  sendTypingState,
  sendWsEvent,
  cannedReplies,
  resolveTemplate,
  agents,
  teams,
  inboxes,
  channels,
  flows,
  patchActiveSession,
  setHandover,
  noteText,
  setNoteText,
  saveNote,
  notes,
  renderMessageWidget,
  // CRM props
  contacts,
  tags,
  sessionTags,
  sessionContact,
  conversationAttrs,
  addSessionTag,
  removeSessionTag,
  patchSessionContact,
  addConversationAttr,
  deleteConversationAttr,
  newConvAttrKey,
  setNewConvAttrKey,
  newConvAttrValue,
  setNewConvAttrValue,
  tenantSettings,
}) {
  const handleComposerKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (activeId && text.trim()) {
        sendTypingState(false);
        sendWsEvent("agent:message", {
          sessionId: activeId,
          text: text.trim(),
          internal: messageAudience === "team",
        });
        setText("");
        setMessageAudience("user");
        setCannedPanelOpen(false);
      }
      return;
    }

    if (e.key === "Escape") {
      setCannedPanelOpen(false);
    }

    if (e.key === "Enter" && !e.shiftKey) {
      const candidate = text.trim().toLowerCase();
      if (candidate.startsWith("/")) {
        const matched = cannedReplies.find(
          (reply) => (reply.shortcut || "").trim().toLowerCase() === candidate,
        );
        const firstFiltered = filteredCannedReplies[0];
        if (matched) {
          e.preventDefault();
          setText(resolveTemplate(matched.body));
          setCannedPanelOpen(false);
          return;
        }
        if (firstFiltered) {
          e.preventDefault();
          setText(resolveTemplate(firstFiltered.body));
          setCannedPanelOpen(false);
          return;
        }
        e.preventDefault();
      }
      return;
    }

    if (e.key === "Tab" && slashQuery.length > 0) {
      const firstFiltered = filteredCannedReplies[0];
      if (firstFiltered) {
        e.preventDefault();
        setText(resolveTemplate(firstFiltered.body));
        setCannedPanelOpen(false);
      }
    }
  };

  return (
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
      mainPanel={
        <section className="crm-main grid h-full min-h-0 overflow-hidden grid-rows-[56px_minmax(0,1fr)_auto] bg-[#f8f9fb]">
          <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-fuchsia-100 text-[10px] font-semibold text-fuchsia-700">
                {sessionInitials(activeSession)}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {getSessionTitle(activeSession)}
                </p>
                <p className="text-[11px] text-emerald-600">
                  {activeSession ? "Online" : "No conversation selected"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 rounded-md px-2 text-[11px]"
                onClick={() => patchSessionMeta({ status: "awaiting" })}
                disabled={!activeId}
              >
                <CirclePause size={13} /> Pause
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 rounded-md px-2 text-[11px]"
                onClick={() => patchSessionMeta({ status: "closed" })}
                disabled={!activeId}
              >
                <X size={13} /> Close
              </Button>
            </div>
          </header>

          <ScrollArea className="conversation-thread h-full min-h-0 px-5 py-4">
            <div className="flex flex-col">
              {messages.map((message, index) => {
                if (message.sender === "system") {
                  return (
                    <div key={message.id} className="flex justify-center my-3">
                      <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] text-slate-500">
                        {String(message.text ?? "")}
                      </span>
                    </div>
                  );
                }

                const prev = messages[index - 1];
                const next = messages[index + 1];
                const isAgent = message.sender === "agent";
                const isTeam = message.sender === "team";
                const isVisitor = !isAgent && !isTeam;
                const senderGroup = isAgent || isTeam ? "right" : "left";
                const prevGroup =
                  prev && prev.sender !== "system"
                    ? prev.sender === "agent" || prev.sender === "team"
                      ? "right"
                      : "left"
                    : null;
                const nextGroup =
                  next && next.sender !== "system"
                    ? next.sender === "agent" || next.sender === "team"
                      ? "right"
                      : "left"
                    : null;
                const isLastInSequence =
                  nextGroup !== senderGroup ||
                  ((isAgent || isTeam) &&
                    next &&
                    next.agentId !== message.agentId);
                const gapTop =
                  prevGroup === senderGroup &&
                  (!prev || prev.agentId === message.agentId)
                    ? "mt-1"
                    : "mt-3";
                return (
                  <article
                    key={message.id}
                    className={`flex items-end gap-1.5 ${gapTop} ${isAgent || isTeam ? "ml-auto flex-row-reverse" : ""} w-fit max-w-[76%]`}
                  >
                    {(isAgent || isTeam) &&
                      (isLastInSequence ? (
                        <MessageAvatar
                          message={message}
                          tenantSettings={tenantSettings}
                        />
                      ) : (
                        <span className="inline-block h-6 w-6 flex-shrink-0" />
                      ))}
                    <div
                      className={`rounded-xl border px-3 py-2 text-sm shadow-sm ${
                        isAgent
                          ? "border-blue-600 bg-blue-600 text-white"
                          : isTeam
                            ? "border-amber-200 bg-amber-50 text-amber-900"
                            : "border-slate-200 bg-white text-slate-900"
                      }`}
                    >
                      {isTeam ? (
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide">
                          Internal note
                        </p>
                      ) : null}
                      <div
                        className={`dashboard-md ${isAgent ? "dashboard-md-agent" : ""}`}
                      >
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {String(message.text ?? "")}
                        </ReactMarkdown>
                      </div>
                      {renderMessageWidget(message)}
                      <time
                        className={`mt-1 block text-right text-[10px] ${isAgent ? "text-blue-100" : "text-slate-400"}`}
                      >
                        {formatTime(message.createdAt)}
                      </time>
                    </div>
                  </article>
                );
              })}

              {activeId && visitorDraftBySession[activeId] ? (
                <article className="w-fit max-w-[76%] rounded-xl border border-dashed border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
                  <p className="whitespace-pre-wrap break-words">
                    {visitorDraftBySession[activeId]}
                  </p>
                  <time className="mt-1 block text-right text-[10px] text-slate-400">
                    typing...
                  </time>
                </article>
              ) : null}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          <form
            onSubmit={sendMessage}
            className="relative border-t border-slate-200 bg-white p-3"
          >
            {(cannedPanelOpen || slashQuery.length > 0) && (
              <div className="absolute bottom-full left-3 right-3 z-20 mb-2 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                {slashQuery ? (
                  <p className="mb-2 text-[11px] text-slate-500">
                    Filtering canned replies by: <strong>/{slashQuery}</strong>
                  </p>
                ) : null}
                <div className="max-h-36 space-y-1 overflow-y-auto">
                  {filteredCannedReplies.map((reply) => (
                    <div
                      key={reply.id}
                      className="flex items-center gap-2 rounded-md border border-slate-200 bg-white p-1.5"
                    >
                      <button
                        type="button"
                        className="flex-1 text-left"
                        onClick={() => insertCannedReply(reply)}
                      >
                        <p className="text-xs font-semibold text-slate-800">
                          {reply.title}
                        </p>
                        <p className="truncate text-[11px] text-slate-500">
                          {reply.shortcut ? `${reply.shortcut} • ` : ""}
                          {reply.body}
                        </p>
                      </button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs text-red-600 hover:text-red-700"
                        onClick={() => deleteCannedReply(reply.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  ))}
                  {filteredCannedReplies.length === 0 ? (
                    <p className="text-xs text-slate-400">
                      No canned replies found.
                    </p>
                  ) : null}
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-2.5 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
              <Textarea
                placeholder={
                  activeId
                    ? isActiveSessionClosed && messageAudience === "user"
                      ? "This conversation is closed. Reopen to send a user message."
                      : "Type your message"
                    : "Select a conversation"
                }
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  bumpTyping();
                }}
                onBlur={() => sendTypingState(false)}
                onKeyDown={handleComposerKeyDown}
                disabled={
                  !activeId ||
                  (isActiveSessionClosed && messageAudience === "user")
                }
                rows={2}
                className="min-h-20 resize-none border-0 bg-transparent px-1 py-1.5 text-[13px] shadow-none focus-visible:ring-0"
              />

              <div className="mt-1 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 rounded-full p-0 text-slate-500 hover:text-slate-700"
                    disabled={!activeId}
                  >
                    <Paperclip size={14} />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 rounded-full p-0 text-slate-500 hover:text-slate-700"
                    disabled={!activeId}
                  >
                    <Smile size={14} />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 rounded-full p-0 text-slate-500 hover:text-slate-700"
                    disabled={!activeId}
                  >
                    <Image size={14} />
                  </Button>
                  <div className="ml-1 inline-flex rounded-md border border-slate-300 bg-white p-0.5">
                    <button
                      type="button"
                      className={`rounded px-2 py-1 text-xs font-medium transition ${
                        messageAudience === "user"
                          ? "bg-slate-100 text-slate-900"
                          : "text-slate-600"
                      }`}
                      onClick={() => setMessageAudience("user")}
                    >
                      Reply
                    </button>
                    <button
                      type="button"
                      className={`rounded px-2 py-1 text-xs font-medium transition ${
                        messageAudience === "team"
                          ? "bg-amber-100 text-amber-900"
                          : "text-slate-600"
                      }`}
                      onClick={() => setMessageAudience("team")}
                    >
                      Note
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-lg px-2 text-[11px]"
                    onClick={() => setCannedPanelOpen((v) => !v)}
                    disabled={!activeId}
                  >
                    <ClipboardList size={13} /> Assign to Form
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-lg px-2 text-[11px]"
                    onClick={() =>
                      setHandover(!Boolean(activeSession?.handoverActive))
                    }
                    disabled={!activeId}
                  >
                    <Users size={13} />{" "}
                    {activeSession?.handoverActive
                      ? "Return to Bot"
                      : "Take Over"}
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      !activeId ||
                      !text.trim() ||
                      (isActiveSessionClosed && messageAudience === "user")
                    }
                    className="h-8 rounded-lg bg-orange-500 px-3 text-white hover:bg-orange-600"
                  >
                    Send <Send size={12} />
                  </Button>
                </div>
              </div>
            </div>
          </form>
        </section>
      }
      detailsPanel={
        <aside className="crm-details flex min-h-0 flex-col border-l border-slate-200 bg-white max-[1500px]:hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-fuchsia-100 text-[10px] font-semibold text-fuchsia-700">
                {sessionInitials(activeSession)}
              </div>
              <p className="text-sm font-semibold text-slate-900">
                {getSessionTitle(activeSession)}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 rounded-md px-2 text-[11px]"
              disabled={!activeId}
            >
              Edit
            </Button>
          </div>

          <ScrollArea className="h-full p-4">
            <div className="space-y-4">
              {/* ── Contact info ──────────────────────────── */}
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Contact
                </p>
                {sessionContact ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-semibold text-indigo-700">
                        {(
                          sessionContact.displayName ||
                          sessionContact.email ||
                          "?"
                        )
                          .slice(0, 2)
                          .toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-slate-900">
                          {sessionContact.displayName || "Unnamed"}
                        </p>
                        <p className="truncate text-[10px] text-slate-500">
                          {sessionContact.email || sessionContact.phone || "-"}
                        </p>
                      </div>
                      <button
                        className="text-slate-400 hover:text-red-500"
                        onClick={() => patchSessionContact(null)}
                        title="Unlink contact"
                      >
                        <X size={13} />
                      </button>
                    </div>
                    {sessionContact.company && (
                      <p className="mt-1 text-[10px] text-slate-500">
                        🏢 {sessionContact.company}
                      </p>
                    )}
                  </div>
                ) : (
                  <select
                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
                    value=""
                    onChange={(e) =>
                      e.target.value && patchSessionContact(e.target.value)
                    }
                    disabled={!activeId}
                  >
                    <option value="">Link a contact…</option>
                    {(contacts || []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.displayName || c.email || c.id.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <Separator />

              {/* ── Tags ─────────────────────────────────── */}
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Tags
                </p>
                <div className="flex flex-wrap gap-1">
                  {(sessionTags || []).map((tag) => (
                    <Badge
                      key={tag.id}
                      variant="outline"
                      className="gap-1 text-[10px]"
                      style={{ borderColor: tag.color, color: tag.color }}
                    >
                      <Tag size={10} />
                      {tag.name}
                      <button
                        onClick={() => removeSessionTag(tag.id)}
                        className="ml-0.5 hover:opacity-70"
                      >
                        <X size={10} />
                      </button>
                    </Badge>
                  ))}
                </div>
                <select
                  className="mt-2 w-full rounded-lg border border-dashed border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-500"
                  value=""
                  onChange={(e) =>
                    e.target.value && addSessionTag(e.target.value)
                  }
                  disabled={!activeId}
                >
                  <option value="">+ Add tag…</option>
                  {(tags || [])
                    .filter(
                      (t) => !(sessionTags || []).find((st) => st.id === t.id),
                    )
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
              </div>

              <Separator />

              <div className="space-y-2 text-xs text-slate-600">
                <div className="flex items-start gap-2">
                  <MessageCircle size={13} className="mt-0.5 text-slate-400" />
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">
                      Channel
                    </p>
                    <p className="text-slate-900">
                      {(activeSession?.channel || "web").toUpperCase()}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <AtSign size={13} className="mt-0.5 text-slate-400" />
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">
                      ID
                    </p>
                    <p className="break-all text-slate-900">
                      {activeSession?.id || "-"}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Phone size={13} className="mt-0.5 text-slate-400" />
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">
                      Phone number
                    </p>
                    <p className="text-slate-900">
                      {activeSession?.phone || "-"}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <House size={13} className="mt-0.5 text-slate-400" />
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">
                      Assignee
                    </p>
                    <p className="text-slate-900">
                      {agents.find(
                        (item) => item.id === activeSession?.assigneeAgentId,
                      )?.name || "Unassigned"}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Globe size={13} className="mt-0.5 text-slate-400" />
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">
                      Routing
                    </p>
                    <p className="text-slate-900">
                      {teams.find((item) => item.id === activeSession?.teamId)
                        ?.name || "No team"}
                      {" • "}
                      {inboxes.find(
                        (item) => item.id === activeSession?.inboxId,
                      )?.name || "No inbox"}
                    </p>
                  </div>
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Status
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
                    value={activeSession?.status || "open"}
                    onChange={(e) =>
                      patchSessionMeta({ status: e.target.value })
                    }
                    disabled={!activeId}
                  >
                    <option value="open">open</option>
                    <option value="awaiting">awaiting</option>
                    <option value="snoozed">snoozed</option>
                    <option value="resolved">resolved</option>
                    <option value="closed">closed</option>
                  </select>
                  <select
                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
                    value={activeSession?.priority || "normal"}
                    onChange={(e) =>
                      patchSessionMeta({ priority: e.target.value })
                    }
                    disabled={!activeId}
                  >
                    <option value="low">low</option>
                    <option value="normal">normal</option>
                    <option value="high">high</option>
                    <option value="urgent">urgent</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <select
                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
                    value={activeSession?.assigneeAgentId || ""}
                    onChange={(e) =>
                      patchActiveSession("assignee", {
                        agentId: e.target.value || null,
                      })
                    }
                    disabled={!activeId}
                  >
                    <option value="">Unassigned</option>
                    {agents.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
                    value={activeSession?.teamId || ""}
                    onChange={(e) =>
                      patchActiveSession("team", {
                        teamId: e.target.value || null,
                      })
                    }
                    disabled={!activeId}
                  >
                    <option value="">No team</option>
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <select
                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
                    value={activeSession?.channel || "web"}
                    onChange={(e) =>
                      patchActiveSession("channel", { channel: e.target.value })
                    }
                    disabled={!activeId}
                  >
                    {channels.map((channel) => (
                      <option key={channel} value={channel}>
                        {channel}
                      </option>
                    ))}
                  </select>
                  <select
                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
                    value={activeSession?.inboxId || ""}
                    onChange={(e) =>
                      patchActiveSession("inbox", {
                        inboxId: e.target.value || null,
                      })
                    }
                    disabled={!activeId}
                  >
                    <option value="">No inbox</option>
                    {inboxes.map((inbox) => (
                      <option key={inbox.id} value={inbox.id}>
                        {inbox.name}
                      </option>
                    ))}
                  </select>
                </div>

                <select
                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700"
                  value={activeSession?.flowId || ""}
                  onChange={(e) =>
                    patchActiveSession("flow", {
                      flowId: e.target.value || null,
                    })
                  }
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

              <Separator />

              {/* ── Conversation attributes ──────────────── */}
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Custom attributes
                </p>
                <div className="space-y-1.5">
                  {(conversationAttrs || []).map((attr) => (
                    <div
                      key={attr.attributeKey}
                      className="flex items-center gap-1.5 rounded border border-slate-200 bg-slate-50 px-2 py-1"
                    >
                      <span className="text-[10px] font-medium text-slate-600">
                        {attr.attributeKey}
                      </span>
                      <span className="text-[10px] text-slate-400">=</span>
                      <span className="flex-1 truncate text-[10px] text-slate-900">
                        {attr.attributeValue}
                      </span>
                      <button
                        onClick={() =>
                          deleteConversationAttr(attr.attributeKey)
                        }
                        className="text-slate-400 hover:text-red-500"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex items-center gap-1">
                  <Input
                    value={newConvAttrKey || ""}
                    onChange={(e) => setNewConvAttrKey(e.target.value)}
                    placeholder="key"
                    className="h-7 flex-1 text-[10px]"
                    disabled={!activeId}
                  />
                  <Input
                    value={newConvAttrValue || ""}
                    onChange={(e) => setNewConvAttrValue(e.target.value)}
                    placeholder="value"
                    className="h-7 flex-1 text-[10px]"
                    disabled={!activeId}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2"
                    disabled={!activeId || !(newConvAttrKey || "").trim()}
                    onClick={addConversationAttr}
                  >
                    <Plus size={12} />
                  </Button>
                </div>
              </div>

              <Separator />

              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Notes
                </p>
                <Textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Write a note"
                  rows={3}
                  disabled={!activeId}
                  className="rounded-xl border-slate-200"
                />
                <Button
                  className="mt-2 h-8 w-full rounded-lg"
                  variant="secondary"
                  onClick={saveNote}
                  disabled={!activeId || !noteText.trim()}
                >
                  Save note
                </Button>

                <div className="mt-3 space-y-2">
                  {notes.map((note) => (
                    <div
                      key={note.id}
                      className="rounded-lg border border-slate-200 bg-slate-50 p-2"
                    >
                      <p className="text-xs text-slate-700">{note.text}</p>
                      <p className="mt-1 text-[10px] text-slate-400">
                        {formatTime(note.createdAt)}
                      </p>
                    </div>
                  ))}
                  {notes.length === 0 ? (
                    <p className="text-xs text-slate-400">No notes yet.</p>
                  ) : null}
                </div>
              </div>
            </div>
          </ScrollArea>
        </aside>
      }
    />
  );
}
