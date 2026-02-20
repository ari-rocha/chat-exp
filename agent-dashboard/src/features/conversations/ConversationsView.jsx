import WorkspaceLayout, { sessionInitials } from "@/app/WorkspaceLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  AtSign,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  CircleDashed,
  ClipboardList,
  Clock3,
  Mail,
  MapPin,
  MessageCircle,
  MoreVertical,
  Paperclip,
  Phone,
  Plus,
  Send,
  Smile,
  Tag,
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
  const value = String(text || "")
    .trim()
    .toLowerCase();
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

function AvatarOption({ label, avatarUrl, fallback = "?" }) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={label}
        className="h-5 w-5 rounded-full object-cover"
      />
    );
  }
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[10px] font-semibold text-slate-600">
      {fallback}
    </span>
  );
}

function RichCombobox({
  value,
  options,
  onSelect,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  disabled = false,
  renderOptionIcon,
}) {
  const [open, setOpen] = useStateReact(false);
  const [query, setQuery] = useStateReact("");
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  const selected = options.find((option) => option.value === value) || null;
  const filtered = options.filter((option) =>
    String(option.label || "")
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onDocClick = (event) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className="flex w-full items-center justify-between rounded-md border border-slate-200 bg-white px-2 py-1.5 text-left text-xs text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
        onClick={() => !disabled && setOpen((prev) => !prev)}
        disabled={disabled}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {selected && renderOptionIcon ? renderOptionIcon(selected) : null}
          <span className="truncate">
            {selected ? selected.label : placeholder}
          </span>
        </span>
        <ChevronsUpDown size={13} className="shrink-0 text-slate-400" />
      </button>

      {open ? (
        <div className="absolute z-20 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 p-1.5">
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-7 border-slate-200 text-xs"
            />
          </div>
          <div className="max-h-52 overflow-y-auto py-1">
            {filtered.map((option) => (
              <button
                key={option.value}
                type="button"
                className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  onSelect(option.value);
                  setOpen(false);
                }}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  {renderOptionIcon ? renderOptionIcon(option) : null}
                  <span className="truncate">{option.label}</span>
                </span>
                {value === option.value ? (
                  <Check size={12} className="shrink-0 text-slate-500" />
                ) : null}
              </button>
            ))}
            {filtered.length === 0 ? (
              <p className="px-2 py-2 text-xs text-slate-400">No results</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
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
  inboxScope,
  setInboxScope,
  inboxCounts,
  teamScope,
  setTeamScope,
  teamCounts,
  channelScope,
  setChannelScope,
  channelFilters,
  tagScope,
  setTagScope,
  tagFilters,
  agent,
  updateAgentStatus,
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
  channels,
  patchActiveSession,
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
  previousConversations,
  addSessionTag,
  removeSessionTag,
  patchSessionContact,
  tenantSettings,
  onOpenSettings,
  unreadNotificationsCount = 0,
  whatsappSendFailuresByMessage = {},
  listWhatsappTemplates,
  sendWhatsappTemplate,
  getWhatsappBlockStatus,
  blockWhatsappContact,
  unblockWhatsappContact,
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
  const [statusMenuOpen, setStatusMenuOpen] = useStateReact(false);
  const [snoozeMenuOpen, setSnoozeMenuOpen] = useStateReact(false);
  const [customSnoozeOpen, setCustomSnoozeOpen] = useStateReact(false);
  const [customSnoozeAt, setCustomSnoozeAt] = useStateReact("");
  const [snoozeMenuPos, setSnoozeMenuPos] = useStateReact({ top: 0, left: 0 });
  const [moreMenuOpen, setMoreMenuOpen] = useStateReact(false);
  const [waBlocked, setWaBlocked] = useStateReact(false);
  const [waBlockLoading, setWaBlockLoading] = useStateReact(false);
  const [mentionOpen, setMentionOpen] = useStateReact(false);
  const [mentionQuery, setMentionQuery] = useStateReact("");
  const [mentionStart, setMentionStart] = useStateReact(-1);
  const [sidebarPanels, setSidebarPanels] = useStateReact({
    actions: true,
    conversationInfo: false,
    contactAttrs: false,
    previousConversations: false,
    conversationNotes: false,
    participants: false,
  });
  const fileInputRef = useRef(null);
  const emojiPanelRef = useRef(null);
  const mentionPanelRef = useRef(null);
  const textareaRef = useRef(null);
  const statusMenuRef = useRef(null);
  const snoozeMenuRef = useRef(null);
  const snoozeMenuPanelRef = useRef(null);
  const moreMenuRef = useRef(null);

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
        statusMenuRef.current &&
        !statusMenuRef.current.contains(event.target)
      ) {
        setStatusMenuOpen(false);
        setSnoozeMenuOpen(false);
        setCustomSnoozeOpen(false);
      }
      if (
        snoozeMenuRef.current &&
        !snoozeMenuRef.current.contains(event.target) &&
        !(snoozeMenuPanelRef.current &&
          snoozeMenuPanelRef.current.contains(event.target))
      ) {
        setSnoozeMenuOpen(false);
        setCustomSnoozeOpen(false);
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target)) {
        setMoreMenuOpen(false);
      }
      if (
        mentionPanelRef.current &&
        !mentionPanelRef.current.contains(event.target)
      ) {
        setMentionOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocPointer);
    return () => document.removeEventListener("mousedown", onDocPointer);
  }, []);

  const botAssigneeId = "__bot__";
  const botName = String(tenantSettings?.botName || "").trim() || "Bot";
  const botAvatarUrl = String(tenantSettings?.botAvatarUrl || "").trim();
  const isBotAssigned =
    Boolean(activeSession) &&
    (activeSession?.assigneeAgentId === botAssigneeId ||
      ((!activeSession?.assigneeAgentId ||
        !String(activeSession.assigneeAgentId).trim()) &&
        !Boolean(activeSession?.handoverActive)));
  const isUserReplyBlockedByBot = isBotAssigned && messageAudience === "user";
  const assigneeAgent = agents.find(
    (item) => item.id === activeSession?.assigneeAgentId,
  );
  const assigneeName =
    activeSession?.assigneeAgentId === botAssigneeId ||
    (!activeSession?.assigneeAgentId && !activeSession?.handoverActive)
      ? botName
      : assigneeAgent?.name || "Unassigned";
  const assigneeAvatarUrl =
    assigneeName === botName ? botAvatarUrl : assigneeAgent?.avatarUrl || "";
  const assigneeOptions = [
    {
      value: botAssigneeId,
      label: botName,
      avatarUrl: botAvatarUrl,
      fallback: "B",
    },
    ...agents.map((item) => ({
      value: item.id,
      label: item.name,
      avatarUrl: item.avatarUrl || "",
      fallback: String(item.name || "A")
        .slice(0, 1)
        .toUpperCase(),
    })),
  ];
  const teamOptions = [
    { value: "", label: "None", fallback: "-" },
    ...teams.map((team) => ({
      value: team.id,
      label: team.name,
      fallback: String(team.name || "T")
        .slice(0, 1)
        .toUpperCase(),
    })),
  ];
  const statusOptions = [
    { value: "open", label: "Open" },
    { value: "awaiting", label: "Pending" },
    { value: "snoozed", label: "Snoozed" },
    { value: "resolved", label: "Resolved" },
  ];
  const priorityOptions = [
    { value: "low", label: "Low" },
    { value: "normal", label: "Normal" },
    { value: "high", label: "High" },
    { value: "urgent", label: "Urgent" },
  ];
  const addableTagOptions = (tags || [])
    .filter((t) => !(sessionTags || []).find((st) => st.id === t.id))
    .map((t) => ({
      value: t.id,
      label: t.name,
      color: t.color || "#94a3b8",
    }));
  const activeStatus = String(activeSession?.status || "open").toLowerCase();
  const quickAction =
    activeStatus === "closed" || activeStatus === "resolved"
      ? { value: "open", label: "Reopen" }
      : activeStatus === "snoozed"
        ? { value: "open", label: "Unsnooze" }
        : { value: "resolved", label: "Resolve" };
  const isWhatsappConversation = activeSession?.channel === "whatsapp";
  const mentionHandleForAgent = (item) => {
    const email = String(item?.email || "")
      .trim()
      .toLowerCase();
    const emailLocal = email.includes("@") ? email.split("@")[0] : "";
    const candidate = emailLocal || String(item?.name || "").toLowerCase();
    const normalized = candidate.replace(/[^a-z0-9._-]/g, "");
    return normalized || "agent";
  };
  const mentionSuggestions = (agents || [])
    .map((item) => ({
      ...item,
      mentionHandle: mentionHandleForAgent(item),
    }))
    .filter((item) => {
      if (!mentionQuery.trim()) return true;
      const q = mentionQuery.trim().toLowerCase();
      return (
        String(item.name || "")
          .toLowerCase()
          .includes(q) ||
        String(item.email || "")
          .toLowerCase()
          .includes(q) ||
        String(item.mentionHandle || "")
          .toLowerCase()
          .includes(q)
      );
    })
    .slice(0, 6);

  const canSendNow =
    Boolean(activeId) &&
    !(isActiveSessionClosed && messageAudience === "user") &&
    !isUserReplyBlockedByBot &&
    (Boolean(pendingAttachment) || Boolean(text.trim()));

  const toLocalInputDateTime = (date) => {
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
      date.getDate(),
    )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  const applySnooze = async ({ mode, until }) => {
    if (!activeId) return;
    const payload = {
      status: "snoozed",
      snoozeMode: mode,
      snoozedUntil: until || "",
    };
    await patchSessionMeta(payload);
    setStatusMenuOpen(false);
    setSnoozeMenuOpen(false);
    setCustomSnoozeOpen(false);
  };

  const handleSnoozePreset = async (preset) => {
    const now = new Date();
    if (preset === "until_reply") {
      await applySnooze({ mode: "until_reply", until: "" });
      return;
    }
    if (preset === "in_1h") {
      const target = new Date(now.getTime() + 60 * 60 * 1000);
      await applySnooze({ mode: "until_time", until: target.toISOString() });
      return;
    }
    if (preset === "tomorrow") {
      const target = new Date(now);
      target.setDate(target.getDate() + 1);
      target.setHours(9, 0, 0, 0);
      await applySnooze({ mode: "until_time", until: target.toISOString() });
      return;
    }
    if (preset === "next_week") {
      const target = new Date(now);
      target.setDate(target.getDate() + 7);
      target.setHours(9, 0, 0, 0);
      await applySnooze({ mode: "until_time", until: target.toISOString() });
      return;
    }
    if (preset === "next_month") {
      const target = new Date(now);
      target.setMonth(target.getMonth() + 1);
      target.setHours(9, 0, 0, 0);
      await applySnooze({ mode: "until_time", until: target.toISOString() });
      return;
    }
    if (preset === "custom") {
      const defaultTarget = new Date(now.getTime() + 60 * 60 * 1000);
      setCustomSnoozeAt(toLocalInputDateTime(defaultTarget));
      setCustomSnoozeOpen(true);
    }
  };

  const handleApplyCustomSnooze = async () => {
    if (!customSnoozeAt) return;
    const target = new Date(customSnoozeAt);
    if (Number.isNaN(target.getTime())) return;
    await applySnooze({ mode: "until_time", until: target.toISOString() });
  };

  const updateSnoozeMenuPosition = () => {
    if (typeof window === "undefined") return;
    const anchor = snoozeMenuRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const menuWidth = 224; // w-56
    const menuHeightEstimate = customSnoozeOpen ? 380 : 300;
    const gap = 8;
    let left = rect.right + gap;
    if (window.innerWidth <= 1024) {
      left = Math.min(
        Math.max(gap, rect.right - menuWidth),
        window.innerWidth - menuWidth - gap,
      );
    } else if (left + menuWidth > window.innerWidth - gap) {
      left = Math.max(gap, rect.left - menuWidth - gap);
    }
    let top = rect.top;
    if (top + menuHeightEstimate > window.innerHeight - gap) {
      top = Math.max(gap, window.innerHeight - menuHeightEstimate - gap);
    }
    setSnoozeMenuPos({ top, left });
  };

  useEffect(() => {
    if (!snoozeMenuOpen) return;
    updateSnoozeMenuPosition();
    const onViewportChange = () => updateSnoozeMenuPosition();
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [snoozeMenuOpen, customSnoozeOpen]);

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
    setMentionOpen(false);
    setMentionQuery("");
    setMentionStart(-1);
    setMessageAudience("user");
    setCannedPanelOpen(false);
  };

  const handleComposerKeyDown = (e) => {
    if (mentionOpen && e.key === "Escape") {
      setMentionOpen(false);
      return;
    }
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

  useEffect(() => {
    let cancelled = false;
    if (!activeId || !isWhatsappConversation || !getWhatsappBlockStatus) {
      setWaBlocked(false);
      return;
    }
    setWaBlockLoading(true);
    getWhatsappBlockStatus(activeId)
      .then((payload) => {
        if (cancelled) return;
        setWaBlocked(Boolean(payload?.blocked));
      })
      .catch(() => {
        if (cancelled) return;
        setWaBlocked(false);
      })
      .finally(() => {
        if (cancelled) return;
        setWaBlockLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId, isWhatsappConversation, getWhatsappBlockStatus]);

  const handleToggleWhatsappBlock = async () => {
    if (!activeId || !isWhatsappConversation || waBlockLoading) return;
    setWaBlockLoading(true);
    try {
      if (waBlocked) {
        const payload = await unblockWhatsappContact?.(activeId);
        if (typeof payload?.blocked === "boolean") {
          setWaBlocked(Boolean(payload.blocked));
        } else {
          const status = await getWhatsappBlockStatus?.(activeId);
          setWaBlocked(Boolean(status?.blocked));
        }
      } else {
        const payload = await blockWhatsappContact?.(activeId);
        if (typeof payload?.blocked === "boolean") {
          setWaBlocked(Boolean(payload.blocked));
        } else {
          const status = await getWhatsappBlockStatus?.(activeId);
          setWaBlocked(Boolean(status?.blocked));
        }
      }
      setMoreMenuOpen(false);
    } catch (error) {
      console.error("failed to update whatsapp block status", error);
    } finally {
      setWaBlockLoading(false);
    }
  };

  const updateMentionContext = (nextText, cursorIndex, audience) => {
    if (audience !== "team") {
      setMentionOpen(false);
      setMentionQuery("");
      setMentionStart(-1);
      return;
    }
    const cursor = Number.isFinite(cursorIndex) ? cursorIndex : nextText.length;
    const before = String(nextText || "").slice(0, cursor);
    const match = before.match(/(^|\s)@([a-zA-Z0-9._-]*)$/);
    if (!match) {
      setMentionOpen(false);
      setMentionQuery("");
      setMentionStart(-1);
      return;
    }
    const atIndex = before.lastIndexOf("@");
    if (atIndex < 0) {
      setMentionOpen(false);
      return;
    }
    setMentionQuery(match[2] || "");
    setMentionStart(atIndex);
    setMentionOpen(true);
  };

  const insertMention = (item) => {
    const handle = mentionHandleForAgent(item);
    if (!handle) return;
    const el = textareaRef.current;
    const cursor = el?.selectionStart ?? text.length;
    const start = mentionStart >= 0 ? mentionStart : cursor;
    const nextText = `${text.slice(0, start)}@${handle} ${text.slice(cursor)}`;
    const nextCursor = start + handle.length + 2;
    setText(nextText);
    setMentionOpen(false);
    setMentionQuery("");
    setMentionStart(-1);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextCursor, nextCursor);
    });
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
  const hasMissingTemplateParams =
    waTemplateParams.length > 0 &&
    waTemplateParams.some((value) => !String(value || "").trim());

  const toggleSidebarPanel = (key) =>
    setSidebarPanels((prev) => ({ ...prev, [key]: !prev[key] }));

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
        inboxScope={inboxScope}
        setInboxScope={setInboxScope}
        inboxCounts={inboxCounts}
        teamScope={teamScope}
        setTeamScope={setTeamScope}
        teamCounts={teamCounts}
        channelScope={channelScope}
        setChannelScope={setChannelScope}
        channelFilters={channelFilters}
        tagScope={tagScope}
        setTagScope={setTagScope}
        tagFilters={tagFilters}
        teams={teams}
        agent={agent}
        updateAgentStatus={updateAgentStatus}
        filteredSessions={filteredSessions}
        activeId={activeId}
        setActiveId={setActiveId}
        formatTime={formatTime}
        sessionPreview={sessionPreview}
        onOpenSettings={onOpenSettings}
        unreadNotificationsCount={unreadNotificationsCount}
        mainPanel={
          <section className="crm-main grid h-full min-h-0 overflow-hidden grid-rows-[56px_minmax(0,1fr)_auto] bg-[#f8f9fb]">
            <header className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveId("")}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 min-[1025px]:hidden"
                  aria-label="Back to conversation list"
                >
                  <ArrowLeft size={14} />
                </button>
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-fuchsia-100 text-[10px] font-semibold text-fuchsia-700">
                  {sessionInitials(activeSession, sessionContact)}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {getSessionTitle(activeSession, sessionContact)}
                    </p>
                    {activeSession ? (
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium capitalize text-slate-600">
                        {String(activeSession.status || "open")}
                      </span>
                    ) : null}
                  </div>
                  <p className="truncate text-[11px] text-slate-500 capitalize">
                    {String(activeSession?.channel || "conversation")}
                  </p>
                </div>
              </div>

              {activeId ? (
                <div className="flex items-center gap-1.5">
                  <div className="relative" ref={statusMenuRef}>
                    <div className="inline-flex items-center overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
                      <button
                        type="button"
                        className="inline-flex h-8 items-center px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        onClick={() =>
                          patchSessionMeta({ status: quickAction.value })
                        }
                      >
                        {quickAction.label}
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-8 w-8 items-center justify-center border-l border-slate-200 text-slate-500 hover:bg-slate-50"
                        onClick={() => {
                          setStatusMenuOpen((prev) => !prev);
                          setSnoozeMenuOpen(false);
                          setCustomSnoozeOpen(false);
                          setMoreMenuOpen(false);
                        }}
                        aria-label="More status actions"
                      >
                        <ChevronDown size={13} />
                      </button>
                    </div>
                    {statusMenuOpen ? (
                      <div className="absolute right-0 z-40 mt-1 w-52 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
                        <div className="relative" ref={snoozeMenuRef}>
                          <button
                            type="button"
                            className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                            onClick={() => {
                              setCustomSnoozeOpen(false);
                              setSnoozeMenuOpen((prev) => {
                                const next = !prev;
                                if (next) {
                                  requestAnimationFrame(() =>
                                    updateSnoozeMenuPosition(),
                                  );
                                }
                                return next;
                              });
                            }}
                          >
                            <span className="inline-flex items-center gap-2">
                              <Clock3 size={13} className="text-slate-500" />
                              Snooze
                            </span>
                            <ChevronRight size={13} />
                          </button>
                        </div>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                          onClick={() => {
                            patchSessionMeta({ status: "awaiting" });
                            setStatusMenuOpen(false);
                            setSnoozeMenuOpen(false);
                            setCustomSnoozeOpen(false);
                          }}
                        >
                          <CircleDashed size={13} className="text-slate-500" />
                          Mark as pending
                        </button>
                      </div>
                    ) : null}
                    {snoozeMenuOpen ? (
                      <div
                        ref={snoozeMenuPanelRef}
                        className="fixed z-[140] w-56 rounded-md border border-slate-200 bg-white p-1 shadow-xl"
                        style={{
                          top: `${snoozeMenuPos.top}px`,
                          left: `${snoozeMenuPos.left}px`,
                        }}
                      >
                        <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-slate-400">
                          Snooze until
                        </p>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                          onClick={() => void handleSnoozePreset("until_reply")}
                        >
                          <Clock3 size={13} />
                          Until next reply
                        </button>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                          onClick={() => void handleSnoozePreset("in_1h")}
                        >
                          <Clock3 size={13} />
                          In one hour
                        </button>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                          onClick={() => void handleSnoozePreset("tomorrow")}
                        >
                          <Clock3 size={13} />
                          Until tomorrow
                        </button>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                          onClick={() => void handleSnoozePreset("next_week")}
                        >
                          <Clock3 size={13} />
                          Until next week
                        </button>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                          onClick={() => void handleSnoozePreset("next_month")}
                        >
                          <Clock3 size={13} />
                          Until next month
                        </button>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                          onClick={() => void handleSnoozePreset("custom")}
                        >
                          <Clock3 size={13} />
                          Custom...
                        </button>
                        {customSnoozeOpen ? (
                          <div className="mt-1 rounded-md border border-slate-200 bg-slate-50 p-2">
                            <label className="mb-1 block text-[10px] uppercase tracking-wide text-slate-500">
                              Date and time
                            </label>
                            <Input
                              type="datetime-local"
                              value={customSnoozeAt}
                              onChange={(e) => setCustomSnoozeAt(e.target.value)}
                              className="h-8 text-xs"
                            />
                            <div className="mt-2 flex justify-end gap-1.5">
                              <button
                                type="button"
                                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700"
                                onClick={() => setCustomSnoozeOpen(false)}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className="rounded-md bg-slate-900 px-2 py-1 text-[11px] text-white"
                                onClick={() => void handleApplyCustomSnooze()}
                              >
                                Apply
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="relative" ref={moreMenuRef}>
                    <button
                      type="button"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      onClick={() => {
                        const nextOpen = !moreMenuOpen;
                        setMoreMenuOpen(nextOpen);
                        setStatusMenuOpen(false);
                        setSnoozeMenuOpen(false);
                        setCustomSnoozeOpen(false);
                        if (
                          nextOpen &&
                          isWhatsappConversation &&
                          activeId &&
                          getWhatsappBlockStatus
                        ) {
                          setWaBlockLoading(true);
                          getWhatsappBlockStatus(activeId)
                            .then((payload) => {
                              setWaBlocked(Boolean(payload?.blocked));
                            })
                            .catch(() => {})
                            .finally(() => setWaBlockLoading(false));
                        }
                      }}
                      aria-label="More conversation options"
                    >
                      <MoreVertical size={14} />
                    </button>
                    {moreMenuOpen ? (
                      <div className="absolute right-0 z-40 mt-1 w-56 rounded-md border border-slate-200 bg-white p-1 shadow-lg">
                        <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-slate-400">
                          More options
                        </p>
                        {isWhatsappConversation ? (
                          <button
                            type="button"
                            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
                              waBlocked
                                ? "text-slate-700 hover:bg-slate-50"
                                : "text-red-600 hover:bg-red-50"
                            } ${waBlockLoading ? "cursor-not-allowed opacity-60" : ""}`}
                            onClick={() => void handleToggleWhatsappBlock()}
                            disabled={waBlockLoading}
                          >
                            {waBlockLoading
                              ? "Updating..."
                              : waBlocked
                                ? "Unblock contact"
                                : "Block contact"}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="flex w-full cursor-not-allowed items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-400"
                          disabled
                          title="Coming soon"
                        >
                          Send transcript by email (soon)
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </header>
            <ScrollArea className="conversation-thread h-full min-h-0 px-5 py-4">
              <div className="flex flex-col">
                {messages.map((message, index) => {
                  if (message.sender === "system") {
                    return (
                      <div
                        key={message.id}
                        className="flex justify-center my-3"
                      >
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
                  const whatsappFailureText =
                    activeSession?.channel === "whatsapp" && isAgent
                      ? String(
                          whatsappSendFailuresByMessage?.[message.id] || "",
                        )
                      : "";
                  const isWhatsappFailed = Boolean(whatsappFailureText);
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
                    message?.widget?.type === "attachment"
                      ? message.widget
                      : null;
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
                        isAudioAttachment
                          ? "w-[min(76%,360px)]"
                          : "w-fit max-w-[76%]"
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
                          isWhatsappFailed
                            ? "border-red-300 bg-red-50 text-red-800"
                            : isAgent
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
                                {attachmentWidget?.filename ||
                                  "Open attachment"}
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
                          className={`mt-1 block text-right text-[10px] ${
                            isWhatsappFailed
                              ? "text-red-500"
                              : isAgent
                                ? "text-blue-100"
                                : "text-slate-400"
                          }`}
                        >
                          {formatTime(message.createdAt)}
                        </time>
                        {isWhatsappFailed ? (
                          <p className="mt-1 text-[10px] font-medium text-red-600">
                            Failed to deliver on WhatsApp
                          </p>
                        ) : null}
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
                      Filtering canned replies by:{" "}
                      <strong>/{slashQuery}</strong>
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
                <div className="mb-2 flex items-center justify-start">
                  <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5">
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
                {pendingAttachment ? (
                  <div className="mb-2 rounded-xl border border-slate-200 bg-white p-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-slate-800">
                          {pendingAttachment.name}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {pendingAttachment.type} •{" "}
                          {Math.max(
                            1,
                            Math.round(pendingAttachment.size / 1024),
                          )}{" "}
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
                <div className="relative">
                  {mentionOpen && mentionSuggestions.length > 0 ? (
                    <div
                      ref={mentionPanelRef}
                      className="absolute bottom-full left-0 right-0 z-40 mb-1 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
                    >
                      {mentionSuggestions.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-50"
                          onClick={() => insertMention(item)}
                        >
                          {item.avatarUrl ? (
                            <img
                              src={item.avatarUrl}
                              alt={item.name}
                              className="h-5 w-5 rounded-full object-cover"
                            />
                          ) : (
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[10px] font-semibold text-slate-600">
                              {String(item.name || "A")
                                .slice(0, 1)
                                .toUpperCase()}
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium text-slate-800">
                              {item.name}
                            </span>
                            <span className="block truncate text-[11px] text-slate-500">
                              @{item.mentionHandle}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <Textarea
                    ref={textareaRef}
                    placeholder={
                      activeId
                        ? isActiveSessionClosed && messageAudience === "user"
                          ? "This conversation is resolved. Reopen to send a user message."
                          : isUserReplyBlockedByBot
                            ? `${botName} is assigned. Change assignee to reply as an agent.`
                            : "Type your message"
                        : "Select a conversation"
                    }
                    value={text}
                    onChange={(e) => {
                      const nextValue = e.target.value;
                      setText(nextValue);
                      updateMentionContext(
                        nextValue,
                        e.target.selectionStart,
                        messageAudience,
                      );
                      bumpTyping();
                    }}
                    onClick={(e) =>
                      updateMentionContext(
                        text,
                        e.currentTarget.selectionStart,
                        messageAudience,
                      )
                    }
                    onKeyUp={(e) =>
                      updateMentionContext(
                        text,
                        e.currentTarget.selectionStart,
                        messageAudience,
                      )
                    }
                    onBlur={() => sendTypingState(false)}
                    onKeyDown={handleComposerKeyDown}
                    disabled={
                      !activeId ||
                      (isActiveSessionClosed && messageAudience === "user") ||
                      isUserReplyBlockedByBot
                    }
                    rows={2}
                    className="min-h-20 resize-none border-0 bg-transparent px-1 py-1.5 text-[13px] shadow-none focus-visible:ring-0"
                  />
                </div>

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
                      disabled={
                        !activeId ||
                        (isActiveSessionClosed && messageAudience === "user") ||
                        isUserReplyBlockedByBot
                      }
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
                        disabled={
                          !activeId ||
                          (isActiveSessionClosed &&
                            messageAudience === "user") ||
                          isUserReplyBlockedByBot
                        }
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
                  </div>

                  <div className="flex items-center gap-1.5">
                    {canUseTemplates ? (
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
                        <ClipboardList size={13} className="mr-1" />
                        WhatsApp Template
                      </Button>
                    ) : null}
                    <Button
                      type="submit"
                      disabled={
                        !activeId ||
                        (!text.trim() && !pendingAttachment) ||
                        (isActiveSessionClosed && messageAudience === "user") ||
                        isUserReplyBlockedByBot
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
          <aside className="crm-details flex h-full min-h-0 flex-col border-l border-slate-200 bg-white text-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <p className="text-sm font-semibold">Contact</p>
              <span className="text-[10px] text-slate-500">
                {activeSession?.id ? activeSession.id.slice(0, 8) : ""}
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <div className="space-y-2.5">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-start gap-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fuchsia-100 text-xs font-semibold text-fuchsia-700">
                      {sessionInitials(activeSession, sessionContact)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {getSessionTitle(activeSession, sessionContact)}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                        <Mail size={11} className="text-slate-400" />
                        <span className="truncate">
                          {sessionContact?.email || "Unavailable"}
                        </span>
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                        <Phone size={11} className="text-slate-400" />
                        <span className="truncate">
                          {sessionContact?.phone ||
                            activeSession?.phone ||
                            "Unavailable"}
                        </span>
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                        <Building2 size={11} className="text-slate-400" />
                        <span className="truncate">
                          {sessionContact?.company || "Unavailable"}
                        </span>
                      </p>
                    </div>
                  </div>
                </div>

                <section className="rounded-lg border border-slate-200 bg-white">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2.5 text-left"
                    onClick={() => toggleSidebarPanel("actions")}
                  >
                    <span className="text-xs font-semibold text-slate-900">
                      Conversation Actions
                    </span>
                    {sidebarPanels.actions ? (
                      <ChevronDown size={14} className="text-slate-400" />
                    ) : (
                      <ChevronRight size={14} className="text-slate-400" />
                    )}
                  </button>
                  {sidebarPanels.actions ? (
                    <div className="space-y-2 border-t border-slate-200 px-3 pb-3 pt-2">
                      <div>
                        <label className="mb-1 block text-[10px] uppercase tracking-wide text-slate-500">
                          Assignee
                        </label>
                        <RichCombobox
                          value={
                            activeSession?.assigneeAgentId || botAssigneeId
                          }
                          options={assigneeOptions}
                          onSelect={(agentId) =>
                            patchActiveSession("assignee", { agentId })
                          }
                          placeholder="Select assignee..."
                          searchPlaceholder="Search assignee..."
                          disabled={!activeId}
                          renderOptionIcon={(option) => (
                            <AvatarOption
                              label={option.label}
                              avatarUrl={option.avatarUrl}
                              fallback={option.fallback}
                            />
                          )}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[10px] uppercase tracking-wide text-slate-500">
                          Team
                        </label>
                        <RichCombobox
                          value={activeSession?.teamId || ""}
                          options={teamOptions}
                          onSelect={(teamId) =>
                            patchActiveSession("team", {
                              teamId: teamId || null,
                            })
                          }
                          placeholder="Select team..."
                          searchPlaceholder="Search team..."
                          disabled={!activeId}
                          renderOptionIcon={(option) => (
                            <AvatarOption
                              label={option.label}
                              fallback={option.fallback}
                            />
                          )}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="mb-1 block text-[10px] uppercase tracking-wide text-slate-500">
                            Status
                          </label>
                          <RichCombobox
                            value={activeSession?.status || "open"}
                            options={statusOptions}
                            onSelect={(status) => patchSessionMeta({ status })}
                            placeholder="Select status..."
                            searchPlaceholder="Search status..."
                            disabled={!activeId}
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] uppercase tracking-wide text-slate-500">
                            Priority
                          </label>
                          <RichCombobox
                            value={activeSession?.priority || "normal"}
                            options={priorityOptions}
                            onSelect={(priority) =>
                              patchSessionMeta({ priority })
                            }
                            placeholder="Select priority..."
                            searchPlaceholder="Search priority..."
                            disabled={!activeId}
                          />
                        </div>
                      </div>
                      <div>
                        <p className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">
                          Conversation Tags
                        </p>
                        <div className="mb-1.5 flex flex-wrap gap-1">
                          {(sessionTags || []).map((tag) => (
                            <Badge
                              key={tag.id}
                              variant="outline"
                              className="gap-1 text-[10px]"
                              style={{
                                borderColor: tag.color || "#cbd5e1",
                                color: tag.color || "#334155",
                                backgroundColor: `${tag.color || "#cbd5e1"}15`,
                              }}
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
                        <RichCombobox
                          value=""
                          options={addableTagOptions}
                          onSelect={(tagId) => tagId && addSessionTag(tagId)}
                          placeholder="+ Add tag"
                          searchPlaceholder="Search tags..."
                          disabled={!activeId}
                          renderOptionIcon={(option) => (
                            <span
                              className="inline-block h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: option.color }}
                            />
                          )}
                        />
                      </div>
                    </div>
                  ) : null}
                </section>

                {[
                  ["conversationInfo", "Conversation Information"],
                  ["contactAttrs", "Contact Attributes"],
                  ["previousConversations", "Previous Conversations"],
                  ["conversationNotes", "Conversation Notes"],
                  ["participants", "Conversation Participants"],
                ].map(([key, title]) => (
                  <section
                    key={key}
                    className="rounded-lg border border-slate-200 bg-white"
                  >
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-3 py-2.5 text-left"
                      onClick={() => toggleSidebarPanel(key)}
                    >
                      <span className="text-xs font-semibold text-slate-900">
                        {title}
                      </span>
                      {sidebarPanels[key] ? (
                        <ChevronDown size={14} className="text-slate-400" />
                      ) : (
                        <Plus size={14} className="text-slate-400" />
                      )}
                    </button>
                    {sidebarPanels[key] ? (
                      <div className="border-t border-slate-200 px-3 pb-3 pt-2">
                        {key === "conversationInfo" ? (
                          <div className="space-y-2 text-xs text-slate-700">
                            <div className="flex items-start gap-2">
                              <MessageCircle
                                size={12}
                                className="mt-0.5 text-slate-500"
                              />
                              <span>
                                {(
                                  activeSession?.channel || "web"
                                ).toUpperCase()}
                              </span>
                            </div>
                            <div className="flex items-start gap-2">
                              <AtSign
                                size={12}
                                className="mt-0.5 text-slate-500"
                              />
                              <span className="break-all">
                                {activeSession?.id || "-"}
                              </span>
                            </div>
                            <div className="flex items-start gap-2">
                              <Phone
                                size={12}
                                className="mt-0.5 text-slate-500"
                              />
                              <span>
                                {activeSession?.phone ||
                                  sessionContact?.phone ||
                                  "-"}
                              </span>
                            </div>
                          </div>
                        ) : null}
                        {key === "contactAttrs" ? (
                          <div className="space-y-2">
                            {sessionContact ? (
                              <>
                                <div className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-2 py-1.5">
                                  <p className="truncate text-xs text-slate-700">
                                    {sessionContact.displayName || "Unnamed"}
                                  </p>
                                  <button
                                    className="text-slate-400 hover:text-red-500"
                                    onClick={() => patchSessionContact(null)}
                                    title="Unlink contact"
                                  >
                                    <X size={12} />
                                  </button>
                                </div>
                                <div className="space-y-1 text-xs text-slate-400">
                                  <p className="flex items-center gap-1.5">
                                    <Mail size={11} />
                                    {sessionContact.email || "Unavailable"}
                                  </p>
                                  <p className="flex items-center gap-1.5">
                                    <Building2 size={11} />
                                    {sessionContact.company || "Unavailable"}
                                  </p>
                                  <p className="flex items-center gap-1.5">
                                    <MapPin size={11} />
                                    {sessionContact.location || "Unavailable"}
                                  </p>
                                </div>
                              </>
                            ) : (
                              <select
                                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-500"
                                value=""
                                onChange={(e) =>
                                  e.target.value &&
                                  patchSessionContact(e.target.value)
                                }
                                disabled={!activeId}
                              >
                                <option value="">Link a contact…</option>
                                {(contacts || []).map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.displayName ||
                                      c.email ||
                                      c.id.slice(0, 8)}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        ) : null}
                        {key === "previousConversations"
                          ? (() => {
                              const items = (
                                previousConversations || []
                              ).filter((conv) => conv.id !== activeId);
                              if (items.length === 0) {
                                return (
                                  <p className="text-xs text-slate-500">
                                    No previous conversations found.
                                  </p>
                                );
                              }
                              return (
                                <div className="space-y-1.5">
                                  {items.slice(0, 8).map((conv) => (
                                    <button
                                      key={`prev-conv-${conv.id}`}
                                      type="button"
                                      onClick={() => setActiveId(conv.id)}
                                      className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-left hover:bg-slate-50"
                                    >
                                      <p className="truncate text-xs font-medium text-slate-800">
                                        {conv.contactName ||
                                          conv.contactEmail ||
                                          conv.contactPhone ||
                                          `Conversation ${String(conv.id || "").slice(0, 6)}`}
                                      </p>
                                      <p className="truncate text-[10px] text-slate-500">
                                        {conv.lastMessage?.text ||
                                          "No messages"}
                                      </p>
                                      <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                                        {(conv.status || "open").toUpperCase()}{" "}
                                        • {formatTime(conv.updatedAt)}
                                      </p>
                                    </button>
                                  ))}
                                </div>
                              );
                            })()
                          : null}
                        {key === "conversationNotes" ? (
                          <div className="space-y-2">
                            <Textarea
                              value={noteText}
                              onChange={(e) => setNoteText(e.target.value)}
                              placeholder="Write a note"
                              rows={3}
                              disabled={!activeId}
                              className="rounded-md border-slate-200 bg-white text-xs text-slate-800"
                            />
                            <Button
                              className="h-7 w-full rounded-md bg-slate-100 text-xs text-slate-800 hover:bg-slate-200"
                              onClick={saveNote}
                              disabled={!activeId || !noteText.trim()}
                            >
                              Save note
                            </Button>
                            <div className="space-y-1.5">
                              {notes.map((note) => (
                                <div
                                  key={note.id}
                                  className="rounded-md border border-slate-200 bg-white p-2"
                                >
                                  <p className="text-xs text-slate-700">
                                    {note.text}
                                  </p>
                                  <p className="mt-1 text-[10px] text-slate-500">
                                    {formatTime(note.createdAt)}
                                  </p>
                                </div>
                              ))}
                              {notes.length === 0 ? (
                                <p className="text-xs text-slate-500">
                                  No notes yet.
                                </p>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                        {key === "participants" ? (
                          <div className="space-y-1.5 text-xs text-slate-700">
                            <p>Assignee: {assigneeName}</p>
                            <p>
                              Team:{" "}
                              {teams.find(
                                (item) => item.id === activeSession?.teamId,
                              )?.name || "None"}
                            </p>
                            <p>Bot: {botName}</p>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </section>
                ))}
              </div>
            </div>
          </aside>
        }
      />
      {waTemplatesOpen ? (
        <div className="fixed inset-0 z-[120] flex items-end bg-black/35 p-0 min-[768px]:items-center min-[768px]:justify-center min-[768px]:p-4">
          <div className="flex h-[84vh] w-full flex-col rounded-t-2xl border border-slate-200 bg-white shadow-2xl min-[768px]:h-[min(84vh,760px)] min-[768px]:max-w-5xl min-[768px]:rounded-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  WhatsApp Templates
                </p>
                <p className="text-[11px] text-slate-500">
                  Choose a template and fill required parameters.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 w-8 rounded-md p-0 text-slate-500"
                onClick={() => {
                  setWaTemplatesOpen(false);
                  setWaSelectedTemplate(null);
                  setWaTemplateParams([]);
                  setWaTemplateQuery("");
                  setWaTemplatesError("");
                }}
              >
                <X size={14} />
              </Button>
            </div>

            <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] min-[900px]:grid-cols-[340px_minmax(0,1fr)] min-[900px]:grid-rows-[minmax(0,1fr)]">
              <section className="min-h-0 border-b border-slate-200 p-3 min-[900px]:border-b-0 min-[900px]:border-r">
                <Input
                  value={waTemplateQuery}
                  onChange={(e) => setWaTemplateQuery(e.target.value)}
                  placeholder="Search templates..."
                  className="h-9 text-xs"
                />
                <div className="mt-2 h-[calc(100%-44px)] overflow-y-auto pr-1">
                  {waTemplatesLoading ? (
                    <p className="px-1 py-2 text-xs text-slate-500">
                      Loading templates...
                    </p>
                  ) : null}
                  {waTemplatesError ? (
                    <p className="px-1 py-2 text-xs text-red-600">{waTemplatesError}</p>
                  ) : null}
                  {!waTemplatesLoading && filteredWaTemplates.length === 0 ? (
                    <p className="px-1 py-2 text-xs text-slate-500">
                      No templates found.
                    </p>
                  ) : null}
                  <div className="space-y-1.5">
                    {filteredWaTemplates.map((tpl) => {
                      const selected =
                        waSelectedTemplate?.name === tpl.name &&
                        waSelectedTemplate?.language === tpl.language;
                      return (
                        <button
                          key={`${tpl.name}-${tpl.language || "lang"}`}
                          type="button"
                          className={`w-full rounded-md border p-2 text-left ${
                            selected
                              ? "border-blue-200 bg-blue-50"
                              : "border-slate-200 hover:bg-slate-50"
                          }`}
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
                      );
                    })}
                  </div>
                </div>
              </section>

              <section className="min-h-0 p-3">
                {waSelectedTemplate ? (
                  <div className="flex h-full min-h-0 flex-col">
                    <div className="mb-2">
                      <p className="text-sm font-semibold text-slate-900">
                        {waSelectedTemplate.name}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {(waSelectedTemplate.language || "en_US").toUpperCase()}
                      </p>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                      {waTemplateParams.length > 0 ? (
                        <div className="space-y-2">
                          {waTemplateParams.map((value, idx) => (
                            <div
                              key={`${waSelectedTemplate.name}-param-${idx}`}
                              className="space-y-1"
                            >
                              <label className="block text-[11px] font-medium text-slate-600">
                                Parameter {idx + 1}
                              </label>
                              <Input
                                value={value}
                                onChange={(e) =>
                                  setWaTemplateParams((prev) =>
                                    prev.map((v, i) =>
                                      i === idx ? e.target.value : v,
                                    ),
                                  )
                                }
                                placeholder={`Enter parameter ${idx + 1}`}
                                className="h-9 text-xs"
                              />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500">
                          This template has no parameters.
                        </p>
                      )}
                      {renderedWaPreview ? (
                        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-2">
                          <p className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">
                            Preview
                          </p>
                          <p className="whitespace-pre-wrap text-xs text-slate-700">
                            {renderedWaPreview}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center rounded-md border border-dashed border-slate-200 bg-slate-50 text-xs text-slate-500">
                    Select a template to continue.
                  </div>
                )}
              </section>
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 px-3 py-2">
              <p className="text-[11px] text-slate-500">
                {waSelectedTemplate
                  ? hasMissingTemplateParams
                    ? "Fill all parameters to send."
                    : "Template ready to send."
                  : "Choose a template first."}
              </p>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 px-3 text-xs"
                  onClick={() => {
                    setWaTemplatesOpen(false);
                    setWaSelectedTemplate(null);
                    setWaTemplateParams([]);
                    setWaTemplateQuery("");
                    setWaTemplatesError("");
                  }}
                  disabled={waTemplateSending}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 px-3 text-xs"
                  onClick={() => waSelectedTemplate && void sendTemplate(waSelectedTemplate)}
                  disabled={
                    waTemplateSending ||
                    !waSelectedTemplate ||
                    hasMissingTemplateParams
                  }
                >
                  {waTemplateSending ? "Sending..." : "Send Template"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
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
