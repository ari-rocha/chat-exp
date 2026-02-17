import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function AuthView({ authMode, authForm, setAuthForm, authError, submitAuth, setAuthMode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-100 p-6">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">
          {authMode === "register" ? "Create Agent Account" : "Agent Sign In"}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Access your inboxes, teams and flow automations.
        </p>

        <form className="mt-4 space-y-3" onSubmit={submitAuth}>
          {authMode === "register" && (
            <Input
              placeholder="Full name"
              value={authForm.name}
              onChange={(e) => setAuthForm((p) => ({ ...p, name: e.target.value }))}
              required
            />
          )}
          <Input
            type="email"
            placeholder="Email"
            value={authForm.email}
            onChange={(e) => setAuthForm((p) => ({ ...p, email: e.target.value }))}
            required
          />
          <Input
            type="password"
            placeholder="Password"
            value={authForm.password}
            onChange={(e) => setAuthForm((p) => ({ ...p, password: e.target.value }))}
            required
          />
          {authError && <p className="text-sm text-red-600">{authError}</p>}
          <Button className="w-full bg-blue-600 text-white hover:bg-blue-700" type="submit">
            {authMode === "register" ? "Register" : "Login"}
          </Button>
        </form>

        <button
          className="mt-4 text-sm text-blue-700"
          onClick={() => setAuthMode((m) => (m === "register" ? "login" : "register"))}
        >
          {authMode === "register"
            ? "Already have an account? Login"
            : "Need an account? Register"}
        </button>
      </div>
    </div>
  );
}
