import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";

const TABS = [
  { key: "general", label: "General" },
  { key: "routing", label: "Routing" },
  { key: "profile", label: "My Profile" },
  { key: "members", label: "Members" },
];

const ROLE_LABELS = { owner: "Owner", admin: "Admin", agent: "Agent" };
const ROLE_COLORS = {
  owner: "bg-amber-100 text-amber-800",
  admin: "bg-blue-100 text-blue-800",
  agent: "bg-slate-100 text-slate-700",
};

export default function CustomizationView({
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
  const [tab, setTab] = useState("general");
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
  const [inboxChannels, setInboxChannels] = useState("web");
  const [channelType, setChannelType] = useState("web");
  const [channelName, setChannelName] = useState("");
  const [channelInboxId, setChannelInboxId] = useState("");
  const [routingError, setRoutingError] = useState("");
  const [routingSaving, setRoutingSaving] = useState(false);

  const isOwner = agent?.role === "owner";
  const isAdmin = agent?.role === "admin";
  const canManage = isOwner || isAdmin;

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

  const handleTabChange = (key) => {
    setTab(key);
    if (key === "members" && !membersLoaded) {
      loadMembers();
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
      if (res.team) {
        setTeams((prev) => [...prev, res.team]);
      }
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
      const nextChannels = inboxChannels
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
      const res = await apiFetch("/api/inboxes", token, {
        method: "POST",
        body: JSON.stringify({
          name: inboxName.trim(),
          channels: nextChannels.length ? nextChannels : [],
        }),
      });
      if (res.inbox) {
        setInboxes((prev) => [...prev, res.inbox]);
      }
      setInboxName("");
      setInboxChannels("");
    } catch (err) {
      setRoutingError(err.message);
    } finally {
      setRoutingSaving(false);
    }
  };

  const createChannel = async (e) => {
    e.preventDefault();
    setRoutingError("");
    setRoutingSaving(true);
    try {
      const res = await apiFetch("/api/channels", token, {
        method: "POST",
        body: JSON.stringify({
          channelType,
          name: channelName.trim() || undefined,
          inboxId: channelInboxId || undefined,
        }),
      });
      if (res.channel) {
        const record = res.channel;
        setChannelRecords((prev) => [...prev, record]);
        setChannels((prev) => {
          if (prev.includes(record.channelType)) return prev;
          return [...prev, record.channelType].sort();
        });
        if (record.inboxId) {
          setInboxes((prev) =>
            prev.map((inbox) =>
              inbox.id === record.inboxId
                ? {
                    ...inbox,
                    channels: Array.from(
                      new Set([...(inbox.channels || []), record.channelType]),
                    ),
                  }
                : inbox,
            ),
          );
        }
      }
      setChannelName("");
      setChannelInboxId("");
    } catch (err) {
      setRoutingError(err.message);
    } finally {
      setRoutingSaving(false);
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
                agentIds: Array.from(new Set([...(team.agentIds || []), agentId])),
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
                agentIds: Array.from(new Set([...(inbox.agentIds || []), agentId])),
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
      await apiFetch(`/api/tenant/members/${id}`, token, {
        method: "DELETE",
      });
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50 p-4">
      {/* Tab bar */}
      <div className="mb-4 flex gap-1 rounded-lg bg-slate-100 p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => handleTabChange(t.key)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "general" && (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-slate-900">
              Workspace customization
            </h3>
            <p className="mb-4 text-xs text-slate-500">
              Configure branding and widget behavior for this workspace.
            </p>
            <div className="grid gap-3 max-w-lg">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
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
                  placeholder="Brand name"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    Primary color
                  </label>
                  <Input
                    value={tenantSettings?.primaryColor || ""}
                    onChange={(e) =>
                      setTenantSettings((prev) => ({
                        ...(prev || {}),
                        primaryColor: e.target.value,
                      }))
                    }
                    placeholder="#hex"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    Accent color
                  </label>
                  <Input
                    value={tenantSettings?.accentColor || ""}
                    onChange={(e) =>
                      setTenantSettings((prev) => ({
                        ...(prev || {}),
                        accentColor: e.target.value,
                      }))
                    }
                    placeholder="#hex"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
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
                <label className="mb-1 block text-xs font-medium text-slate-600">
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
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Welcome text
                </label>
                <Textarea
                  rows={3}
                  value={tenantSettings?.welcomeText || ""}
                  onChange={(e) =>
                    setTenantSettings((prev) => ({
                      ...(prev || {}),
                      welcomeText: e.target.value,
                    }))
                  }
                  placeholder="Welcome text"
                />
              </div>

              {/* Bot Profile */}
              <div className="border-t border-slate-200 pt-3 mt-1">
                <h4 className="text-sm font-semibold text-slate-900 mb-1">
                  Bot profile
                </h4>
                <p className="mb-3 text-xs text-slate-500">
                  How the bot appears to visitors on automated and AI messages.
                </p>
                <div className="flex items-center gap-4 mb-3">
                  {tenantSettings?.botAvatarUrl ? (
                    <img
                      src={tenantSettings.botAvatarUrl}
                      alt="Bot"
                      className="h-12 w-12 rounded-full object-cover border-2 border-slate-200"
                    />
                  ) : (
                    <div className="h-12 w-12 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 text-white flex items-center justify-center text-lg font-bold">
                      {(tenantSettings?.botName || "B")[0].toUpperCase()}
                    </div>
                  )}
                  <div className="text-sm text-slate-700 font-medium">
                    {tenantSettings?.botName || "Bot"}
                  </div>
                </div>
                <div className="grid gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">
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
                    <label className="mb-1 block text-xs font-medium text-slate-600">
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
                </div>
              </div>

              <Button
                className="w-full max-w-[200px] bg-blue-600 text-white hover:bg-blue-700"
                onClick={saveTenantSettings}
              >
                Save customization
              </Button>
            </div>
          </section>
          <aside className="rounded-xl border border-slate-200 bg-white p-4">
            <h4 className="text-sm font-semibold text-slate-900">Workspace</h4>
            <div className="mt-3 space-y-2">
              {tenants.map((tenant) => (
                <div
                  key={tenant.id}
                  className="rounded-md border border-slate-200 bg-slate-50 p-3"
                >
                  <p className="text-sm font-medium text-slate-900">
                    {tenant.name}
                  </p>
                  <p className="text-xs text-slate-500">
                    @{tenant.workspaceUsername || tenant.slug}
                  </p>
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}

      {tab === "routing" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-slate-900">Teams</h3>
            <p className="mb-3 text-xs text-slate-500">
              Create teams and assign agents.
            </p>
            <form onSubmit={createTeam} className="mb-3 flex gap-2">
              <Input
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="e.g. Sales, Support"
              />
              <Button type="submit" disabled={routingSaving}>
                Add team
              </Button>
            </form>
            <div className="space-y-2">
              {(teams || []).map((team) => (
                <div
                  key={team.id}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-slate-900">{team.name}</p>
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        assignAgentToTeam(team.id, e.target.value);
                        e.target.value = "";
                      }}
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                    >
                      <option value="" disabled>
                        Add agent
                      </option>
                      {(agents || []).map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {(team.agentIds || []).length} assigned
                  </p>
                </div>
              ))}
              {(teams || []).length === 0 && (
                <p className="text-xs text-slate-400">No teams yet.</p>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-slate-900">Inboxes</h3>
            <p className="mb-3 text-xs text-slate-500">
              Create inboxes, then attach dedicated channel records.
            </p>
            <form onSubmit={createInbox} className="mb-2 grid gap-2">
              <Input
                value={inboxName}
                onChange={(e) => setInboxName(e.target.value)}
                placeholder="Inbox name"
              />
              <Input
                value={inboxChannels}
                onChange={(e) => setInboxChannels(e.target.value)}
                placeholder="Optional initial channel types: web,whatsapp,email"
              />
              <Button type="submit" disabled={routingSaving}>
                Add inbox
              </Button>
            </form>
            <div className="space-y-2">
              {(inboxes || []).map((inbox) => (
                <div
                  key={inbox.id}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{inbox.name}</p>
                      <p className="text-xs text-slate-500">
                        {(inbox.channels || []).join(", ") || "web"}
                      </p>
                    </div>
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        assignAgentToInbox(inbox.id, e.target.value);
                        e.target.value = "";
                      }}
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                    >
                      <option value="" disabled>
                        Assign agent
                      </option>
                      {(agents || []).map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {(inbox.agentIds || []).length} assigned
                  </p>
                </div>
              ))}
              {(inboxes || []).length === 0 && (
                <p className="text-xs text-slate-400">No inboxes yet.</p>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-slate-900">Channels</h3>
            <p className="mb-3 text-xs text-slate-500">
              Dedicated channel entities (Chatwoot-style), optionally bound to an inbox.
            </p>
            <form onSubmit={createChannel} className="mb-3 grid gap-2">
              <select
                value={channelType}
                onChange={(e) => setChannelType(e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              >
                {["web", "whatsapp", "sms", "instagram", "email"].map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
              <Input
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
                placeholder="Channel name (optional)"
              />
              <select
                value={channelInboxId}
                onChange={(e) => setChannelInboxId(e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              >
                <option value="">No inbox</option>
                {(inboxes || []).map((inbox) => (
                  <option key={inbox.id} value={inbox.id}>
                    {inbox.name}
                  </option>
                ))}
              </select>
              <Button type="submit" disabled={routingSaving}>
                Add channel
              </Button>
            </form>
            <div className="space-y-2">
              {(channelRecords || []).map((channel) => (
                <div
                  key={channel.id}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                >
                  <p className="text-sm font-medium text-slate-900">{channel.name}</p>
                  <p className="text-xs text-slate-500">
                    {channel.channelType}
                    {channel.inboxId
                      ? ` · ${inboxes.find((i) => i.id === channel.inboxId)?.name || "Inbox"}`
                      : " · Unassigned"}
                  </p>
                </div>
              ))}
              {(channelRecords || []).length === 0 && (
                <p className="text-xs text-slate-400">No channels yet.</p>
              )}
            </div>
            {routingError ? (
              <p className="mt-3 text-xs text-red-600">{routingError}</p>
            ) : null}
          </section>
        </div>
      )}

      {tab === "profile" && (
        <div className="max-w-lg">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-slate-900">My Profile</h3>
            <p className="mb-4 text-xs text-slate-500">
              This is how you appear to visitors in the chat widget.
            </p>

            <div className="mb-5 flex items-center gap-4">
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
              <div className="flex-1">
                <Badge className={ROLE_COLORS[agent?.role] || ""}>
                  {ROLE_LABELS[agent?.role] || agent?.role}
                </Badge>
                <p className="mt-1 text-xs text-slate-500">{agent?.email}</p>
              </div>
            </div>

            <div className="grid gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Display Name
                </label>
                <Input
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  placeholder="Your display name"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Avatar URL
                </label>
                <Input
                  value={profileAvatar}
                  onChange={(e) => setProfileAvatar(e.target.value)}
                  placeholder="https://example.com/avatar.jpg"
                />
                <p className="mt-1 text-xs text-slate-400">
                  Paste a direct image URL. This appears next to your messages
                  in the widget.
                </p>
              </div>
              <div className="flex items-center gap-2 pt-2">
                <Button onClick={saveProfile} disabled={profileSaving}>
                  {profileSaving ? "Saving…" : "Save Profile"}
                </Button>
                {profileSaved && (
                  <span className="text-xs text-emerald-600 font-medium">
                    ✓ Saved
                  </span>
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      {tab === "members" && (
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          {/* Members list */}
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-slate-900">
              Team members
            </h3>
            <p className="mb-4 text-xs text-slate-500">
              People who have access to this workspace.
            </p>
            <div className="space-y-2">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 p-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700">
                      {member.name?.[0]?.toUpperCase() || "?"}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {member.name}
                        {member.id === agent?.id && (
                          <span className="ml-1.5 text-xs text-slate-400">
                            (you)
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-slate-500">{member.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isOwner &&
                    member.role !== "owner" &&
                    member.id !== agent?.id ? (
                      <select
                        value={member.role}
                        onChange={(e) => changeRole(member.id, e.target.value)}
                        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                      >
                        <option value="admin">Admin</option>
                        <option value="agent">Agent</option>
                      </select>
                    ) : (
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_COLORS[member.role] || ROLE_COLORS.agent}`}
                      >
                        {ROLE_LABELS[member.role] || member.role}
                      </span>
                    )}
                    {canManage &&
                      member.id !== agent?.id &&
                      member.role !== "owner" && (
                        <button
                          onClick={() => removeMember(member.id)}
                          className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          title="Remove member"
                        >
                          <svg
                            className="h-4 w-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </button>
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
          </section>

          {/* Invite + Pending invitations */}
          <div className="space-y-4">
            {canManage && (
              <section className="rounded-xl border border-slate-200 bg-white p-5">
                <h4 className="text-sm font-semibold text-slate-900">
                  Invite member
                </h4>
                <p className="mb-3 text-xs text-slate-500">
                  Send an invitation to join this workspace.
                </p>
                <form onSubmit={sendInvite} className="space-y-3">
                  <Input
                    type="email"
                    placeholder="Email address"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    required
                  />
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
                  >
                    <option value="agent">Agent</option>
                    <option value="admin">Admin</option>
                  </select>
                  {inviteError && (
                    <p className="text-xs text-red-600">{inviteError}</p>
                  )}
                  <Button
                    type="submit"
                    disabled={inviteSending}
                    className="w-full bg-blue-600 text-white hover:bg-blue-700"
                  >
                    {inviteSending ? "Sending..." : "Send invitation"}
                  </Button>
                </form>
              </section>
            )}

            {canManage && invitations.length > 0 && (
              <section className="rounded-xl border border-slate-200 bg-white p-5">
                <h4 className="text-sm font-semibold text-slate-900">
                  Pending invitations
                </h4>
                <div className="mt-3 space-y-2">
                  {invitations
                    .filter((inv) => inv.status === "pending")
                    .map((inv) => (
                      <div
                        key={inv.id}
                        className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 p-3"
                      >
                        <div>
                          <p className="text-sm font-medium text-slate-700">
                            {inv.email}
                          </p>
                          <p className="text-xs text-slate-400">
                            Role: {ROLE_LABELS[inv.role] || inv.role}
                          </p>
                        </div>
                        <button
                          onClick={() => revokeInvitation(inv.id)}
                          className="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                        >
                          Revoke
                        </button>
                      </div>
                    ))}
                </div>
              </section>
            )}

            {/* Invitation link info */}
            {canManage &&
              invitations.filter((i) => i.status === "pending").length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-xs text-amber-800">
                    <strong>Invitation tokens:</strong> Invited users need to
                    register with the invitation token. Share the token from the
                    invitation with them.
                  </p>
                  <div className="mt-2 space-y-1">
                    {invitations
                      .filter((i) => i.status === "pending")
                      .map((inv) => (
                        <div key={inv.id} className="flex items-center gap-2">
                          <span className="text-xs text-amber-700 truncate">
                            {inv.email}:
                          </span>
                          <code className="flex-1 truncate rounded bg-white px-2 py-0.5 text-xs text-slate-700 border border-amber-200">
                            {inv.token}
                          </code>
                          <button
                            onClick={() =>
                              navigator.clipboard.writeText(inv.token)
                            }
                            className="shrink-0 rounded px-2 py-0.5 text-xs text-amber-700 hover:bg-amber-100"
                          >
                            Copy
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  );
}
