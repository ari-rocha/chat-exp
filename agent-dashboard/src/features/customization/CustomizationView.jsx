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
  Settings2,
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
  const [teamName, setTeamName] = useState("");
  const [inboxName, setInboxName] = useState("");
  const [editingChannel, setEditingChannel] = useState(null);
  const [routingError, setRoutingError] = useState("");
  const [routingSaving, setRoutingSaving] = useState(false);

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
        <div className="flex items-center gap-2 pt-1">
          <Button
            onClick={saveProfile}
            disabled={profileSaving}
            className="bg-blue-600 text-white hover:bg-blue-700"
          >
            {profileSaving ? "Saving…" : "Save"}
          </Button>
          {profileSaved && (
            <span className="text-xs text-emerald-600 font-medium">
              ✓ Saved
            </span>
          )}
        </div>
      </div>
    </div>
  );

  /* ──────────── General ──────────── */
  const renderGeneralPage = () => (
    <div>
      <h2 className="text-base font-semibold text-slate-900">General</h2>
      <p className="mb-6 text-sm text-slate-500">Your workspace identity.</p>

      <div className="space-y-3 max-w-md">
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
      <h2 className="text-base font-semibold text-slate-900">Channels</h2>
      <p className="mb-6 text-sm text-slate-500">
        Configure inboxes and the channels that feed into them.
      </p>

      {/* Add inbox */}
      <form onSubmit={createInbox} className="mb-6 flex gap-2 max-w-md">
        <Input
          value={inboxName}
          onChange={(e) => setInboxName(e.target.value)}
          placeholder="New inbox name…"
          className="flex-1"
        />
        <Button
          type="submit"
          disabled={routingSaving}
          className="bg-blue-600 text-white hover:bg-blue-700 shrink-0"
        >
          <Inbox size={14} className="mr-1.5" />
          Add Inbox
        </Button>
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
          <div className="flex items-center gap-2 border-t border-slate-200 pt-5">
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
              className="bg-blue-600 text-white hover:bg-blue-700"
            >
              {routingSaving ? "Saving…" : "Save Channel"}
            </Button>
            <Button variant="outline" onClick={() => setEditingChannel(null)}>
              Cancel
            </Button>
            {editingChannel.id && (
              <Button
                variant="ghost"
                className="ml-auto text-red-600 hover:text-red-700 hover:bg-red-50"
                onClick={() => {
                  deleteChannel(editingChannel.id);
                  setEditingChannel(null);
                }}
              >
                <Trash2 size={14} className="mr-1.5" />
                Delete
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  };

  /* ──────────── Teams ──────────── */
  const renderTeamsPage = () => (
    <div>
      <h2 className="text-base font-semibold text-slate-900">Teams</h2>
      <p className="mb-6 text-sm text-slate-500">
        Group agents for routing and assignment.
      </p>

      <form onSubmit={createTeam} className="mb-6 flex gap-2 max-w-md">
        <Input
          value={teamName}
          onChange={(e) => setTeamName(e.target.value)}
          placeholder="e.g. Sales, Support"
          className="flex-1"
        />
        <Button
          type="submit"
          disabled={routingSaving}
          className="bg-blue-600 text-white hover:bg-blue-700"
        >
          Add Team
        </Button>
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
              className="bg-blue-600 text-white hover:bg-blue-700"
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
