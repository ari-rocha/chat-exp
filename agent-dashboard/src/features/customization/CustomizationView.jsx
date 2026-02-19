import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";

const TABS = [
  { key: "general", label: "General" },
  { key: "routing", label: "Routing", adminOnly: true },
  { key: "profile", label: "My Profile" },
  { key: "members", label: "Members", adminOnly: true },
];

const TABS_NO_ADMIN = [
  { key: "general", label: "General" },
  { key: "profile", label: "My Profile" },
];

const ROLE_LABELS = { owner: "Owner", admin: "Admin", agent: "Agent" };
const ROLE_COLORS = {
  owner: "bg-amber-100 text-amber-800",
  admin: "bg-blue-100 text-blue-800",
  agent: "bg-slate-100 text-slate-700",
};

const CHANNEL_OPTIONS = [
  {
    key: "web",
    label: "Website",
    description: "Create a live chat widget for your website.",
    enabled: true,
  },
  {
    key: "api",
    label: "API",
    description: "Create a programmable channel via API.",
    enabled: true,
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    description: "Coming soon.",
    enabled: false,
  },
  {
    key: "email",
    label: "Email",
    description: "Coming soon.",
    enabled: false,
  },
];

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
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardChannelType, setWizardChannelType] = useState("web");
  const [wizardChannelName, setWizardChannelName] = useState("");
  const [wizardSiteDomain, setWizardSiteDomain] = useState("");
  const [wizardWidgetColor, setWizardWidgetColor] = useState("#2b7fff");
  const [wizardWelcomeTitle, setWizardWelcomeTitle] = useState("Hello!");
  const [wizardWelcomeBody, setWizardWelcomeBody] = useState(
    "Ask any question and we will help you.",
  );
  const [wizardInboxName, setWizardInboxName] = useState("");
  const [wizardSelectedAgents, setWizardSelectedAgents] = useState([]);
  const [wizardDone, setWizardDone] = useState({
    inboxName: "",
    channelName: "",
    channelType: "",
  });
  const [showInboxModal, setShowInboxModal] = useState(false);
  const [editingChannel, setEditingChannel] = useState(null);
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
    if (key === "routing" && !canManage) return;
    if (key === "members" && !canManage) return;
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
      const res = await apiFetch("/api/inboxes", token, {
        method: "POST",
        body: JSON.stringify({
          name: inboxName.trim(),
          channels: [],
        }),
      });
      if (res.inbox) {
        setInboxes((prev) => [...prev, res.inbox]);
      }
      setInboxName("");
    } catch (err) {
      setRoutingError(err.message);
    } finally {
      setRoutingSaving(false);
    }
  };

  const createInboxFromModal = async (name) => {
    if (!name.trim()) return;
    setRoutingError("");
    setRoutingSaving(true);
    try {
      const res = await apiFetch("/api/inboxes", token, {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), channels: [] }),
      });
      if (res.inbox) {
        setInboxes((prev) => [...prev, res.inbox]);
        return res.inbox;
      }
    } catch (err) {
      setRoutingError(err.message);
    } finally {
      setRoutingSaving(false);
    }
    return null;
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
            ch.id === editingChannel.id ? { ...ch, ...channelData } : ch
          )
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
    if (!confirm("Are you sure you want to delete this channel?")) return;
    setRoutingError("");
    try {
      await apiFetch(`/api/channels/${channelId}`, token, {
        method: "DELETE",
      });
      setChannelRecords((prev) => prev.filter((ch) => ch.id !== channelId));
    } catch (err) {
      setRoutingError(err.message);
    }
  };

  const deleteInbox = async (inboxId) => {
    if (!confirm("Are you sure you want to delete this inbox? Agents will lose access.")) return;
    setRoutingError("");
    try {
      await apiFetch(`/api/inboxes/${inboxId}`, token, {
        method: "DELETE",
      });
      setInboxes((prev) => prev.filter((ib) => ib.id !== inboxId));
      // Also update channels to remove inbox reference
      setChannelRecords((prev) =>
        prev.map((ch) => (ch.inboxId === inboxId ? { ...ch, inboxId: null } : ch))
      );
    } catch (err) {
      setRoutingError(err.message);
    }
  };

  const openChannelEditor = (channel) => {
    setEditingChannel(channel || {
      channelType: "web",
      name: "",
      config: { domain: "", widgetColor: "#2b7fff", welcomeTitle: "Hello!", welcomeBody: "Ask any question" },
    });
  };

  const resetWizard = () => {
    setWizardStep(1);
    setWizardChannelType("web");
    setWizardChannelName("");
    setWizardSiteDomain("");
    setWizardWidgetColor("#2b7fff");
    setWizardWelcomeTitle("Hello!");
    setWizardWelcomeBody("Ask any question and we will help you.");
    setWizardInboxName("");
    setWizardSelectedAgents([]);
    setWizardDone({ inboxName: "", channelName: "", channelType: "" });
    setRoutingError("");
  };

  const nextWizardStep = () => {
    if (wizardStep === 1 && !wizardChannelType) {
      setRoutingError("Choose a channel type.");
      return;
    }
    if (wizardStep === 2 && !wizardInboxName.trim()) {
      setRoutingError("Inbox name is required.");
      return;
    }
    setRoutingError("");
    setWizardStep((prev) => Math.min(prev + 1, 4));
  };

  const prevWizardStep = () => {
    setRoutingError("");
    setWizardStep((prev) => Math.max(prev - 1, 1));
  };

  const toggleWizardAgent = (agentId) => {
    setWizardSelectedAgents((prev) =>
      prev.includes(agentId)
        ? prev.filter((id) => id !== agentId)
        : [...prev, agentId],
    );
  };

  const finishWizard = async () => {
    setRoutingSaving(true);
    setRoutingError("");
    try {
      // Create inbox first (Chatwoot-style: inbox is the queue)
      const createdInbox = await apiFetch("/api/inboxes", token, {
        method: "POST",
        body: JSON.stringify({ name: wizardInboxName.trim(), channels: [] }),
      });

      const inbox = createdInbox.inbox;
      if (!inbox) {
        throw new Error("Failed to create inbox");
      }

      // Assign agents to inbox
      if (wizardSelectedAgents.length > 0) {
        for (const agentId of wizardSelectedAgents) {
          await apiFetch(`/api/inboxes/${inbox.id}/assign`, token, {
            method: "POST",
            body: JSON.stringify({ agentId }),
          });
        }
      }

      // Now create channel linked to the inbox
      const channelPayload = {
        channelType: wizardChannelType,
        name:
          wizardChannelName.trim() ||
          `${wizardChannelType === "web" ? "Website" : "API"} Channel`,
        inboxId: inbox.id,
        config:
          wizardChannelType === "web"
            ? {
                domain: wizardSiteDomain.trim(),
                widgetColor: wizardWidgetColor,
                welcomeTitle: wizardWelcomeTitle.trim(),
                welcomeBody: wizardWelcomeBody.trim(),
              }
            : {},
      };
      const createdChannel = await apiFetch("/api/channels", token, {
        method: "POST",
        body: JSON.stringify(channelPayload),
      });

      if (createdChannel.channel) {
        setChannelRecords((prev) => [...prev, createdChannel.channel]);
        setChannels((prev) => {
          if (prev.includes(createdChannel.channel.channelType)) return prev;
          return [...prev, createdChannel.channel.channelType].sort();
        });
      }
      if (inbox) {
        setInboxes((prev) => [
          ...prev,
          {
            ...inbox,
            agentIds: wizardSelectedAgents,
          },
        ]);
      }

      setWizardDone({
        inboxName: wizardInboxName.trim(),
        channelName:
          createdChannel.channel?.name ||
          wizardChannelName ||
          `${wizardChannelType} channel`,
        channelType: wizardChannelType,
      });
      setWizardStep(4);
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
        {(canManage ? TABS : TABS_NO_ADMIN).map((t) => (
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
        <div className="max-w-lg">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-slate-900">Workspace</h3>
            <p className="mb-4 text-xs text-slate-500">
              Your workspace details and identity.
            </p>
            <div className="space-y-3">
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
            <p className="mt-4 text-xs text-slate-400">
              To configure the chat widget appearance, go to <button onClick={() => handleTabChange("routing")} className="text-blue-600 hover:underline font-medium">Routing</button> and edit your web channel.
            </p>
          </section>
        </div>
      )}

      {tab === "routing" && (
        <div className="space-y-6">
          {/* Inboxes List - Primary View */}
          <section className="rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Inboxes</h3>
                <p className="text-xs text-slate-500">Manage your conversation queues</p>
              </div>
              <Button
                onClick={() => {
                  setEditingChannel(null);
                  setWizardStep(1);
                }}
                className="bg-blue-600 text-white hover:bg-blue-700"
              >
                Add Inbox
              </Button>
            </div>
            
            {(inboxes || []).length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm text-slate-500 mb-4">No inboxes yet. Create one to start receiving conversations.</p>
                <Button
                  onClick={() => {
                    setEditingChannel(null);
                    setWizardStep(1);
                  }}
                  className="bg-blue-600 text-white hover:bg-blue-700"
                >
                  Add Inbox
                </Button>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {(inboxes || []).map((inbox) => {
                  const inboxChannels = (channelRecords || []).filter(ch => ch.inboxId === inbox.id);
                  const assignedAgents = (agents || []).filter(a => (inbox.agentIds || []).includes(a.id));
                  return (
                    <div key={inbox.id} className="p-5">
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="text-sm font-semibold text-slate-900">{inbox.name}</h4>
                          <p className="text-xs text-slate-500 mt-1">
                            {inboxChannels.length} channel(s) · {assignedAgents.length} agent(s)
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              openChannelEditor({
                                channelType: "web",
                                name: "",
                                inboxId: inbox.id,
                                config: { domain: "", widgetColor: "#2b7fff", welcomeTitle: "Hello!", welcomeBody: "Ask any question" },
                              });
                            }}
                          >
                            Add Channel
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600 hover:text-red-700"
                            onClick={() => deleteInbox(inbox.id)}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                      
                      {/* Channels for this inbox */}
                      {inboxChannels.length > 0 && (
                        <div className="mt-4 space-y-3">
                          {inboxChannels.map((channel) => (
                            <div
                              key={channel.id}
                              className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3"
                            >
                              <div className="flex items-center gap-3">
                                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                                  channel.channelType === "web" ? "bg-blue-100 text-blue-600" : "bg-purple-100 text-purple-600"
                                }`}>
                                  {channel.channelType === "web" ? "🌐" : "🔌"}
                                </div>
                                <div>
                                  <p className="text-sm font-medium text-slate-900">{channel.name}</p>
                                  <p className="text-xs text-slate-500 capitalize">{channel.channelType} channel</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => openChannelEditor(channel)}
                                >
                                  Edit
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-red-600 hover:text-red-700"
                                  onClick={() => deleteChannel(channel.id)}
                                >
                                  Delete
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {/* Assigned agents */}
                      {assignedAgents.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1">
                          {assignedAgents.map((a) => (
                            <span key={a.id} className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
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
          </section>

          {/* Teams Section */}
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Teams</h3>
                <p className="text-xs text-slate-500">Group agents for routing</p>
              </div>
            </div>
            <form onSubmit={createTeam} className="mb-4 flex gap-2">
              <Input
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="e.g. Sales, Support"
                className="flex-1"
              />
              <Button type="submit" disabled={routingSaving}>
                Add Team
              </Button>
            </form>
            <div className="space-y-2">
              {(teams || []).map((team) => {
                const teamAgents = (agents || []).filter(a => (team.agentIds || []).includes(a.id));
                return (
                  <div
                    key={team.id}
                    className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-900">{team.name}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {teamAgents.map((a) => (
                          <span key={a.id} className="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600">
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
                      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                    >
                      <option value="" disabled>Add agent</option>
                      {(agents || []).filter(a => !(team.agentIds || []).includes(a.id)).map((member) => (
                        <option key={member.id} value={member.id}>{member.name}</option>
                      ))}
                    </select>
                  </div>
                );
              })}
              {(teams || []).length === 0 && (
                <p className="text-xs text-slate-400 py-4 text-center">No teams yet.</p>
              )}
            </div>
          </section>

          {/* Channel Editor Modal */}
          {editingChannel && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
              <div className="w-full max-w-lg rounded-xl bg-[#0a0d14] p-6 text-slate-100">
                <h3 className="text-lg font-semibold text-white mb-4">
                  {editingChannel.id ? "Edit Channel" : "Add Channel"}
                </h3>
                
                <div className="space-y-4">
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">Channel Type</label>
                    <select
                      value={editingChannel.channelType || "web"}
                      onChange={(e) => setEditingChannel({ ...editingChannel, channelType: e.target.value })}
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                    >
                      <option value="web">Website Widget</option>
                      <option value="api">API</option>
                    </select>
                  </div>
                  
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">Channel Name</label>
                    <Input
                      value={editingChannel.name || ""}
                      onChange={(e) => setEditingChannel({ ...editingChannel, name: e.target.value })}
                      placeholder="e.g. My Website"
                      className="border-slate-700 bg-slate-900 text-slate-100"
                    />
                  </div>
                  
                  {!editingChannel.id && (
                    <div>
                      <label className="mb-1 block text-xs text-slate-400">Inbox</label>
                      <select
                        value={editingChannel.inboxId || ""}
                        onChange={(e) => setEditingChannel({ ...editingChannel, inboxId: e.target.value })}
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                      >
                        <option value="">Select inbox...</option>
                        {(inboxes || []).map((ib) => (
                          <option key={ib.id} value={ib.id}>{ib.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  
                  {editingChannel.channelType === "web" && (
                    <>
                      {/* ── Branding ── */}
                      <div className="border-t border-slate-700 pt-4 mt-2">
                        <p className="text-xs font-semibold text-slate-300 uppercase tracking-wide mb-3">Branding</p>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-slate-400">Brand Name</label>
                        <Input
                          value={tenantSettings?.brandName || ""}
                          onChange={(e) =>
                            setTenantSettings((prev) => ({
                              ...(prev || {}),
                              brandName: e.target.value,
                            }))
                          }
                          placeholder="Your brand name"
                          className="border-slate-700 bg-slate-900 text-slate-100"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="mb-1 block text-xs text-slate-400">Primary Color</label>
                          <Input
                            value={tenantSettings?.primaryColor || ""}
                            onChange={(e) =>
                              setTenantSettings((prev) => ({
                                ...(prev || {}),
                                primaryColor: e.target.value,
                              }))
                            }
                            placeholder="#hex"
                            className="border-slate-700 bg-slate-900 text-slate-100"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-slate-400">Accent Color</label>
                          <Input
                            value={tenantSettings?.accentColor || ""}
                            onChange={(e) =>
                              setTenantSettings((prev) => ({
                                ...(prev || {}),
                                accentColor: e.target.value,
                              }))
                            }
                            placeholder="#hex"
                            className="border-slate-700 bg-slate-900 text-slate-100"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-slate-400">Logo URL</label>
                        <Input
                          value={tenantSettings?.logoUrl || ""}
                          onChange={(e) =>
                            setTenantSettings((prev) => ({
                              ...(prev || {}),
                              logoUrl: e.target.value,
                            }))
                          }
                          placeholder="https://..."
                          className="border-slate-700 bg-slate-900 text-slate-100"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-slate-400">Privacy URL</label>
                        <Input
                          value={tenantSettings?.privacyUrl || ""}
                          onChange={(e) =>
                            setTenantSettings((prev) => ({
                              ...(prev || {}),
                              privacyUrl: e.target.value,
                            }))
                          }
                          placeholder="https://..."
                          className="border-slate-700 bg-slate-900 text-slate-100"
                        />
                      </div>

                      {/* ── Widget ── */}
                      <div className="border-t border-slate-700 pt-4 mt-2">
                        <p className="text-xs font-semibold text-slate-300 uppercase tracking-wide mb-3">Widget</p>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-slate-400">Website Domain</label>
                        <Input
                          value={editingChannel.config?.domain || ""}
                          onChange={(e) => setEditingChannel({ 
                            ...editingChannel, 
                            config: { ...editingChannel.config, domain: e.target.value } 
                          })}
                          placeholder="e.g. example.com"
                          className="border-slate-700 bg-slate-900 text-slate-100"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-slate-400">Widget Color</label>
                        <div className="flex gap-2">
                          <Input
                            type="color"
                            value={editingChannel.config?.widgetColor || "#2b7fff"}
                            onChange={(e) => setEditingChannel({ 
                              ...editingChannel, 
                              config: { ...editingChannel.config, widgetColor: e.target.value } 
                            })}
                            className="h-10 w-16 border-slate-700 bg-slate-900"
                          />
                          <Input
                            value={editingChannel.config?.widgetColor || "#2b7fff"}
                            onChange={(e) => setEditingChannel({ 
                              ...editingChannel, 
                              config: { ...editingChannel.config, widgetColor: e.target.value } 
                            })}
                            placeholder="#hex"
                            className="flex-1 border-slate-700 bg-slate-900 text-slate-100"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-slate-400">Welcome Title</label>
                        <Input
                          value={editingChannel.config?.welcomeTitle || ""}
                          onChange={(e) => setEditingChannel({ 
                            ...editingChannel, 
                            config: { ...editingChannel.config, welcomeTitle: e.target.value } 
                          })}
                          placeholder="Hello!"
                          className="border-slate-700 bg-slate-900 text-slate-100"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-slate-400">Welcome Message</label>
                        <Textarea
                          value={editingChannel.config?.welcomeBody || ""}
                          onChange={(e) => setEditingChannel({ 
                            ...editingChannel, 
                            config: { ...editingChannel.config, welcomeBody: e.target.value } 
                          })}
                          placeholder="Ask any question..."
                          rows={2}
                          className="border-slate-700 bg-slate-900 text-slate-100"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-slate-400">Welcome Text</label>
                        <Textarea
                          value={tenantSettings?.welcomeText || ""}
                          onChange={(e) =>
                            setTenantSettings((prev) => ({
                              ...(prev || {}),
                              welcomeText: e.target.value,
                            }))
                          }
                          placeholder="Longer welcome text shown in the widget"
                          rows={2}
                          className="border-slate-700 bg-slate-900 text-slate-100"
                        />
                      </div>

                      {/* ── Bot Profile ── */}
                      <div className="border-t border-slate-700 pt-4 mt-2">
                        <p className="text-xs font-semibold text-slate-300 uppercase tracking-wide mb-3">Bot Profile</p>
                      </div>
                      <div className="flex items-center gap-3 mb-1">
                        {tenantSettings?.botAvatarUrl ? (
                          <img
                            src={tenantSettings.botAvatarUrl}
                            alt="Bot"
                            className="h-10 w-10 rounded-full object-cover border-2 border-slate-700"
                          />
                        ) : (
                          <div className="h-10 w-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 text-white flex items-center justify-center text-sm font-bold">
                            {(tenantSettings?.botName || "B")[0].toUpperCase()}
                          </div>
                        )}
                        <span className="text-sm text-slate-300 font-medium">
                          {tenantSettings?.botName || "Bot"}
                        </span>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-slate-400">Bot Display Name</label>
                        <Input
                          value={tenantSettings?.botName || ""}
                          onChange={(e) =>
                            setTenantSettings((prev) => ({
                              ...(prev || {}),
                              botName: e.target.value,
                            }))
                          }
                          placeholder="e.g. Agent, Support Bot"
                          className="border-slate-700 bg-slate-900 text-slate-100"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-slate-400">Bot Avatar URL</label>
                        <Input
                          value={tenantSettings?.botAvatarUrl || ""}
                          onChange={(e) =>
                            setTenantSettings((prev) => ({
                              ...(prev || {}),
                              botAvatarUrl: e.target.value,
                            }))
                          }
                          placeholder="https://..."
                          className="border-slate-700 bg-slate-900 text-slate-100"
                        />
                      </div>
                      
                      {/* Embed Code */}
                      <div>
                        <label className="mb-1 block text-xs text-slate-400">Embed Code</label>
                        <div className="rounded-lg bg-slate-900 p-3">
                          <code className="text-xs text-emerald-400 break-all">
                            {`<script>
  (function(d,t){
    var g=d.createElement(t),s=d.getElementsByTagName(t)[0];
    g.src="https://${typeof window !== 'undefined' ? window.location.hostname : 'your-domain.com'}/widget.js";
    g.setAttribute("data-tenant-id","${editingChannel.inboxId || '[INBOX-ID]'}");
    g.setAttribute("data-channel-id","${editingChannel.id || '[CHANNEL-ID]'}");
    s.parentNode.insertBefore(g,s);
  }(document,"script"));
</script>`}
                          </code>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          Add this to your website's HTML before the closing body tag
                        </p>
                      </div>
                    </>
                  )}
                </div>
                
                {routingError && (
                  <p className="mt-3 text-xs text-red-400">{routingError}</p>
                )}
                
                <div className="mt-6 flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setEditingChannel(null)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={async () => {
                      const payload = {
                        channelType: editingChannel.channelType,
                        name: editingChannel.name || `${editingChannel.channelType} Channel`,
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
                    {routingSaving ? "Saving..." : "Save Channel"}
                  </Button>
                </div>
              </div>
            </div>
          )}
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
