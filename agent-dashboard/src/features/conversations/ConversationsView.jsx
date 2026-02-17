import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function ConversationsView({
  view,
  setView,
  sessions,
  createFlow,
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
  createCannedReply,
  newCanned,
  setNewCanned,
  cannedSaving,
  renderMessageWidget,
}) {
  return (
    <div className="conversation-workspace grid min-h-0 grid-cols-[68px_300px_1fr_340px] max-[1360px]:grid-cols-[68px_280px_1fr] max-[980px]:grid-cols-[1fr]">
      <aside className="agent-nav-rail flex min-h-0 flex-col items-center gap-2 border-r py-3 max-[980px]:hidden">
        <button type="button" className={`agent-nav-pill ${view === "conversations" ? "active" : ""}`} onClick={() => setView("conversations")} title="Conversations">C</button>
        <button type="button" className={`agent-nav-pill ${view === "flows" ? "active" : ""}`} onClick={() => setView("flows")} title="Flow Builder">F</button>
        <button type="button" className={`agent-nav-pill ${view === "contacts" ? "active" : ""}`} onClick={() => setView("contacts")} title="Contacts">U</button>
        <button type="button" className={`agent-nav-pill ${view === "customization" ? "active" : ""}`} onClick={() => setView("customization")} title="Customization">W</button>
        <button type="button" className={`agent-nav-pill ${view === "csat" ? "active" : ""}`} onClick={() => setView("csat")} title="CSAT">S</button>
      </aside>

      <aside className="conversation-sidebar flex min-h-0 flex-col border-r border-slate-200 bg-white max-[980px]:hidden">
        <div className="border-b border-slate-200 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Inbox</h2>
              <p className="text-xs text-slate-500">{sessions.length} conversations</p>
            </div>
            <Button size="sm" variant="outline" onClick={createFlow}>+ Flow</Button>
          </div>
          <Input value={conversationSearch} onChange={(e) => setConversationSearch(e.target.value)} placeholder="Search conversation" className="h-9" />
        </div>

        <div className="space-y-4 border-b border-slate-200 px-4 py-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-center"><p className="text-[11px] text-slate-500">Open</p><p className="text-sm font-semibold text-slate-900">{openCount}</p></div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-center"><p className="text-[11px] text-slate-500">Awaiting</p><p className="text-sm font-semibold text-slate-900">{waitingCount}</p></div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-center"><p className="text-[11px] text-slate-500">Closed</p><p className="text-sm font-semibold text-slate-900">{closedCount}</p></div>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {["all", "open", "awaiting", "closed"].map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setConversationFilter(status)}
                className={`rounded-md border px-1.5 py-1 text-[11px] uppercase tracking-wide ${
                  conversationFilter === status
                    ? "border-blue-200 bg-blue-50 text-blue-700"
                    : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                }`}
              >
                {status}
              </button>
            ))}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Status</label>
            <select className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm" value={agent?.status || "online"} onChange={(e) => updateAgentStatus(e.target.value)}>
              <option value="online">online</option>
              <option value="away">away</option>
              <option value="paused">paused</option>
            </select>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Channels</p>
            <div className="space-y-1">
              {channelCounts.map(([channel, count]) => (
                <div key={channel} className="flex items-center justify-between rounded-md px-1.5 py-1 text-xs text-slate-600">
                  <span className="capitalize">{channel}</span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{count}</span>
                </div>
              ))}
              {channelCounts.length === 0 && <p className="text-xs text-slate-400">No channels available.</p>}
            </div>
          </div>
        </div>

        <ScrollArea className="h-full p-2">
          <div className="space-y-2">
            {filteredSessions.map((session) => {
              const isActive = session.id === activeId;
              return (
                <button
                  key={session.id}
                  onClick={() => setActiveId(session.id)}
                  className={`conversation-session-item w-full rounded-xl border px-3 py-2 text-left transition ${
                    isActive
                      ? "border-blue-200 bg-blue-50 shadow-sm"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-900">{session.id.slice(0, 8)}</p>
                    <span className="text-[11px] text-slate-400">{formatTime(session.updatedAt)}</span>
                  </div>
                  <p className="max-h-8 overflow-hidden text-xs leading-4 text-slate-500">{sessionPreview(session)}</p>
                  <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">
                    {session.channel} • {(session.status || "open").toUpperCase()}
                  </p>
                </button>
              );
            })}
            {filteredSessions.length === 0 && <p className="px-1 text-xs text-slate-400">No conversations found.</p>}
          </div>
        </ScrollArea>
      </aside>

      <section className="conversation-main grid min-h-0 grid-rows-[62px_1fr_118px] border-r border-slate-200 bg-white max-[1220px]:border-r-0">
        <header className="flex items-center justify-between border-b border-slate-200 px-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">{activeSession ? `Session: ${activeSession.id}` : "Choose a conversation"}</h3>
            <p className="text-xs text-slate-500">{activeSession ? `${activeSession.channel} channel` : "Select a session on the left"}</p>
          </div>
          {activeSession && (
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="uppercase">{activeSession.status || "open"}</Badge>
              <Badge variant="outline" className="uppercase">{activeSession.priority || "normal"}</Badge>
              <Badge variant="secondary" className="capitalize">{activeSession.channel}</Badge>
              <Badge variant={activeSession.handoverActive ? "default" : "secondary"}>{activeSession.handoverActive ? "Human" : "Bot"}</Badge>
            </div>
          )}
        </header>

        <ScrollArea className="conversation-thread h-full p-4">
          <div className="space-y-3">
            {messages.map((message) =>
              message.sender === "system" ? (
                <div key={message.id} className="flex justify-center py-1">
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500">{String(message.text ?? "")}</span>
                </div>
              ) : (
                <article
                  key={message.id}
                  className={`w-fit max-w-[74%] rounded-2xl border px-3 py-2.5 text-sm shadow-sm ${
                    message.sender === "agent"
                      ? "ml-auto border-blue-500 bg-blue-600 text-white"
                      : message.sender === "team"
                        ? "ml-auto border-amber-300 bg-amber-100 text-amber-950"
                        : "border-slate-200 bg-white text-slate-900"
                  }`}
                >
                  {message.sender === "team" ? (
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700">Internal note</p>
                  ) : null}
                  <div className={`dashboard-md ${message.sender === "agent" ? "dashboard-md-agent" : ""}`}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{String(message.text ?? "")}</ReactMarkdown>
                  </div>
                  {renderMessageWidget(message)}
                  <time
                    className={`mt-1 block text-right text-[11px] ${
                      message.sender === "agent"
                        ? "text-blue-100"
                        : message.sender === "team"
                          ? "text-amber-700"
                          : "text-slate-400"
                    }`}
                  >
                    {formatTime(message.createdAt)}
                  </time>
                </article>
              ),
            )}

            {activeId && visitorDraftBySession[activeId] && (
              <article className="max-w-[78%] rounded-2xl border border-dashed border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
                <p className="whitespace-pre-wrap break-words">{visitorDraftBySession[activeId]}</p>
                <time className="mt-1 block text-right text-[11px] text-slate-400">typing...</time>
              </article>
            )}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        <form onSubmit={sendMessage} className="relative grid grid-rows-[auto_1fr] gap-2 border-t border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-md border border-slate-300 bg-slate-50 p-0.5">
              <button
                type="button"
                className={`rounded px-2 py-1 text-xs font-medium transition ${
                  messageAudience === "user"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
                onClick={() => setMessageAudience("user")}
              >
                User message
              </button>
              <button
                type="button"
                className={`rounded px-2 py-1 text-xs font-medium transition ${
                  messageAudience === "team"
                    ? "bg-amber-100 text-amber-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
                onClick={() => setMessageAudience("team")}
              >
                Team note
              </button>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setCannedPanelOpen((v) => !v)} disabled={!activeId}>Canned replies</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => patchSessionMeta({ status: "closed" })} disabled={!activeId}>Close chat</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => patchSessionMeta({ status: "open" })} disabled={!activeId || !isActiveSessionClosed}>Reopen</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => patchSessionMeta({ priority: "high" })} disabled={!activeId}>Set high priority</Button>
            <span className="text-[11px] text-slate-400">Shortcuts: `Ctrl/Cmd+Enter` send, `/shortcut` expand.</span>
          </div>

          {(cannedPanelOpen || slashQuery.length > 0) && (
            <div className="absolute bottom-[108px] left-3 right-3 z-20 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
              {slashQuery ? (
                <p className="mb-2 text-[11px] text-slate-500">Filtering canned replies by: <strong>/{slashQuery}</strong></p>
              ) : null}
              <div className="max-h-36 space-y-1 overflow-y-auto">
                {filteredCannedReplies.map((reply) => (
                  <div key={reply.id} className="flex items-center gap-2 rounded-md border border-slate-200 bg-white p-1.5">
                    <button type="button" className="flex-1 text-left" onClick={() => insertCannedReply(reply)}>
                      <p className="text-xs font-semibold text-slate-800">{reply.title}</p>
                      <p className="truncate text-[11px] text-slate-500">{reply.shortcut ? `${reply.shortcut} • ` : ""}{reply.body}</p>
                    </button>
                    <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs text-red-600 hover:text-red-700" onClick={() => deleteCannedReply(reply.id)}>Delete</Button>
                  </div>
                ))}
                {filteredCannedReplies.length === 0 && <p className="text-xs text-slate-400">No canned replies found.</p>}
              </div>
            </div>
          )}

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Textarea
              placeholder={
                activeId
                  ? isActiveSessionClosed && messageAudience === "user"
                    ? "This conversation is closed. Reopen to send a user message."
                    : "Type your reply..."
                  : "Select a conversation to reply"
              }
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                bumpTyping();
              }}
              onBlur={() => sendTypingState(false)}
              onKeyDown={(e) => {
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
                    return;
                  }
                }

                if (e.key === "Tab" && slashQuery.length > 0) {
                  const firstFiltered = filteredCannedReplies[0];
                  if (firstFiltered) {
                    e.preventDefault();
                    setText(resolveTemplate(firstFiltered.body));
                    setCannedPanelOpen(false);
                  }
                }
              }}
              disabled={!activeId || (isActiveSessionClosed && messageAudience === "user")}
              rows={2}
              className="min-h-10 resize-none bg-slate-50"
            />
            <Button
              type="submit"
              disabled={!activeId || !text.trim() || (isActiveSessionClosed && messageAudience === "user")}
              className="h-10 self-end bg-blue-600 text-white hover:bg-blue-700"
            >
              Send
            </Button>
          </div>
        </form>
      </section>

      <aside className="conversation-details flex min-h-0 flex-col bg-white max-[1360px]:hidden">
        <div className="border-b border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Profile details</h3>
          <p className="mt-1 text-xs text-slate-500">User information, routing and conversation notes.</p>
        </div>

        <ScrollArea className="h-full p-4">
          <div className="space-y-4 text-sm">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700">
                  {activeSession?.id?.slice(0, 2).toUpperCase() || "--"}
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {activeSession ? `Visitor ${activeSession.id.slice(0, 6)}` : "No visitor selected"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {activeSession ? `Joined ${new Date(activeSession.createdAt).toLocaleDateString()}` : "Select a conversation"}
                  </p>
                </div>
              </div>

              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between text-slate-600">
                  <span>Assignee</span>
                  <span className="font-medium text-slate-900">
                    {agents.find((item) => item.id === activeSession?.assigneeAgentId)?.name || "Unassigned"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span>Channel</span>
                  <span className="font-medium capitalize text-slate-900">{activeSession?.channel || "web"}</span>
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span>Inbox</span>
                  <span className="font-medium text-slate-900">
                    {inboxes.find((item) => item.id === activeSession?.inboxId)?.name || "None"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span>Team</span>
                  <span className="font-medium text-slate-900">
                    {teams.find((item) => item.id === activeSession?.teamId)?.name || "None"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span>Messages</span>
                  <span className="font-medium text-slate-900">{activeSession?.messageCount || 0}</span>
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span>Status</span>
                  <span className="font-medium uppercase text-slate-900">{activeSession?.status || "open"}</span>
                </div>
                <div className="flex items-center justify-between text-slate-600">
                  <span>Priority</span>
                  <span className="font-medium uppercase text-slate-900">{activeSession?.priority || "normal"}</span>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Agent Handover</span>
                <Badge variant={activeSession?.handoverActive ? "default" : "secondary"}>{activeSession?.handoverActive ? "Human" : "Bot"}</Badge>
              </div>
              <Button size="sm" className="w-full" variant={activeSession?.handoverActive ? "outline" : "default"} disabled={!activeId} onClick={() => setHandover(!Boolean(activeSession?.handoverActive))}>
                {activeSession?.handoverActive ? "Return To Bot" : "Take Over As Agent"}
              </Button>
            </div>

            <div className="space-y-3 rounded-xl border border-slate-200 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Routing</p>

              <div>
                <label className="mb-1 block text-xs text-slate-500">Status</label>
                <select className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm" value={activeSession?.status || "open"} onChange={(e) => patchSessionMeta({ status: e.target.value })} disabled={!activeId}>
                  <option value="open">open</option>
                  <option value="awaiting">awaiting</option>
                  <option value="snoozed">snoozed</option>
                  <option value="resolved">resolved</option>
                  <option value="closed">closed</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-500">Priority</label>
                <select className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm" value={activeSession?.priority || "normal"} onChange={(e) => patchSessionMeta({ priority: e.target.value })} disabled={!activeId}>
                  <option value="low">low</option>
                  <option value="normal">normal</option>
                  <option value="high">high</option>
                  <option value="urgent">urgent</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-500">Assignee</label>
                <select className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm" value={activeSession?.assigneeAgentId || ""} onChange={(e) => patchActiveSession("assignee", { agentId: e.target.value || null })} disabled={!activeId}>
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
                <select className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm" value={activeSession?.channel || "web"} onChange={(e) => patchActiveSession("channel", { channel: e.target.value })} disabled={!activeId}>
                  {channels.map((channel) => (
                    <option key={channel} value={channel}>{channel}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-500">Inbox</label>
                <select className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm" value={activeSession?.inboxId || ""} onChange={(e) => patchActiveSession("inbox", { inboxId: e.target.value || null })} disabled={!activeId}>
                  <option value="">None</option>
                  {inboxes.map((inbox) => (
                    <option key={inbox.id} value={inbox.id}>{inbox.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-500">Team</label>
                <select className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm" value={activeSession?.teamId || ""} onChange={(e) => patchActiveSession("team", { teamId: e.target.value || null })} disabled={!activeId}>
                  <option value="">None</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>{team.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs text-slate-500">Flow</label>
                <select className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm" value={activeSession?.flowId || ""} onChange={(e) => patchActiveSession("flow", { flowId: e.target.value || null })} disabled={!activeId}>
                  <option value="">No flow</option>
                  {flows.map((flow) => (
                    <option key={flow.id} value={flow.id}>{flow.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</p>
              <Textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Add a note for this conversation" rows={3} disabled={!activeId} />
              <Button className="mt-2 w-full" variant="secondary" onClick={saveNote} disabled={!activeId || !noteText.trim()}>Save Note</Button>

              <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                {notes.map((note) => (
                  <div key={note.id} className="rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-700">
                    <p>{note.text}</p>
                    <p className="mt-1 text-[11px] text-slate-400">{formatTime(note.createdAt)}</p>
                  </div>
                ))}
                {notes.length === 0 && <p className="text-xs text-slate-400">No notes yet.</p>}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Canned replies</p>
              <form className="space-y-2" onSubmit={createCannedReply}>
                <Input value={newCanned.title} onChange={(e) => setNewCanned((prev) => ({ ...prev, title: e.target.value }))} placeholder="Title" className="h-8" />
                <div className="grid grid-cols-2 gap-2">
                  <Input value={newCanned.shortcut} onChange={(e) => setNewCanned((prev) => ({ ...prev, shortcut: e.target.value }))} placeholder="/shortcut" className="h-8" />
                  <Input value={newCanned.category} onChange={(e) => setNewCanned((prev) => ({ ...prev, category: e.target.value }))} placeholder="Category" className="h-8" />
                </div>
                <Textarea
                  value={newCanned.body}
                  onChange={(e) => setNewCanned((prev) => ({ ...prev, body: e.target.value }))}
                  placeholder="Template body. Use {{agent_name}}, {{visitor_id}}, {{channel}}."
                  rows={3}
                />
                <Button type="submit" size="sm" className="w-full" disabled={cannedSaving || !newCanned.title || !newCanned.body}>
                  {cannedSaving ? "Saving..." : "Save canned reply"}
                </Button>
              </form>
            </div>
          </div>
        </ScrollArea>
      </aside>
    </div>
  );
}
