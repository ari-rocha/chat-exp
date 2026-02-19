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
  Send,
  Smile,
  Tag,
  Users,
  X,
} from "lucide-react";
import { useEffect, useRef, useState as useStateReact } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const API_BASE = API_URL.replace(/\/+$/, "");

function resolveMediaUrl(url) {
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

function isAttachmentPlaceholderText(text) {
  const value = String(text || "").trim().toLowerCase();
  if (!value) return true;
  const known = new Set([
    "sent an image",
    "sent a video",
    "sent a document",
    "sent a sticker",
    "sent a voice message",
    "sent an audio file",
    "sent an attachment",
    "shared a location",
  ]);
  return known.has(value) || /^sent a [a-z]+ message$/.test(value);
}

function normalizeWhatsappMarkdown(raw) {
  const input = String(raw || "");
  if (!input) return "";
  let out = input;
  // WhatsApp bold: *text* -> Markdown bold: **text**
  out = out.replace(/\*(?!\*)([^*\n]+?)\*(?!\*)/g, (_, inner) => {
    const trimmed = String(inner || "");
    if (!trimmed.trim()) return `*${trimmed}*`;
    return `**${trimmed}**`;
  });
  // WhatsApp strikethrough: ~text~ -> Markdown ~~text~~
  out = out.replace(/~([^~\n]+?)~/g, (_, inner) => {
    const trimmed = String(inner || "");
    if (!trimmed.trim()) return `~${trimmed}~`;
    return `~~${trimmed}~~`;
  });
  return out;
}

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

function getSessionTitle(session, linkedContact = null) {
  if (!session) return "No conversation selected";
  const base =
    linkedContact?.displayName ||
    linkedContact?.email ||
    linkedContact?.phone ||
    session.contactName ||
    session.contactEmail ||
    session.contactPhone ||
    session.displayName ||
    session.name ||
    session.phone;
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
  inboxFilter,
  setInboxFilter,
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
  sendAttachment,
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
  addSessionTag,
  removeSessionTag,
  patchSessionContact,
  tenantSettings,
  onOpenSettings,
  listWhatsappTemplates,
  sendWhatsappTemplate,
}) {
  const [lightbox, setLightbox] = useStateReact(null);
  const [emojiOpen, setEmojiOpen] = useStateReact(false);
  const [pendingAttachment, setPendingAttachment] = useStateReact(null);
  const [waTemplatesOpen, setWaTemplatesOpen] = useStateReact(false);
  const [waTemplates, setWaTemplates] = useStateReact([]);
  const [waTemplatesLoading, setWaTemplatesLoading] = useStateReact(false);
  const [waTemplatesError, setWaTemplatesError] = useStateReact("");
  const [waTemplateQuery, setWaTemplateQuery] = useStateReact("");
  const [waTemplateSending, setWaTemplateSending] = useStateReact(false);
  const [waSelectedTemplate, setWaSelectedTemplate] = useStateReact(null);
  const [waTemplateParams, setWaTemplateParams] = useStateReact([]);
  const fileInputRef = useRef(null);
  const emojiPanelRef = useRef(null);
  const templatePanelRef = useRef(null);
  const textareaRef = useRef(null);

  const clearPendingAttachment = () => {
    if (pendingAttachment?.previewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(pendingAttachment.previewUrl);
    }
    setPendingAttachment(null);
  };

  useEffect(() => {
    return () => {
      if (pendingAttachment?.previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(pendingAttachment.previewUrl);
      }
    };
  }, [pendingAttachment]);

  useEffect(() => {
    const onDocPointer = (event) => {
      if (
        emojiPanelRef.current &&
        !emojiPanelRef.current.contains(event.target)
      ) {
        setEmojiOpen(false);
      }
      if (
        templatePanelRef.current &&
        !templatePanelRef.current.contains(event.target)
      ) {
        setWaTemplatesOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocPointer);
    return () => document.removeEventListener("mousedown", onDocPointer);
  }, []);

  const canSendNow =
    Boolean(activeId) &&
    !(isActiveSessionClosed && messageAudience === "user") &&
    (Boolean(pendingAttachment) || Boolean(text.trim()));

  const submitComposerPayload = async () => {
    if (!canSendNow) return;
    sendTypingState(false);
    if (pendingAttachment) {
      const ok = await sendAttachment(pendingAttachment.file, text.trim());
      if (!ok) return;
      clearPendingAttachment();
      setText("");
      return;
    }
    sendWsEvent("agent:message", {
      sessionId: activeId,
      text: text.trim(),
      internal: messageAudience === "team",
    });
    setText("");
    setMessageAudience("user");
    setCannedPanelOpen(false);
  };

  const handleComposerKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void submitComposerPayload();
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

  const insertEmoji = (emoji) => {
    const el = textareaRef.current;
    if (!el) {
      setText((prev) => `${prev || ""}${emoji}`);
      setEmojiOpen(false);
      bumpTyping();
      return;
    }
    const start = el.selectionStart ?? String(text || "").length;
    const end = el.selectionEnd ?? start;
    const current = String(text || "");
    const next = `${current.slice(0, start)}${emoji}${current.slice(end)}`;
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + emoji.length;
      el.setSelectionRange(pos, pos);
    });
    setEmojiOpen(false);
    bumpTyping();
  };

  const handleSelectAttachment = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const previewable =
      file.type.startsWith("image/") || file.type.startsWith("audio/");
    const previewUrl = previewable ? URL.createObjectURL(file) : "";
    if (pendingAttachment?.previewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(pendingAttachment.previewUrl);
    }
    setPendingAttachment({
      file,
      previewUrl,
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size || 0,
    });
    e.target.value = "";
  };

  const handleComposerSubmit = async (e) => {
    e.preventDefault();
    await submitComposerPayload();
  };

  const openWaTemplates = async () => {
    if (!activeId) return;
    setWaTemplatesOpen(true);
    setWaTemplatesError("");
    setWaTemplatesLoading(true);
    try {
      const items = await listWhatsappTemplates(activeId);
      setWaTemplates(items);
      setWaSelectedTemplate(null);
      setWaTemplateParams([]);
    } catch (err) {
      setWaTemplatesError(err.message || "Failed to load templates");
    } finally {
      setWaTemplatesLoading(false);
    }
  };

  const sendTemplate = async (tpl) => {
    if (!activeId || !tpl?.name) return;
    const params = waTemplateParams.map((v) => String(v || ""));
    setWaTemplateSending(true);
    try {
      await sendWhatsappTemplate(activeId, {
        templateName: tpl.name,
        languageCode: tpl.language || "en_US",
        parameters: params,
      });
      setWaTemplatesOpen(false);
      setWaSelectedTemplate(null);
      setWaTemplateParams([]);
    } catch (err) {
      setWaTemplatesError(err.message || "Failed to send template");
    } finally {
      setWaTemplateSending(false);
    }
  };

  const canUseTemplates =
    activeSession?.channel === "whatsapp" && messageAudience === "user";
  const filteredWaTemplates = waTemplates.filter((tpl) => {
    const q = waTemplateQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      String(tpl?.name || "")
        .toLowerCase()
        .includes(q) ||
      String(tpl?.bodyPreview || "")
        .toLowerCase()
        .includes(q)
    );
  });

  const selectTemplateForParams = (tpl) => {
    const count = Number.parseInt(String(tpl?.paramCount ?? "0"), 10) || 0;
    setWaSelectedTemplate(tpl);
    setWaTemplateParams(Array.from({ length: Math.max(0, count) }, () => ""));
    setWaTemplatesError("");
  };

  const renderedWaPreview = (() => {
    if (!waSelectedTemplate) return "";
    const body = String(waSelectedTemplate.bodyPreview || "");
    if (!body) return "";
    return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
      const idx = Number.parseInt(raw, 10);
      if (!Number.isFinite(idx) || idx <= 0) return `{{${raw}}}`;
      const value = waTemplateParams[idx - 1];
      return String(value || `{{${raw}}}`);
    });
  })();

  return (
    <>
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
      inboxFilter={inboxFilter}
      setInboxFilter={setInboxFilter}
      inboxes={inboxes}
      agent={agent}
      updateAgentStatus={updateAgentStatus}
      channelCounts={channelCounts}
      filteredSessions={filteredSessions}
      activeId={activeId}
      setActiveId={setActiveId}
      formatTime={formatTime}
      sessionPreview={sessionPreview}
      onOpenSettings={onOpenSettings}
      mainPanel={
        <section className="crm-main grid h-full min-h-0 overflow-hidden grid-rows-[56px_minmax(0,1fr)_auto] bg-[#f8f9fb]">
          <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-fuchsia-100 text-[10px] font-semibold text-fuchsia-700">
                {sessionInitials(activeSession, sessionContact)}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {getSessionTitle(activeSession, sessionContact)}
                </p>
                <p className="text-[11px] text-slate-500">
                  {activeSession
                    ? `Status: ${String(activeSession.status || "open")}`
                    : "No conversation selected"}
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
                const attachmentWidget =
                  message?.widget?.type === "attachment" ? message.widget : null;
                const isWhatsappMessage =
                  activeSession?.channel === "whatsapp" ||
                  message?.widget?.type === "whatsapp_template";
                const renderedText = isWhatsappMessage
                  ? normalizeWhatsappMarkdown(message.text)
                  : String(message.text ?? "");
                const attachmentType = String(
                  attachmentWidget?.attachmentType || "",
                ).toLowerCase();
                const isAudioAttachment =
                  attachmentType === "audio" || attachmentType === "voice";
                const attachmentUrl = resolveMediaUrl(
                  attachmentWidget?.url || attachmentWidget?.mapUrl || "",
                );
                const showMessageText = !(
                  attachmentWidget &&
                  isAttachmentPlaceholderText(message.text)
                );
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
                    className={`flex items-end gap-1.5 ${gapTop} ${isAgent || isTeam ? "ml-auto flex-row-reverse" : ""} ${
                      isAudioAttachment ? "w-[min(76%,360px)]" : "w-fit max-w-[76%]"
                    }`}
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
                      className={`rounded-xl border text-sm shadow-sm ${
                        isAgent
                          ? "border-blue-600 bg-blue-600 text-white"
                          : isTeam
                            ? "border-amber-200 bg-amber-50 text-amber-900"
                            : "border-slate-200 bg-white text-slate-900"
                      } ${attachmentWidget && !showMessageText ? "px-1.5 py-1.5" : "px-3 py-2"}`}
                    >
                      {isTeam ? (
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide">
                          Internal note
                        </p>
                      ) : null}
                      {attachmentWidget ? (
                        <div>
                          {(attachmentType === "image" ||
                            attachmentType === "sticker") &&
                          attachmentUrl ? (
                            <button
                              type="button"
                              className="block"
                              onClick={() =>
                                setLightbox({
                                  url: attachmentUrl,
                                  alt:
                                    attachmentWidget?.filename ||
                                    attachmentWidget?.title ||
                                    "Image",
                                })
                              }
                            >
                              <img
                                src={attachmentUrl}
                                alt={
                                  attachmentWidget?.filename ||
                                  attachmentWidget?.title ||
                                  "Image"
                                }
                                className="max-h-80 w-full rounded-lg object-cover"
                                loading="lazy"
                              />
                            </button>
                          ) : null}
                          {(attachmentType === "audio" ||
                            attachmentType === "voice") &&
                          attachmentUrl ? (
                            <audio
                              controls
                              preload="metadata"
                              src={attachmentUrl}
                              className="block w-full min-w-[280px] max-w-[360px]"
                            />
                          ) : null}
                          {attachmentType === "video" && attachmentUrl ? (
                            <video
                              controls
                              preload="metadata"
                              src={attachmentUrl}
                              className="max-h-80 w-full rounded-lg bg-black"
                            />
                          ) : null}
                          {(attachmentType === "document" ||
                            attachmentType === "location") &&
                          attachmentUrl ? (
                            <a
                              href={attachmentUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="text-xs underline"
                            >
                              {attachmentWidget?.filename || "Open attachment"}
                            </a>
                          ) : null}
                        </div>
                      ) : (
                        <>
                          {showMessageText ? (
                            <div
                              className={`dashboard-md ${isAgent ? "dashboard-md-agent" : ""}`}
                            >
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {renderedText}
                              </ReactMarkdown>
                            </div>
                          ) : null}
                          {renderMessageWidget(message)}
                        </>
                      )}
                      {attachmentWidget && showMessageText ? (
                        <div
                          className={`mt-1.5 dashboard-md ${isAgent ? "dashboard-md-agent" : ""}`}
                        >
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {renderedText}
                          </ReactMarkdown>
                        </div>
                      ) : null}
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
            onSubmit={handleComposerSubmit}
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
              {pendingAttachment ? (
                <div className="mb-2 rounded-xl border border-slate-200 bg-white p-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-slate-800">
                        {pendingAttachment.name}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {pendingAttachment.type} •{" "}
                        {Math.max(1, Math.round(pendingAttachment.size / 1024))}{" "}
                        KB
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-slate-500"
                      onClick={clearPendingAttachment}
                    >
                      <X size={12} className="mr-1" />
                      Cancel
                    </Button>
                  </div>
                  {pendingAttachment.previewUrl &&
                  pendingAttachment.type.startsWith("image/") ? (
                    <img
                      src={pendingAttachment.previewUrl}
                      alt={pendingAttachment.name}
                      className="mt-2 max-h-48 rounded-lg border border-slate-200 object-contain"
                    />
                  ) : null}
                  {pendingAttachment.previewUrl &&
                  pendingAttachment.type.startsWith("audio/") ? (
                    <audio
                      controls
                      preload="metadata"
                      src={pendingAttachment.previewUrl}
                      className="mt-2 w-full"
                    />
                  ) : null}
                  <p className="mt-2 text-[11px] text-slate-500">
                    Add an optional message below, then press Send.
                  </p>
                </div>
              ) : null}
              <Textarea
                ref={textareaRef}
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
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={handleSelectAttachment}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 rounded-full p-0 text-slate-500 hover:text-slate-700"
                    disabled={!activeId}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip size={14} />
                  </Button>
                  <div className="relative" ref={emojiPanelRef}>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 rounded-full p-0 text-slate-500 hover:text-slate-700"
                      disabled={!activeId}
                      onClick={() => setEmojiOpen((v) => !v)}
                    >
                      <Smile size={14} />
                    </Button>
                    {emojiOpen && activeId ? (
                      <div className="absolute bottom-9 left-0 z-50 grid grid-cols-6 gap-1 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg">
                        {[
                          "😀",
                          "😁",
                          "😂",
                          "🙂",
                          "😉",
                          "😍",
                          "😘",
                          "😎",
                          "🤔",
                          "👍",
                          "🙏",
                          "🔥",
                        ].map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            className="rounded p-1 text-base hover:bg-slate-100"
                            onClick={() => insertEmoji(emoji)}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 rounded-full p-0 text-slate-500 hover:text-slate-700"
                    disabled={!activeId}
                    onClick={() => fileInputRef.current?.click()}
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
                  {canUseTemplates ? (
                    <div className="relative" ref={templatePanelRef}>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 rounded-lg px-2 text-[11px]"
                        onClick={() => {
                          if (waTemplatesOpen) {
                            setWaTemplatesOpen(false);
                          } else {
                            void openWaTemplates();
                          }
                        }}
                        disabled={!activeId || waTemplateSending}
                      >
                        WhatsApp Template
                      </Button>
                      {waTemplatesOpen ? (
                        <div className="absolute bottom-10 right-0 z-50 w-80 rounded-lg border border-slate-200 bg-white p-2 shadow-xl">
                          <Input
                            value={waTemplateQuery}
                            onChange={(e) => setWaTemplateQuery(e.target.value)}
                            placeholder="Search templates"
                            className="h-8 text-xs"
                          />
                          <div className="mt-2 max-h-64 space-y-1 overflow-y-auto pr-1">
                            {waTemplatesLoading ? (
                              <p className="text-xs text-slate-500">
                                Loading templates...
                              </p>
                            ) : null}
                            {waTemplatesError ? (
                              <p className="text-xs text-red-600">
                                {waTemplatesError}
                              </p>
                            ) : null}
                            {!waTemplatesLoading &&
                            filteredWaTemplates.length === 0 ? (
                              <p className="text-xs text-slate-500">
                                No templates found.
                              </p>
                            ) : null}
                            {filteredWaTemplates.map((tpl) => (
                              <button
                                key={`${tpl.name}-${tpl.language || "lang"}`}
                                type="button"
                                className="w-full rounded-md border border-slate-200 p-2 text-left hover:bg-slate-50"
                                onClick={() => selectTemplateForParams(tpl)}
                                disabled={waTemplateSending}
                              >
                                <p className="text-xs font-semibold text-slate-800">
                                  {tpl.name}
                                </p>
                                <p className="text-[10px] text-slate-500">
                                  {(tpl.language || "en_US").toUpperCase()} •{" "}
                                  {tpl.status || "UNKNOWN"}
                                </p>
                                {tpl.bodyPreview ? (
                                  <p className="mt-1 line-clamp-2 text-[11px] text-slate-600">
                                    {tpl.bodyPreview}
                                  </p>
                                ) : null}
                              </button>
                            ))}
                          </div>
                          {waSelectedTemplate ? (
                            <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                              <p className="text-xs font-semibold text-slate-800">
                                {waSelectedTemplate.name}
                              </p>
                              {waTemplateParams.length > 0 ? (
                                <div className="mt-2 space-y-1.5">
                                  {waTemplateParams.map((value, idx) => (
                                    <Input
                                      key={`${waSelectedTemplate.name}-param-${idx}`}
                                      value={value}
                                      onChange={(e) =>
                                        setWaTemplateParams((prev) =>
                                          prev.map((v, i) =>
                                            i === idx ? e.target.value : v,
                                          ),
                                        )
                                      }
                                      placeholder={`Parameter ${idx + 1}`}
                                      className="h-8 text-xs"
                                    />
                                  ))}
                                </div>
                              ) : (
                                <p className="mt-1 text-[11px] text-slate-500">
                                  No parameters required.
                                </p>
                              )}
                              {renderedWaPreview ? (
                                <p className="mt-2 rounded border border-slate-200 bg-white p-1.5 text-[11px] text-slate-700">
                                  {renderedWaPreview}
                                </p>
                              ) : null}
                              <div className="mt-2 flex items-center justify-end gap-1.5">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 text-[11px]"
                                  onClick={() => {
                                    setWaSelectedTemplate(null);
                                    setWaTemplateParams([]);
                                  }}
                                  disabled={waTemplateSending}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  className="h-7 px-2 text-[11px]"
                                  onClick={() => void sendTemplate(waSelectedTemplate)}
                                  disabled={waTemplateSending}
                                >
                                  {waTemplateSending ? "Sending..." : "Send Template"}
                                </Button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
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
                      (!text.trim() && !pendingAttachment) ||
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
                {sessionInitials(activeSession, sessionContact)}
              </div>
              <p className="text-sm font-semibold text-slate-900">
                {getSessionTitle(activeSession, sessionContact)}
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
              {/* ── Quick routing ─────────────────────────── */}
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Quick Routing
                </p>
                <div className="space-y-2">
                  <div>
                    <label className="mb-1 block text-[10px] uppercase tracking-wide text-slate-400">
                      Inbox
                    </label>
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
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-[10px] uppercase tracking-wide text-slate-400">
                        Status
                      </label>
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
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] uppercase tracking-wide text-slate-400">
                        Priority
                      </label>
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
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-[10px] uppercase tracking-wide text-slate-400">
                        Assignee
                      </label>
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
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] uppercase tracking-wide text-slate-400">
                        Team
                      </label>
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
                  </div>
                </div>
              </div>

              <Separator />

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
      {lightbox?.url ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-5"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded-md bg-black/55 p-2 text-white hover:bg-black/70"
            onClick={() => setLightbox(null)}
          >
            <X size={18} />
          </button>
          <img
            src={lightbox.url}
            alt={lightbox.alt || "Image"}
            className="max-h-[92vh] max-w-[92vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </>
  );
}
