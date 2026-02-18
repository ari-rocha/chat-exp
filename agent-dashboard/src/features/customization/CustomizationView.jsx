import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";

const TABS = [
  { key: "general", label: "General" },
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
                  <p className="text-xs text-slate-500">{tenant.slug}</p>
                </div>
              ))}
            </div>
          </aside>
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
