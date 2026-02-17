import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export default function CustomizationView({ tenantSettings, setTenantSettings, saveTenantSettings, tenants }) {
  return (
    <div className="grid h-full min-h-0 grid-cols-[1fr_320px] gap-4 bg-slate-50 p-4 max-[1080px]:grid-cols-[1fr]">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Workspace customization</h3>
        <p className="mb-3 text-xs text-slate-500">Configure branding and widget behavior for this tenant.</p>
        <div className="grid gap-2">
          <Input
            value={tenantSettings?.brandName || ""}
            onChange={(e) => setTenantSettings((prev) => ({ ...(prev || {}), brandName: e.target.value }))}
            placeholder="Brand name"
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={tenantSettings?.primaryColor || ""}
              onChange={(e) => setTenantSettings((prev) => ({ ...(prev || {}), primaryColor: e.target.value }))}
              placeholder="Primary color (#hex)"
            />
            <Input
              value={tenantSettings?.accentColor || ""}
              onChange={(e) => setTenantSettings((prev) => ({ ...(prev || {}), accentColor: e.target.value }))}
              placeholder="Accent color (#hex)"
            />
          </div>
          <Input
            value={tenantSettings?.logoUrl || ""}
            onChange={(e) => setTenantSettings((prev) => ({ ...(prev || {}), logoUrl: e.target.value }))}
            placeholder="Logo URL"
          />
          <Input
            value={tenantSettings?.privacyUrl || ""}
            onChange={(e) => setTenantSettings((prev) => ({ ...(prev || {}), privacyUrl: e.target.value }))}
            placeholder="Privacy URL"
          />
          <Textarea
            rows={3}
            value={tenantSettings?.welcomeText || ""}
            onChange={(e) => setTenantSettings((prev) => ({ ...(prev || {}), welcomeText: e.target.value }))}
            placeholder="Welcome text"
          />
          <Button className="w-full bg-blue-600 text-white hover:bg-blue-700" onClick={saveTenantSettings}>
            Save customization
          </Button>
        </div>
      </section>
      <aside className="rounded-xl border border-slate-200 bg-white p-4">
        <h4 className="text-sm font-semibold text-slate-900">Tenant</h4>
        <div className="mt-3 space-y-2">
          {tenants.map((tenant) => (
            <div key={tenant.id} className="rounded-md border border-slate-200 bg-slate-50 p-2">
              <p className="text-sm font-medium text-slate-900">{tenant.name}</p>
              <p className="text-xs text-slate-500">{tenant.slug}</p>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
