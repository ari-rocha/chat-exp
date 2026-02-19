import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEffect, useMemo, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

const STEP_LABELS = {
  login: "Sign in",
  "signup-account": "Account",
  "signup-choice": "Choose flow",
  "signup-create": "Create workspace",
  "signup-join": "Join workspace",
  "workspace-picker": "Select workspace",
};

function StepBadge({ current }) {
  const items = ["signup-account", "signup-choice", "signup-create"];
  const currentIndex = items.indexOf(current);
  return (
    <div className="flex items-center gap-2">
      {items.map((item, index) => (
        <span
          key={item}
          className={`h-2 w-8 rounded-full transition-colors ${
            currentIndex >= index ? "bg-blue-600" : "bg-slate-200"
          }`}
        />
      ))}
    </div>
  );
}

export default function AuthView({
  authStage,
  authForm,
  setAuthForm,
  workspaceChoices,
  authError,
  loginAuth,
  signupAccount,
  createWorkspaceFromSignup,
  joinWorkspaceFromSignup,
  pickWorkspaceAfterLogin,
  setAuthStage,
}) {
  const [invitationInfo, setInvitationInfo] = useState(null);

  useEffect(() => {
    if (authStage !== "signup-join") return;
    const token = authForm.invitationToken?.trim();
    if (!token || token.length < 10) {
      setInvitationInfo(null);
      return;
    }
    const controller = new AbortController();
    fetch(`${API_URL}/api/invitation/${token}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        if (data.tenantName) setInvitationInfo(data);
        else setInvitationInfo(null);
      })
      .catch(() => setInvitationInfo(null));
    return () => controller.abort();
  }, [authStage, authForm.invitationToken]);

  const title = useMemo(() => {
    if (authStage === "login") return "Welcome back";
    if (authStage === "workspace-picker") return "Choose your workspace";
    return "Set up your account";
  }, [authStage]);

  return (
    <div className="grid min-h-screen place-items-center bg-slate-100 p-6">
      <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm md:grid md:grid-cols-[1fr_340px] md:gap-6">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {authStage === "login"
              ? "Sign in to continue."
              : authStage === "workspace-picker"
                ? "Your account belongs to multiple workspaces."
                : "Linear onboarding: account, then workspace."}
          </p>
          {authStage !== "login" && authStage !== "workspace-picker" ? (
            <div className="mt-4">
              <StepBadge current={authStage} />
            </div>
          ) : null}

          {authStage === "login" ? (
            <form className="mt-4 space-y-3" onSubmit={loginAuth}>
              <Input
                type="email"
                placeholder="Email"
                value={authForm.email}
                onChange={(e) =>
                  setAuthForm((p) => ({ ...p, email: e.target.value }))
                }
                required
              />
              <Input
                type="password"
                placeholder="Password"
                value={authForm.password}
                onChange={(e) =>
                  setAuthForm((p) => ({ ...p, password: e.target.value }))
                }
                required
              />
              {authError ? <p className="text-sm text-red-600">{authError}</p> : null}
              <Button className="w-full bg-blue-600 text-white hover:bg-blue-700" type="submit">
                Sign in
              </Button>
              <button
                type="button"
                className="w-full text-sm text-blue-700"
                onClick={() => {
                  setAuthStage("signup-account");
                  setAuthForm((p) => ({
                    ...p,
                    fullName: "",
                    password: "",
                    workspaceName: "",
                    workspaceUsername: "",
                    invitationToken: "",
                    loginTicket: "",
                  }));
                }}
              >
                Need an account? Start onboarding
              </button>
            </form>
          ) : null}

          {authStage === "signup-account" ? (
            <form className="mt-4 space-y-3" onSubmit={signupAccount}>
              <Input
                placeholder="Full name"
                value={authForm.fullName}
                onChange={(e) =>
                  setAuthForm((p) => ({ ...p, fullName: e.target.value }))
                }
                required
              />
              <Input
                type="email"
                placeholder="Email"
                value={authForm.email}
                onChange={(e) =>
                  setAuthForm((p) => ({ ...p, email: e.target.value }))
                }
                required
              />
              <Input
                type="password"
                placeholder="Password (min 6 chars)"
                value={authForm.password}
                onChange={(e) =>
                  setAuthForm((p) => ({ ...p, password: e.target.value }))
                }
                required
              />
              {authError ? <p className="text-sm text-red-600">{authError}</p> : null}
              <Button className="w-full bg-blue-600 text-white hover:bg-blue-700" type="submit">
                Continue
              </Button>
              <button
                type="button"
                className="w-full text-sm text-slate-600"
                onClick={() => setAuthStage("login")}
              >
                Back to sign in
              </button>
            </form>
          ) : null}

          {authStage === "signup-choice" ? (
            <div className="mt-4 space-y-3">
              <button
                type="button"
                className="w-full rounded-lg border border-slate-200 p-4 text-left hover:border-blue-300"
                onClick={() => setAuthStage("signup-create")}
              >
                <p className="text-sm font-medium text-slate-900">Create a workspace</p>
                <p className="mt-1 text-xs text-slate-500">Start fresh and become the owner.</p>
              </button>
              <button
                type="button"
                className="w-full rounded-lg border border-slate-200 p-4 text-left hover:border-blue-300"
                onClick={() => setAuthStage("signup-join")}
              >
                <p className="text-sm font-medium text-slate-900">Join via invitation</p>
                <p className="mt-1 text-xs text-slate-500">Use an invite token from your team.</p>
              </button>
              {authError ? <p className="text-sm text-red-600">{authError}</p> : null}
            </div>
          ) : null}

          {authStage === "signup-create" ? (
            <form className="mt-4 space-y-3" onSubmit={createWorkspaceFromSignup}>
              <Input
                placeholder="Workspace name"
                value={authForm.workspaceName}
                onChange={(e) =>
                  setAuthForm((p) => ({ ...p, workspaceName: e.target.value }))
                }
                required
              />
              <Input
                placeholder="Workspace username (e.g. develari)"
                value={authForm.workspaceUsername}
                onChange={(e) =>
                  setAuthForm((p) => ({
                    ...p,
                    workspaceUsername: e.target.value.toLowerCase(),
                  }))
                }
                required
              />
              {authError ? <p className="text-sm text-red-600">{authError}</p> : null}
              <Button className="w-full bg-blue-600 text-white hover:bg-blue-700" type="submit">
                Create workspace
              </Button>
              <button
                type="button"
                className="w-full text-sm text-slate-600"
                onClick={() => setAuthStage("signup-choice")}
              >
                Back
              </button>
            </form>
          ) : null}

          {authStage === "signup-join" ? (
            <form className="mt-4 space-y-3" onSubmit={joinWorkspaceFromSignup}>
              <Input
                placeholder="Invitation token"
                value={authForm.invitationToken}
                onChange={(e) =>
                  setAuthForm((p) => ({ ...p, invitationToken: e.target.value }))
                }
                required
              />
              {invitationInfo ? (
                <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                  <p className="text-sm font-medium text-green-800">
                    Joining: {invitationInfo.tenantName}
                  </p>
                  <p className="text-xs text-green-700">
                    @{invitationInfo.workspaceUsername} · Role: {invitationInfo.role}
                  </p>
                </div>
              ) : null}
              {authError ? <p className="text-sm text-red-600">{authError}</p> : null}
              <Button className="w-full bg-blue-600 text-white hover:bg-blue-700" type="submit">
                Accept invitation
              </Button>
              <button
                type="button"
                className="w-full text-sm text-slate-600"
                onClick={() => setAuthStage("signup-choice")}
              >
                Back
              </button>
            </form>
          ) : null}

          {authStage === "workspace-picker" ? (
            <div className="mt-4 space-y-3">
              {(workspaceChoices || []).map((workspace) => (
                <button
                  key={workspace.id}
                  type="button"
                  className="w-full rounded-lg border border-slate-200 p-4 text-left hover:border-blue-300"
                  onClick={() => pickWorkspaceAfterLogin(workspace.workspaceUsername)}
                >
                  <p className="text-sm font-medium text-slate-900">{workspace.name}</p>
                  <p className="text-xs text-slate-500">
                    @{workspace.workspaceUsername} · {workspace.role}
                  </p>
                </button>
              ))}
              {authError ? <p className="text-sm text-red-600">{authError}</p> : null}
              <button
                type="button"
                className="w-full text-sm text-slate-600"
                onClick={() => setAuthStage("login")}
              >
                Back to sign in
              </button>
            </div>
          ) : null}
        </div>

        <aside className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-5 md:mt-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Flow</p>
          <h3 className="mt-2 text-base font-semibold text-slate-900">{STEP_LABELS[authStage]}</h3>
          <p className="mt-2 text-sm text-slate-600">
            Account is global. Workspaces are tenant memberships. Workspace usernames are immutable
            references like <span className="font-medium">@develari</span>.
          </p>
        </aside>
      </div>
    </div>
  );
}
