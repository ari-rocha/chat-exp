import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const VIEWS = [
  ["conversations", "Conversations"],
  ["flows", "Flow Builder"],
  ["contacts", "Contacts"],
  ["customization", "Customization"],
  ["csat", "CSAT"],
];

export default function TopBar({ view, setView, agent, theme, setTheme, logout }) {
  return (
    <header className="agent-topbar flex items-center justify-between border-b px-4">
      <div className="flex items-center gap-3">
        <div className="hidden h-8 items-center rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 max-[980px]:hidden sm:flex">
          Workspace
        </div>
        {VIEWS.map(([id, label]) => (
          <Button key={id} variant={view === id ? "default" : "outline"} size="sm" onClick={() => setView(id)}>
            {label}
          </Button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Badge variant="secondary">{agent?.status || "offline"}</Badge>
        <Button size="sm" variant="outline" onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}>
          {theme === "dark" ? "Light" : "Dark"}
        </Button>
        <Button size="sm" variant="outline" onClick={logout}>
          Logout
        </Button>
      </div>
    </header>
  );
}
