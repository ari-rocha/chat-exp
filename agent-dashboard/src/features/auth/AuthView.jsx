import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export default function AuthView({
  authMode,
  authForm,
  setAuthForm,
  authError,
  submitAuth,
  setAuthMode,
}) {
  const [joinMode, setJoinMode] = useState("create"); // "create" | "invite"
  const [invitationInfo, setInvitationInfo] = useState(null);

  // Look up invitation info when token changes
  useEffect(() => {
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
  }, [authForm.invitationToken]);

  return (
    <div className="grid min-h-screen place-items-center bg-slate-100 p-6">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">
          {authMode === "register" ? "Create your account" : "Welcome back"}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {authMode === "register"
            ? "Set up your agent account and workspace."
            : "Sign in to your workspace."}
        </p>

        <form className="mt-4 space-y-3" onSubmit={submitAuth}>
          {authMode === "register" && (
            <>
              <Input
                placeholder="Full name"
                value={authForm.name}
                onChange={(e) =>
                  setAuthForm((p) => ({ ...p, name: e.target.value }))
                }
                required
              />

              {/* Join mode toggle */}
              <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setJoinMode("create");
                    setAuthForm((p) => ({ ...p, invitationToken: "" }));
                  }}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    joinMode === "create"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Create workspace
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setJoinMode("invite");
                    setAuthForm((p) => ({ ...p, workspaceName: "" }));
                  }}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    joinMode === "invite"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Join via invitation
                </button>
              </div>

              {joinMode === "create" && (
                <Input
                  placeholder="Workspace name"
                  value={authForm.workspaceName || ""}
                  onChange={(e) =>
                    setAuthForm((p) => ({
                      ...p,
                      workspaceName: e.target.value,
                    }))
                  }
                />
              )}

              {joinMode === "invite" && (
                <>
                  <Input
                    placeholder="Invitation token"
                    value={authForm.invitationToken || ""}
                    onChange={(e) =>
                      setAuthForm((p) => ({
                        ...p,
                        invitationToken: e.target.value,
                      }))
                    }
                  />
                  {invitationInfo && (
                    <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                      <p className="text-sm font-medium text-green-800">
                        Joining: {invitationInfo.tenantName}
                      </p>
                      <p className="text-xs text-green-600">
                        Role: {invitationInfo.role} · {invitationInfo.email}
                      </p>
                    </div>
                  )}
                </>
              )}
            </>
          )}
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
          {authError && <p className="text-sm text-red-600">{authError}</p>}
          <Button
            className="w-full bg-blue-600 text-white hover:bg-blue-700"
            type="submit"
          >
            {authMode === "register" ? "Create account" : "Sign in"}
          </Button>
        </form>

        <button
          className="mt-4 text-sm text-blue-700"
          onClick={() =>
            setAuthMode((m) => (m === "register" ? "login" : "register"))
          }
        >
          {authMode === "register"
            ? "Already have an account? Sign in"
            : "Need an account? Register"}
        </button>
      </div>
    </div>
  );
}
