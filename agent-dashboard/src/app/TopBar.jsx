import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const VIEWS = [
  ["conversations", "Conversations"],
  ["flows", "Flow Builder"],
  ["contacts", "Contacts"],
  ["csat", "CSAT"],
];

export default function TopBar({
  view,
  setView,
  agent,
  theme,
  setTheme,
  logout,
  onOpenSettings,
}) {
  return (
    <header className="agent-topbar flex items-center justify-between border-b px-4">
      <div className="flex items-center gap-3">
        <div className="hidden h-8 items-center rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 max-[980px]:hidden sm:flex">
          Workspace
        </div>
        {VIEWS.map(([id, label]) => (
          <Button
            key={id}
            variant={view === id ? "default" : "outline"}
            size="sm"
            onClick={() => setView(id)}
          >
            {label}
          </Button>
        ))}
        <Button variant="outline" size="sm" onClick={() => onOpenSettings?.()}>
          Settings
        </Button>
      </div>

      <div className="flex items-center gap-2">
        {agent?.role && (
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              agent.role === "owner"
                ? "bg-amber-100 text-amber-800"
                : agent.role === "admin"
                  ? "bg-blue-100 text-blue-800"
                  : "bg-slate-100 text-slate-600"
            }`}
          >
            {agent.role.charAt(0).toUpperCase() + agent.role.slice(1)}
          </span>
        )}
        <Badge variant="secondary">{agent?.status || "offline"}</Badge>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            setTheme((prev) => (prev === "dark" ? "light" : "dark"))
          }
        >
          {theme === "dark" ? "Light" : "Dark"}
        </Button>
        <Button size="sm" variant="outline" onClick={logout}>
          Logout
        </Button>
      </div>
    </header>
  );
}
