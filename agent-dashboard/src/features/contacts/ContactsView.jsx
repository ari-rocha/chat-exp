import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function ContactsView({ contacts, newContact, setNewContact, createContact }) {
  return (
    <div className="grid min-h-0 grid-cols-[340px_1fr] gap-4 bg-slate-50 p-4 max-[1000px]:grid-cols-[1fr]">
      <aside className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">Create contact</h3>
        <p className="mb-3 text-xs text-slate-500">Contacts are scoped to the current tenant/workspace.</p>
        <form className="space-y-2" onSubmit={createContact}>
          <Input
            value={newContact.displayName}
            onChange={(e) => setNewContact((prev) => ({ ...prev, displayName: e.target.value }))}
            placeholder="Display name"
          />
          <Input
            value={newContact.email}
            onChange={(e) => setNewContact((prev) => ({ ...prev, email: e.target.value }))}
            placeholder="Email"
          />
          <Input
            value={newContact.phone}
            onChange={(e) => setNewContact((prev) => ({ ...prev, phone: e.target.value }))}
            placeholder="Phone"
          />
          <Button type="submit" className="w-full bg-blue-600 text-white hover:bg-blue-700">
            Save contact
          </Button>
        </form>
      </aside>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Contacts ({contacts.length})</h3>
        <ScrollArea className="h-[calc(100vh-170px)]">
          <div className="space-y-2 pr-2">
            {contacts.map((contact) => (
              <article key={contact.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm font-medium text-slate-900">{contact.displayName || "Unnamed contact"}</p>
                <p className="text-xs text-slate-600">{contact.email || "No email"}</p>
                <p className="text-xs text-slate-500">{contact.phone || "No phone"}</p>
              </article>
            ))}
            {contacts.length === 0 && <p className="text-xs text-slate-400">No contacts yet.</p>}
          </div>
        </ScrollArea>
      </section>
    </div>
  );
}
