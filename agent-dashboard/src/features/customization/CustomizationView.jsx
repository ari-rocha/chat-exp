import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  ChevronRight,
  CircleUserRound,
  Globe,
  Inbox,
  MessageSquareText,
  Pencil,
  Settings2,
  Tag,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { useState } from "react";

/* ──────────────────────────────────────── constants ──────── */
const NAV_SECTIONS = [
  {
    group: "Personal",
    items: [{ key: "account", label: "Account", icon: CircleUserRound }],
  },
  {
    group: "Workspace",
    items: [
      { key: "general", label: "General", icon: Settings2 },
      { key: "channels", label: "Channels", icon: Globe },
      { key: "canned", label: "Canned Responses", icon: MessageSquareText },
      { key: "tags", label: "Tags", icon: Tag },
      { key: "teams", label: "Teams", icon: Users },
      { key: "members", label: "Members", icon: UserPlus, adminOnly: true },
    ],
  },
];

const ROLE_LABELS = { owner: "Owner", admin: "Admin", agent: "Agent" };
const ROLE_COLORS = {
  owner: "bg-amber-100 text-amber-800",
  admin: "bg-blue-100 text-blue-800",
  agent: "bg-slate-100 text-slate-700",
};
const PRIMARY_BUTTON_CLASS = "bg-blue-600 text-white hover:bg-blue-700";

/* ──────────────────────────────────────── component ─────── */
export default function CustomizationView({
  open,
  onOpenChange,
  tenantSettings,
  setTenantSettings,
  saveTenantSettings,
  tenants,
  agent,
  agents,
  teams,
  setTeams,
  inboxes,
  setInboxes,
  channels,
  setChannels,
  channelRecords,
  setChannelRecords,
  cannedReplies,
  setCannedReplies,
  tags,
  setTags,
  apiFetch,
  token,
}) {
  const [page, setPage] = useState("account");
  const [members, setMembers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("agent");
  const [inviteError, setInviteError] = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const [profileName, setProfileName] = useState(agent?.name || "");
  const [profileAvatar, setProfileAvatar] = useState(agent?.avatarUrl || "");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [inboxName, setInboxName] = useState("");
  const [editingChannel, setEditingChannel] = useState(null);
  const [routingError, setRoutingError] = useState("");
  const [routingSaving, setRoutingSaving] = useState(false);

  // Canned replies
  const [cannedTitle, setCannedTitle] = useState("");
  const [cannedShortcut, setCannedShortcut] = useState("");
  const [cannedBody, setCannedBody] = useState("");
  const [cannedSaving, setCannedSaving] = useState(false);
  const [editingCanned, setEditingCanned] = useState(null);
  const [showCannedDialog, setShowCannedDialog] = useState(false);

  // Tags
  const [tagName, setTagName] = useState("");
  const [tagColor, setTagColor] = useState("#3b82f6");
  const [tagDescription, setTagDescription] = useState("");
  const [tagSaving, setTagSaving] = useState(false);
  const [editingTag, setEditingTag] = useState(null);
  const [showTagDialog, setShowTagDialog] = useState(false);

  const isOwner = agent?.role === "owner";
  const isAdmin = agent?.role === "admin";
  const canManage = isOwner || isAdmin;

  /* ── navigation ── */
  const navigateTo = (key) => {
    setPage(key);
    setEditingChannel(null);
    setRoutingError("");
    if (key === "members" && !membersLoaded) loadMembers();
  };

  /* ── api helpers ── */
  const loadMembers = async () => {
    if (!token) return;
    try {
      const [membersRes, invRes] = await Promise.all([
        apiFetch("/api/tenant/members", token),
        canManage
          ? apiFetch("/api/tenant/invitations", token)
          : Promise.resolve({ invitations: [] }),
      ]);
      setMembers(membersRes.members ?? []);
      setInvitations(invRes.invitations ?? []);
      setMembersLoaded(true);
    } catch (e) {
      console.error("failed to load members", e);
    }
  };

  const createTeam = async (e) => {
    e.preventDefault();
    if (!teamName.trim()) return;
    setRoutingError("");
    setRoutingSaving(true);
    try {
      const res = await apiFetch("/api/teams", token, {
        method: "POST",
        body: JSON.stringify({ name: teamName.trim() }),
      });
      if (res.team) setTeams((prev) => [...prev, res.team]);
      setTeamName("");
    } catch (err) {
      setRoutingError(err.message);
    } finally {
      setRoutingSaving(false);
    }
  };

  const createInbox = async (e) => {
    e.preventDefault();
    if (!inboxName.trim()) return;
    setRoutingError("");
    setRoutingSaving(true);
    try {
      const res = await apiFetch("/api/inboxes", token, {
        method: "POST",
        body: JSON.stringify({ name: inboxName.trim(), channels: [] }),
      });
      if (res.inbox) setInboxes((prev) => [...prev, res.inbox]);
      setInboxName("");
    } catch (err) {
      setRoutingError(err.message);
    } finally {
      setRoutingSaving(false);
    }
  };

  const saveChannelFromModal = async (channelData) => {
    setRoutingError("");
    setRoutingSaving(true);
    try {
      if (editingChannel?.id) {
        await apiFetch(`/api/channels/${editingChannel.id}`, token, {
          method: "PATCH",
          body: JSON.stringify(channelData),
        });
        setChannelRecords((prev) =>
          prev.map((ch) =>
            ch.id === editingChannel.id ? { ...ch, ...channelData } : ch,
          ),
        );
      } else {
        const res = await apiFetch("/api/channels", token, {
          method: "POST",
          body: JSON.stringify(channelData),
        });
        if (res.channel) {
          setChannelRecords((prev) => [...prev, res.channel]);
          setChannels((prev) => {
            if (prev.includes(res.channel.channelType)) return prev;
            return [...prev, res.channel.channelType].sort();
          });
        }
      }
      setEditingChannel(null);
    } catch (err) {
      setRoutingError(err.message);
    } finally {
      setRoutingSaving(false);
    }
  };

  const deleteChannel = async (channelId) => {
    if (!confirm("Delete this channel?")) return;
    setRoutingError("");
    try {
      await apiFetch(`/api/channels/${channelId}`, token, { method: "DELETE" });
      setChannelRecords((prev) => prev.filter((ch) => ch.id !== channelId));
    } catch (err) {
      setRoutingError(err.message);
    }
  };

  const deleteInbox = async (inboxId) => {
    if (!confirm("Delete this inbox and unlink all its channels?")) return;
    setRoutingError("");
    try {
      await apiFetch(`/api/inboxes/${inboxId}`, token, { method: "DELETE" });
      setInboxes((prev) => prev.filter((ib) => ib.id !== inboxId));
      setChannelRecords((prev) =>
        prev.map((ch) =>
          ch.inboxId === inboxId ? { ...ch, inboxId: null } : ch,
        ),
      );
    } catch (err) {
      setRoutingError(err.message);
    }
  };

  const assignAgentToTeam = async (teamId, agentId) => {
    if (!teamId || !agentId) return;
    setRoutingError("");
    try {
      await apiFetch(`/api/teams/${teamId}/members`, token, {
        method: "POST",
        body: JSON.stringify({ agentId }),
      });
      setTeams((prev) =>
        prev.map((team) =>
          team.id === teamId
            ? {
                ...team,
                agentIds: Array.from(
                  new Set([...(team.agentIds || []), agentId]),
                ),
              }
            : team,
        ),
      );
    } catch (err) {
      setRoutingError(err.message);
    }
  };

  const assignAgentToInbox = async (inboxId, agentId) => {
    if (!inboxId || !agentId) return;
    setRoutingError("");
    try {
      await apiFetch(`/api/inboxes/${inboxId}/assign`, token, {
        method: "POST",
        body: JSON.stringify({ agentId }),
      });
      setInboxes((prev) =>
        prev.map((inbox) =>
          inbox.id === inboxId
            ? {
                ...inbox,
                agentIds: Array.from(
                  new Set([...(inbox.agentIds || []), agentId]),
                ),
              }
            : inbox,
        ),
      );
    } catch (err) {
      setRoutingError(err.message);
    }
  };

  const sendInvite = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviteError("");
    setInviteSending(true);
    try {
      const res = await apiFetch("/api/tenant/invitations", token, {
        method: "POST",
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      setInvitations((prev) => [res.invitation, ...prev]);
      setInviteEmail("");
    } catch (err) {
      setInviteError(err.message);
    } finally {
      setInviteSending(false);
    }
  };

  const revokeInvitation = async (id) => {
    try {
      await apiFetch(`/api/tenant/invitations/${id}`, token, {
        method: "DELETE",
      });
      setInvitations((prev) => prev.filter((inv) => inv.id !== id));
    } catch (err) {
      console.error(err);
    }
  };

  const removeMember = async (id) => {
    if (!confirm("Remove this member from the workspace?")) return;
    try {
      await apiFetch(`/api/tenant/members/${id}`, token, { method: "DELETE" });
      setMembers((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      console.error(err);
    }
  };

  const changeRole = async (memberId, newRole) => {
    try {
      await apiFetch(`/api/tenant/members/${memberId}/role`, token, {
        method: "PATCH",
        body: JSON.stringify({ role: newRole }),
      });
      setMembers((prev) =>
        prev.map((m) => (m.id === memberId ? { ...m, role: newRole } : m)),
      );
    } catch (err) {
      console.error(err);
    }
  };

  const saveProfile = async () => {
    setProfileSaving(true);
    setProfileSaved(false);
    try {
      await apiFetch("/api/agent/profile", token, {
        method: "PATCH",
        body: JSON.stringify({ name: profileName, avatarUrl: profileAvatar }),
      });
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2000);
    } catch (err) {
      console.error(err);
    } finally {
      setProfileSaving(false);
    }
  };

  const normalizeCannedShortcut = (value) => value.replaceAll("/", "");

  const saveWorkspaceProfile = async () => {
    setWorkspaceSaving(true);
    try {
      await saveTenantSettings();
    } catch (err) {
      console.error(err);
    } finally {
      setWorkspaceSaving(false);
    }
  };

  /* ── canned replies ── */
  const saveCannedReply = async (e) => {
    e.preventDefault();
    if (!cannedTitle.trim() || !cannedBody.trim()) return;
    setCannedSaving(true);
    try {
      if (editingCanned) {
        const res = await apiFetch(
          `/api/canned-replies/${editingCanned.id}`,
          token,
          {
            method: "PATCH",
            body: JSON.stringify({
              title: cannedTitle.trim(),
              shortcut: normalizeCannedShortcut(cannedShortcut).trim(),
              body: cannedBody.trim(),
            }),
          },
        );
        if (res.cannedReply) {
          setCannedReplies((prev) =>
            prev.map((r) => (r.id === editingCanned.id ? res.cannedReply : r)),
          );
        }
        setEditingCanned(null);
      } else {
        const res = await apiFetch("/api/canned-replies", token, {
          method: "POST",
          body: JSON.stringify({
            title: cannedTitle.trim(),
            shortcut: normalizeCannedShortcut(cannedShortcut).trim(),
            category: "",
            body: cannedBody.trim(),
          }),
        });
        if (res.cannedReply)
          setCannedReplies((prev) => [...prev, res.cannedReply]);
      }
      setCannedTitle("");
      setCannedShortcut("");
      setCannedBody("");
      setShowCannedDialog(false);
    } catch (err) {
      console.error(err);
    } finally {
      setCannedSaving(false);
    }
  };

  const deleteCannedReply = async (id) => {
    if (!confirm("Delete this canned response?")) return;
    try {
      await apiFetch(`/api/canned-replies/${id}`, token, { method: "DELETE" });
      setCannedReplies((prev) => prev.filter((r) => r.id !== id));
      if (editingCanned?.id === id) {
        setEditingCanned(null);
        setCannedTitle("");
        setCannedShortcut("");
        setCannedBody("");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const openCannedDialog = (reply = null) => {
    if (reply) {
      setEditingCanned(reply);
      setCannedTitle(reply.title);
      setCannedShortcut(normalizeCannedShortcut(reply.shortcut || ""));
      setCannedBody(reply.body);
    } else {
      setEditingCanned(null);
      setCannedTitle("");
      setCannedShortcut("");
      setCannedBody("");
    }
    setShowCannedDialog(true);
  };

  const closeCannedDialog = () => {
    setShowCannedDialog(false);
    setEditingCanned(null);
    setCannedTitle("");
    setCannedShortcut("");
    setCannedBody("");
  };

  /* ── tags ── */
  const createOrUpdateTag = async (e) => {
    e.preventDefault();
    if (!tagName.trim()) return;
    setTagSaving(true);
    try {
      if (editingTag) {
        const res = await apiFetch(`/api/tags/${editingTag.id}`, token, {
          method: "PATCH",
          body: JSON.stringify({
            name: tagName.trim(),
            color: tagColor,
            description: tagDescription.trim(),
          }),
        });
        if (res.tag)
          setTags((prev) =>
            prev.map((t) => (t.id === editingTag.id ? res.tag : t)),
          );
        setEditingTag(null);
      } else {
        const res = await apiFetch("/api/tags", token, {
          method: "POST",
          body: JSON.stringify({
            name: tagName.trim(),
            color: tagColor,
            description: tagDescription.trim(),
          }),
        });
        if (res.tag) setTags((prev) => [...prev, res.tag]);
      }
      setTagName("");
      setTagDescription("");
      setShowTagDialog(false);
    } catch (err) {
      console.error(err);
    } finally {
      setTagSaving(false);
    }
  };

  const deleteTag = async (id) => {
    if (!confirm("Delete this tag?")) return;
    try {
      await apiFetch(`/api/tags/${id}`, token, { method: "DELETE" });
      setTags((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      console.error(err);
    }
  };

  const openTagDialog = (tag = null) => {
    if (tag) {
      setEditingTag(tag);
      setTagName(tag.name);
      setTagColor(tag.color || "#3b82f6");
      setTagDescription(tag.description || "");
    } else {
      setEditingTag(null);
      setTagName("");
      setTagColor("#3b82f6");
      setTagDescription("");
    }
    setShowTagDialog(true);
  };

  const closeTagDialog = () => {
    setShowTagDialog(false);
    setEditingTag(null);
    setTagName("");
    setTagColor("#3b82f6");
    setTagDescription("");
  };

  const openChannelEditor = (channel) => {
    setEditingChannel(
      channel || {
        channelType: "web",
        name: "",
        config: {
          domain: "",
        },
      },
    );
  };

  /* ═══════════════════════════════════════════════════════════
     PAGE RENDERERS
     ═══════════════════════════════════════════════════════════ */

  /* ──────────── Account ──────────── */
  const renderAccountPage = () => (
    <div>
      <h2 className="text-base font-semibold text-slate-900">Account</h2>
      <p className="mb-6 text-sm text-slate-500">
        Manage how you appear in the chat widget.
      </p>

      <div className="mb-6 flex items-center gap-4">
        {profileAvatar ? (
          <img
            src={profileAvatar}
            alt="Avatar"
            className="h-16 w-16 rounded-full object-cover border-2 border-slate-200"
          />
        ) : (
          <div className="h-16 w-16 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 text-white flex items-center justify-center text-xl font-bold">
            {(profileName || "A")[0].toUpperCase()}
          </div>
        )}
        <div>
          <p className="text-sm font-medium text-slate-900">
            {agent?.name || "Agent"}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <Badge className={ROLE_COLORS[agent?.role] || ""}>
              {ROLE_LABELS[agent?.role] || agent?.role}
            </Badge>
            <span className="text-xs text-slate-400">{agent?.email}</span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 max-w-md">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-700">
            Display name
          </label>
          <Input
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            placeholder="Your display name"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-700">
            Avatar URL
          </label>
          <Input
            value={profileAvatar}
            onChange={(e) => setProfileAvatar(e.target.value)}
            placeholder="https://example.com/avatar.jpg"
          />
          <p className="mt-1 text-xs text-slate-400">
            Direct image URL. Appears next to your messages in the widget.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 pt-1">
          {profileSaved && (
            <span className="text-xs text-emerald-600 font-medium">
              ✓ Saved
            </span>
          )}
          <Button
            onClick={saveProfile}
            disabled={profileSaving}
            className={PRIMARY_BUTTON_CLASS}
          >
            {profileSaving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );

  /* ──────────── General ──────────── */
  const renderGeneralPage = () => (
    <div>
      <h2 className="text-base font-semibold text-slate-900">General</h2>
      <p className="mb-6 text-sm text-slate-500">Your workspace identity.</p>

      <div className="max-w-xl rounded-lg border border-slate-200 bg-white p-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-700">
            Short bio
          </label>
          <Input
            value={tenantSettings?.workspaceShortBio || ""}
            onChange={(e) =>
              setTenantSettings((prev) => ({
                ...(prev || {}),
                workspaceShortBio: e.target.value,
              }))
            }
            placeholder="A short one-line summary of this workspace"
            maxLength={140}
          />
          <p className="mt-1 text-xs text-slate-400">Up to 140 characters.</p>
        </div>
        <div className="mt-4">
          <label className="mb-1.5 block text-xs font-medium text-slate-700">
            Description
          </label>
          <Textarea
            value={tenantSettings?.workspaceDescription || ""}
            onChange={(e) =>
              setTenantSettings((prev) => ({
                ...(prev || {}),
                workspaceDescription: e.target.value,
              }))
            }
            placeholder="Describe your workspace in more detail."
            rows={3}
          />
        </div>
        <div className="mt-4 flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
          <Button
            type="button"
            onClick={saveWorkspaceProfile}
            disabled={workspaceSaving}
            className={PRIMARY_BUTTON_CLASS}
          >
            {workspaceSaving ? "Saving…" : "Save Workspace"}
          </Button>
        </div>
      </div>

      <div className="mt-6 space-y-3 max-w-md">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Linked Workspaces
        </p>
        {tenants.map((tenant) => (
          <div
            key={tenant.id}
            className="rounded-lg border border-slate-200 bg-slate-50 p-4"
          >
            <p className="text-sm font-semibold text-slate-900">
              {tenant.name}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              @{tenant.workspaceUsername || tenant.slug}
            </p>
          </div>
        ))}
      </div>
    </div>
  );

  /* ──────────── Channels list ──────────── */
  const renderChannelsListPage = () => (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-semibold text-slate-900">Channels</h2>
        <Button
          type="submit"
          form="add-inbox-form"
          disabled={routingSaving}
          size="sm"
          className={`${PRIMARY_BUTTON_CLASS} shrink-0`}
        >
          <Inbox size={14} className="mr-1.5" />
          Add Inbox
        </Button>
      </div>
      <p className="mb-6 text-sm text-slate-500">
        Configure inboxes and the channels that feed into them.
      </p>

      {/* Add inbox */}
      <form
        id="add-inbox-form"
        onSubmit={createInbox}
        className="mb-6 flex gap-2 max-w-md"
      >
        <Input
          value={inboxName}
          onChange={(e) => setInboxName(e.target.value)}
          placeholder="New inbox name…"
          className="flex-1"
        />
      </form>

      {routingError && (
        <p className="mb-4 text-xs text-red-600">{routingError}</p>
      )}

      {(inboxes || []).length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center">
          <Inbox size={28} className="mx-auto mb-2 text-slate-300" />
          <p className="text-sm text-slate-500">
            No inboxes yet. Create one to start receiving conversations.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {(inboxes || []).map((inbox) => {
            const inboxChannels = (channelRecords || []).filter(
              (ch) => ch.inboxId === inbox.id,
            );
            const assignedAgents = (agents || []).filter((a) =>
              (inbox.agentIds || []).includes(a.id),
            );
            return (
              <div
                key={inbox.id}
                className="rounded-lg border border-slate-200 bg-white"
              >
                {/* Inbox header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-100">
                      <Inbox size={14} className="text-slate-500" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {inbox.name}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {inboxChannels.length} channel
                        {inboxChannels.length !== 1 ? "s" : ""} ·{" "}
                        {assignedAgents.length} agent
                        {assignedAgents.length !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        assignAgentToInbox(inbox.id, e.target.value);
                        e.target.value = "";
                      }}
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600"
                    >
                      <option value="" disabled>
                        + Agent
                      </option>
                      {(agents || [])
                        .filter((a) => !(inbox.agentIds || []).includes(a.id))
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                    </select>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() =>
                        openChannelEditor({
                          channelType: "web",
                          name: "",
                          inboxId: inbox.id,
                          config: {
                            domain: "",
                          },
                        })
                      }
                    >
                      + Channel
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-slate-400 hover:text-red-600"
                      onClick={() => deleteInbox(inbox.id)}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </div>

                {/* Channels */}
                {inboxChannels.length > 0 && (
                  <div className="divide-y divide-slate-50">
                    {inboxChannels.map((channel) => (
                      <button
                        key={channel.id}
                        type="button"
                        onClick={() => openChannelEditor(channel)}
                        className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-slate-50 transition-colors"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="text-base">
                            {channel.channelType === "web" ? "🌐" : "🔌"}
                          </span>
                          <div>
                            <p className="text-sm font-medium text-slate-800">
                              {channel.name}
                            </p>
                            <p className="text-[11px] text-slate-400 capitalize">
                              {channel.channelType}
                              {channel.config?.domain
                                ? ` · ${channel.config.domain}`
                                : ""}
                            </p>
                          </div>
                        </div>
                        <ChevronRight size={14} className="text-slate-300" />
                      </button>
                    ))}
                  </div>
                )}

                {/* Assigned agents */}
                {assignedAgents.length > 0 && (
                  <div className="flex flex-wrap gap-1 px-4 py-2 border-t border-slate-50">
                    {assignedAgents.map((a) => (
                      <span
                        key={a.id}
                        className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600"
                      >
                        {a.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  /* ──────────── Channel Editor (drill-down) ──────────── */
  const renderChannelEditorPage = () => {
    if (!editingChannel) return null;

    const isWeb = editingChannel.channelType === "web";
    const updateConfig = (key, value) =>
      setEditingChannel({
        ...editingChannel,
        config: { ...editingChannel.config, [key]: value },
      });

    return (
      <div>
        <button
          type="button"
          onClick={() => setEditingChannel(null)}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft size={14} />
          Back to Channels
        </button>

        <h2 className="text-base font-semibold text-slate-900">
          {editingChannel.id ? "Edit Channel" : "New Channel"}
        </h2>
        <p className="mb-6 text-sm text-slate-500">
          {isWeb
            ? "Configure your website widget, branding and bot profile."
            : "Configure your API channel."}
        </p>

        <div className="space-y-5 max-w-md">
          {/* Basics */}
          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
              Channel
            </legend>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-700">
                Type
              </label>
              <select
                value={editingChannel.channelType || "web"}
                onChange={(e) =>
                  setEditingChannel({
                    ...editingChannel,
                    channelType: e.target.value,
                  })
                }
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              >
                <option value="web">Website Widget</option>
                <option value="api">API</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-700">
                Name
              </label>
              <Input
                value={editingChannel.name || ""}
                onChange={(e) =>
                  setEditingChannel({
                    ...editingChannel,
                    name: e.target.value,
                  })
                }
                placeholder="e.g. My Website"
              />
            </div>
            {!editingChannel.id && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-700">
                  Inbox
                </label>
                <select
                  value={editingChannel.inboxId || ""}
                  onChange={(e) =>
                    setEditingChannel({
                      ...editingChannel,
                      inboxId: e.target.value,
                    })
                  }
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                >
                  <option value="">Select inbox…</option>
                  {(inboxes || []).map((ib) => (
                    <option key={ib.id} value={ib.id}>
                      {ib.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </fieldset>

          {isWeb && (
            <>
              {/* Branding */}
              <fieldset className="space-y-3 border-t border-slate-200 pt-5">
                <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
                  Branding
                </legend>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-700">
                    Brand name
                  </label>
                  <Input
                    value={tenantSettings?.brandName || ""}
                    onChange={(e) =>
                      setTenantSettings((prev) => ({
                        ...(prev || {}),
                        brandName: e.target.value,
                      }))
                    }
                    placeholder="Your brand name"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-700">
                      Primary color
                    </label>
                    <div className="flex gap-2">
                      <Input
                        type="color"
                        value={tenantSettings?.primaryColor || "#2563eb"}
                        onChange={(e) =>
                          setTenantSettings((prev) => ({
                            ...(prev || {}),
                            primaryColor: e.target.value,
                          }))
                        }
                        className="h-9 w-12 p-0.5 cursor-pointer"
                      />
                      <Input
                        value={tenantSettings?.primaryColor || ""}
                        onChange={(e) =>
                          setTenantSettings((prev) => ({
                            ...(prev || {}),
                            primaryColor: e.target.value,
                          }))
                        }
                        placeholder="#hex"
                        className="flex-1"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-700">
                      Accent color
                    </label>
                    <div className="flex gap-2">
                      <Input
                        type="color"
                        value={tenantSettings?.accentColor || "#10b981"}
                        onChange={(e) =>
                          setTenantSettings((prev) => ({
                            ...(prev || {}),
                            accentColor: e.target.value,
                          }))
                        }
                        className="h-9 w-12 p-0.5 cursor-pointer"
                      />
                      <Input
                        value={tenantSettings?.accentColor || ""}
                        onChange={(e) =>
                          setTenantSettings((prev) => ({
                            ...(prev || {}),
                            accentColor: e.target.value,
                          }))
                        }
                        placeholder="#hex"
                        className="flex-1"
                      />
                    </div>
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-700">
                    Logo URL
                  </label>
                  <Input
                    value={tenantSettings?.logoUrl || ""}
                    onChange={(e) =>
                      setTenantSettings((prev) => ({
                        ...(prev || {}),
                        logoUrl: e.target.value,
                      }))
                    }
                    placeholder="https://..."
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-700">
                    Privacy URL
                  </label>
                  <Input
                    value={tenantSettings?.privacyUrl || ""}
                    onChange={(e) =>
                      setTenantSettings((prev) => ({
                        ...(prev || {}),
                        privacyUrl: e.target.value,
                      }))
                    }
                    placeholder="https://..."
                  />
                </div>
              </fieldset>

              {/* Widget */}
              <fieldset className="space-y-3 border-t border-slate-200 pt-5">
                <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
                  Widget
                </legend>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-700">
                    Website domain
                  </label>
                  <Input
                    value={editingChannel.config?.domain || ""}
                    onChange={(e) => updateConfig("domain", e.target.value)}
                    placeholder="e.g. example.com"
                  />
                  <p className="mt-1 text-xs text-slate-400">
                    The domain where this widget will be embedded.
                  </p>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-700">
                    Welcome text
                  </label>
                  <Textarea
                    value={tenantSettings?.welcomeText || ""}
                    onChange={(e) =>
                      setTenantSettings((prev) => ({
                        ...(prev || {}),
                        welcomeText: e.target.value,
                      }))
                    }
                    placeholder="Greeting shown when the widget opens"
                    rows={2}
                  />
                </div>
              </fieldset>

              {/* Bot Profile */}
              <fieldset className="space-y-3 border-t border-slate-200 pt-5">
                <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
                  Bot Profile
                </legend>
                <div className="flex items-center gap-3 mb-1">
                  {tenantSettings?.botAvatarUrl ? (
                    <img
                      src={tenantSettings.botAvatarUrl}
                      alt="Bot"
                      className="h-10 w-10 rounded-full object-cover border-2 border-slate-200"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 text-white flex items-center justify-center text-sm font-bold">
                      {(tenantSettings?.botName || "B")[0].toUpperCase()}
                    </div>
                  )}
                  <span className="text-sm text-slate-700 font-medium">
                    {tenantSettings?.botName || "Bot"}
                  </span>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-700">
                    Bot display name
                  </label>
                  <Input
                    value={tenantSettings?.botName || ""}
                    onChange={(e) =>
                      setTenantSettings((prev) => ({
                        ...(prev || {}),
                        botName: e.target.value,
                      }))
                    }
                    placeholder="e.g. Agent, Support Bot"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-700">
                    Bot avatar URL
                  </label>
                  <Input
                    value={tenantSettings?.botAvatarUrl || ""}
                    onChange={(e) =>
                      setTenantSettings((prev) => ({
                        ...(prev || {}),
                        botAvatarUrl: e.target.value,
                      }))
                    }
                    placeholder="https://..."
                  />
                </div>
              </fieldset>

              {/* Embed Code */}
              <fieldset className="space-y-2 border-t border-slate-200 pt-5">
                <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
                  Embed Code
                </legend>
                <div className="rounded-lg bg-slate-900 p-3">
                  <code className="text-xs text-emerald-400 break-all whitespace-pre-wrap">
                    {`<script>
  (function(d,t){
    var g=d.createElement(t),s=d.getElementsByTagName(t)[0];
    g.src="https://${typeof window !== "undefined" ? window.location.hostname : "your-domain.com"}/widget.js";
    g.setAttribute("data-tenant-id","${editingChannel.tenantId || "[TENANT-ID]"}");
    g.setAttribute("data-channel-id","${editingChannel.id || "[CHANNEL-ID]"}");
    s.parentNode.insertBefore(g,s);
  }(document,"script"));
</script>`}
                  </code>
                </div>
                <p className="text-xs text-slate-400">
                  Add this to your website before the closing{" "}
                  <code className="text-slate-500">&lt;/body&gt;</code> tag.
                </p>
              </fieldset>
            </>
          )}

          {routingError && (
            <p className="text-xs text-red-600">{routingError}</p>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between gap-2 border-t border-slate-200 pt-5">
            {editingChannel.id ? (
              <Button
                variant="ghost"
                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                onClick={() => {
                  deleteChannel(editingChannel.id);
                  setEditingChannel(null);
                }}
              >
                <Trash2 size={14} className="mr-1.5" />
                Delete
              </Button>
            ) : (
              <div />
            )}
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => setEditingChannel(null)}>
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  const payload = {
                    channelType: editingChannel.channelType,
                    name:
                      editingChannel.name ||
                      `${editingChannel.channelType} Channel`,
                    inboxId: editingChannel.inboxId,
                    config: editingChannel.config || {},
                  };
                  await saveChannelFromModal(payload);
                  if (editingChannel.channelType === "web") {
                    await saveTenantSettings();
                  }
                }}
                disabled={routingSaving}
                className={PRIMARY_BUTTON_CLASS}
              >
                {routingSaving ? "Saving…" : "Save Channel"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  /* ──────────── Teams ──────────── */
  const renderTeamsPage = () => (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-semibold text-slate-900">Teams</h2>
        <Button
          type="submit"
          form="add-team-form"
          disabled={routingSaving}
          size="sm"
          className={PRIMARY_BUTTON_CLASS}
        >
          Add Team
        </Button>
      </div>
      <p className="mb-6 text-sm text-slate-500">
        Group agents for routing and assignment.
      </p>

      <form
        id="add-team-form"
        onSubmit={createTeam}
        className="mb-6 flex gap-2 max-w-md"
      >
        <Input
          value={teamName}
          onChange={(e) => setTeamName(e.target.value)}
          placeholder="e.g. Sales, Support"
          className="flex-1"
        />
      </form>

      {routingError && (
        <p className="mb-4 text-xs text-red-600">{routingError}</p>
      )}

      <div className="space-y-3">
        {(teams || []).map((team) => {
          const teamAgents = (agents || []).filter((a) =>
            (team.agentIds || []).includes(a.id),
          );
          return (
            <div
              key={team.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3"
            >
              <div>
                <p className="text-sm font-medium text-slate-900">
                  {team.name}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {teamAgents.map((a) => (
                    <span
                      key={a.id}
                      className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600"
                    >
                      {a.name}
                    </span>
                  ))}
                  {teamAgents.length === 0 && (
                    <span className="text-xs text-slate-400">No agents</span>
                  )}
                </div>
              </div>
              <select
                defaultValue=""
                onChange={(e) => {
                  assignAgentToTeam(team.id, e.target.value);
                  e.target.value = "";
                }}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600"
              >
                <option value="" disabled>
                  + Agent
                </option>
                {(agents || [])
                  .filter((a) => !(team.agentIds || []).includes(a.id))
                  .map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
              </select>
            </div>
          );
        })}
        {(teams || []).length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center">
            <Users size={28} className="mx-auto mb-2 text-slate-300" />
            <p className="text-sm text-slate-500">No teams yet.</p>
          </div>
        )}
      </div>
    </div>
  );

  /* ──────────── Members ──────────── */
  const renderMembersPage = () => (
    <div>
      <h2 className="text-base font-semibold text-slate-900">Members</h2>
      <p className="mb-6 text-sm text-slate-500">
        People who have access to this workspace.
      </p>

      {/* Invite form */}
      {canManage && (
        <form
          onSubmit={sendInvite}
          className="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-4"
        >
          <p className="mb-3 text-xs font-semibold text-slate-700">
            Invite a member
          </p>
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="Email address"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
              className="flex-1"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
            >
              <option value="agent">Agent</option>
              <option value="admin">Admin</option>
            </select>
            <Button
              type="submit"
              disabled={inviteSending}
              className={PRIMARY_BUTTON_CLASS}
            >
              {inviteSending ? "Sending…" : "Invite"}
            </Button>
          </div>
          {inviteError && (
            <p className="mt-2 text-xs text-red-600">{inviteError}</p>
          )}
        </form>
      )}

      {/* Members list */}
      <div className="space-y-2">
        {members.map((member) => (
          <div
            key={member.id}
            className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700">
                {member.name?.[0]?.toUpperCase() || "?"}
              </div>
              <div>
                <p className="text-sm font-medium text-slate-900">
                  {member.name}
                  {member.id === agent?.id && (
                    <span className="ml-1.5 text-xs text-slate-400">(you)</span>
                  )}
                </p>
                <p className="text-xs text-slate-500">{member.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isOwner && member.role !== "owner" && member.id !== agent?.id ? (
                <select
                  value={member.role}
                  onChange={(e) => changeRole(member.id, e.target.value)}
                  className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                >
                  <option value="admin">Admin</option>
                  <option value="agent">Agent</option>
                </select>
              ) : (
                <Badge
                  className={ROLE_COLORS[member.role] || ROLE_COLORS.agent}
                >
                  {ROLE_LABELS[member.role] || member.role}
                </Badge>
              )}
              {canManage &&
                member.id !== agent?.id &&
                member.role !== "owner" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-slate-400 hover:text-red-600"
                    onClick={() => removeMember(member.id)}
                  >
                    <Trash2 size={13} />
                  </Button>
                )}
            </div>
          </div>
        ))}
        {members.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-400">
            No members found
          </p>
        )}
      </div>

      {/* Pending invitations */}
      {canManage &&
        invitations.filter((i) => i.status === "pending").length > 0 && (
          <div className="mt-6">
            <p className="mb-3 text-xs font-semibold text-slate-700">
              Pending invitations
            </p>
            <div className="space-y-2">
              {invitations
                .filter((inv) => inv.status === "pending")
                .map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-700">
                        {inv.email}
                      </p>
                      <p className="text-xs text-slate-400">
                        {ROLE_LABELS[inv.role] || inv.role}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => navigator.clipboard.writeText(inv.token)}
                        className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
                      >
                        Copy token
                      </button>
                      <button
                        type="button"
                        onClick={() => revokeInvitation(inv.id)}
                        className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                      >
                        Revoke
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
    </div>
  );

  /* ──────────── Canned Responses ──────────── */
  const renderCannedPage = () => (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-semibold text-slate-900">
          Canned Responses
        </h2>
        <Button
          onClick={() => openCannedDialog()}
          className={PRIMARY_BUTTON_CLASS}
          size="sm"
        >
          Add Canned Response
        </Button>
      </div>
      <p className="mb-6 text-sm text-slate-500">
        Pre-written replies agents can use with the / shortcut.
      </p>

      {/* Table */}
      {(cannedReplies || []).length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center">
          <MessageSquareText
            size={28}
            className="mx-auto mb-2 text-slate-300"
          />
          <p className="text-sm text-slate-500">No canned responses yet.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Title
                </th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Shortcut
                </th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Content
                </th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider w-20">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {(cannedReplies || []).map((reply) => (
                <tr
                  key={reply.id}
                  className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/50 transition-colors"
                >
                  <td className="px-4 py-3 text-sm font-medium text-slate-900">
                    {reply.title}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {reply.shortcut ? (
                      <Badge
                        variant="secondary"
                        className="text-[11px] font-mono"
                      >
                        /{reply.shortcut}
                      </Badge>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500 max-w-xs truncate">
                    {reply.body}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openCannedDialog(reply)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-blue-600 transition-colors"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteCannedReply(reply.id)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Dialog */}
      <Dialog
        open={showCannedDialog}
        onOpenChange={(v) => {
          if (!v) closeCannedDialog();
        }}
      >
        <DialogContent className="p-0 gap-0">
          <div className="px-6 pt-5 pb-4 border-b border-slate-200">
            <DialogTitle className="text-base font-semibold text-slate-900">
              {editingCanned ? "Edit Canned Response" : "Add Canned Response"}
            </DialogTitle>
            <DialogDescription className="text-sm text-slate-500 mt-1">
              {editingCanned
                ? "Update the canned response details."
                : "Create a pre-written reply for quick use."}
            </DialogDescription>
          </div>
          <form onSubmit={saveCannedReply} className="px-6 py-4 space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Title
              </label>
              <Input
                value={cannedTitle}
                onChange={(e) => setCannedTitle(e.target.value)}
                placeholder="e.g. Greeting"
                required
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Shortcut
              </label>
              <Input
                value={cannedShortcut}
                onChange={(e) =>
                  setCannedShortcut(normalizeCannedShortcut(e.target.value))
                }
                onPaste={(e) => {
                  const pasted = e.clipboardData?.getData("text") || "";
                  if (pasted.includes("/")) {
                    e.preventDefault();
                    const input = e.currentTarget;
                    const clean = normalizeCannedShortcut(pasted);
                    const start = input.selectionStart ?? input.value.length;
                    const end = input.selectionEnd ?? input.value.length;
                    const nextValue =
                      input.value.slice(0, start) +
                      clean +
                      input.value.slice(end);
                    setCannedShortcut(nextValue);
                  }
                }}
                placeholder="shortcut"
              />
              <p className="mt-1 text-xs text-slate-400">
                Agents type / followed by this shortcut to insert the response.
              </p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Content
              </label>
              <Textarea
                value={cannedBody}
                onChange={(e) => setCannedBody(e.target.value)}
                placeholder="Response body…"
                required
                rows={4}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={closeCannedDialog}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={cannedSaving}
                className={PRIMARY_BUTTON_CLASS}
              >
                {cannedSaving ? "Saving…" : editingCanned ? "Update" : "Create"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );

  /* ──────────── Tags ──────────── */
  const TAG_COLORS = [
    "#3b82f6",
    "#ef4444",
    "#f59e0b",
    "#10b981",
    "#8b5cf6",
    "#ec4899",
    "#06b6d4",
    "#f97316",
    "#6366f1",
    "#14b8a6",
  ];

  const renderTagsPage = () => (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-semibold text-slate-900">Tags</h2>
        <Button
          onClick={() => openTagDialog()}
          className={PRIMARY_BUTTON_CLASS}
          size="sm"
        >
          Add Tag
        </Button>
      </div>
      <p className="mb-6 text-sm text-slate-500">
        Labels to organize and filter conversations.
      </p>

      {/* Table */}
      {(tags || []).length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center">
          <Tag size={28} className="mx-auto mb-2 text-slate-300" />
          <p className="text-sm text-slate-500">No tags yet.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Description
                </th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Color
                </th>
                <th className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider w-20">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {(tags || []).map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/50 transition-colors"
                >
                  <td className="px-4 py-3 text-sm font-medium text-slate-900">
                    {t.name}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500 max-w-xs truncate">
                    {t.description || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="inline-block h-5 w-5 rounded-full ring-1 ring-black/10"
                      style={{ background: t.color || "#3b82f6" }}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openTagDialog(t)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-blue-600 transition-colors"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteTag(t.id)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Dialog */}
      <Dialog
        open={showTagDialog}
        onOpenChange={(v) => {
          if (!v) closeTagDialog();
        }}
      >
        <DialogContent className="p-0 gap-0">
          <div className="px-6 pt-5 pb-4 border-b border-slate-200">
            <DialogTitle className="text-base font-semibold text-slate-900">
              {editingTag ? "Edit Tag" : "Add Tag"}
            </DialogTitle>
            <DialogDescription className="text-sm text-slate-500 mt-1">
              {editingTag
                ? "Update the tag details below."
                : "Create a label for organizing conversations."}
            </DialogDescription>
          </div>
          <form onSubmit={createOrUpdateTag} className="px-6 py-4 space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Name
              </label>
              <Input
                value={tagName}
                onChange={(e) => setTagName(e.target.value)}
                placeholder="e.g. VIP, Bug, Urgent"
                required
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Description
              </label>
              <Input
                value={tagDescription}
                onChange={(e) => setTagDescription(e.target.value)}
                placeholder="A short description of this tag"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Color
              </label>
              <div className="flex items-center gap-3 mt-1">
                <input
                  type="color"
                  value={tagColor}
                  onChange={(e) => setTagColor(e.target.value)}
                  className="h-9 w-16 rounded border border-slate-300 cursor-pointer bg-white"
                  style={{ padding: 0 }}
                  aria-label="Pick tag color"
                />
                <span
                  className="inline-block h-7 w-7 rounded-full border border-slate-200"
                  style={{ background: tagColor }}
                />
                <span className="text-xs text-slate-500">{tagColor}</span>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={closeTagDialog}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={tagSaving}
                className={PRIMARY_BUTTON_CLASS}
              >
                {tagSaving ? "Saving…" : editingTag ? "Update" : "Create"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );

  /* ──────────── Content Router ──────────── */
  const renderContent = () => {
    if (editingChannel) return renderChannelEditorPage();
    switch (page) {
      case "account":
        return renderAccountPage();
      case "general":
        return renderGeneralPage();
      case "channels":
        return renderChannelsListPage();
      case "canned":
        return renderCannedPage();
      case "tags":
        return renderTagsPage();
      case "teams":
        return renderTeamsPage();
      case "members":
        return renderMembersPage();
      default:
        return renderAccountPage();
    }
  };

  /* ═══════════════════════════════════════════════════════════
     RENDER — sidebar-13 settings dialog
     ═══════════════════════════════════════════════════════════ */
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        className="overflow-hidden p-0 md:max-h-[85vh] md:max-w-[700px] lg:max-w-[900px]"
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Manage your workspace settings
        </DialogDescription>

        <div className="flex h-full max-h-[85vh] min-h-[540px]">
          {/* ── Sidebar ── */}
          <nav className="hidden md:flex w-[220px] shrink-0 flex-col border-r border-slate-200 bg-slate-50/70 p-3 overflow-y-auto">
            <p className="px-2 mb-4 text-sm font-semibold text-slate-900">
              Settings
            </p>

            {NAV_SECTIONS.map((section) => {
              const visibleItems = section.items.filter(
                (item) => !item.adminOnly || canManage,
              );
              if (visibleItems.length === 0) return null;
              return (
                <div key={section.group} className="mb-4">
                  <p className="px-2 mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    {section.group}
                  </p>
                  <div className="space-y-0.5">
                    {visibleItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = page === item.key && !editingChannel;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => navigateTo(item.key)}
                          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors ${
                            isActive
                              ? "bg-white text-slate-900 font-medium shadow-sm"
                              : "text-slate-600 hover:bg-white/60 hover:text-slate-900"
                          }`}
                        >
                          <Icon size={15} className="shrink-0" />
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>

          {/* ── Content ── */}
          <ScrollArea className="flex-1">
            <div className="p-6">{renderContent()}</div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
