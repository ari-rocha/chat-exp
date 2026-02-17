import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Building2,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Plus,
  Search,
  Tag,
  Trash2,
  User,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

export default function ContactsView({
  contacts,
  newContact,
  setNewContact,
  createContact,
  deleteContact,
  patchContact,
  tags,
  apiFetch,
  token,
  formatTime,
}) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [contactAttrs, setContactAttrs] = useState([]);
  const [contactConvos, setContactConvos] = useState([]);
  const [newAttrKey, setNewAttrKey] = useState("");
  const [newAttrValue, setNewAttrValue] = useState("");
  const [detailTab, setDetailTab] = useState("details");

  const selected = contacts.find((c) => c.id === selectedId) ?? null;

  const filtered = contacts.filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (c.displayName || "").toLowerCase().includes(q) ||
      (c.email || "").toLowerCase().includes(q) ||
      (c.phone || "").includes(q) ||
      (c.company || "").toLowerCase().includes(q)
    );
  });

  // Load attributes & conversations when selection changes
  useEffect(() => {
    if (!selectedId || !token) {
      setContactAttrs([]);
      setContactConvos([]);
      return;
    }
    apiFetch(`/api/contacts/${selectedId}/attributes`, token).then((res) =>
      setContactAttrs(res.attributes ?? []),
    );
    apiFetch(`/api/contacts/${selectedId}/conversations`, token).then((res) =>
      setContactConvos(res.conversations ?? []),
    );
  }, [selectedId, token]);

  const saveAttr = async () => {
    if (!newAttrKey.trim() || !selectedId) return;
    await apiFetch(`/api/contacts/${selectedId}/attributes`, token, {
      method: "POST",
      body: JSON.stringify({
        attributeKey: newAttrKey.trim(),
        attributeValue: newAttrValue,
      }),
    });
    const res = await apiFetch(`/api/contacts/${selectedId}/attributes`, token);
    setContactAttrs(res.attributes ?? []);
    setNewAttrKey("");
    setNewAttrValue("");
  };

  const deleteAttr = async (key) => {
    await apiFetch(
      `/api/contacts/${selectedId}/attributes/${encodeURIComponent(key)}`,
      token,
      {
        method: "DELETE",
      },
    );
    setContactAttrs((prev) => prev.filter((a) => a.attributeKey !== key));
  };

  const handleFieldBlur = async (field, value) => {
    if (!selectedId) return;
    await patchContact(selectedId, { [field]: value });
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-[320px_1fr] bg-slate-50 max-[900px]:grid-cols-[1fr]">
      {/* ── Left: contact list ─────────────────────────────── */}
      <aside className="flex min-h-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Contacts</h3>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
              {contacts.length}
            </span>
          </div>
          <div className="relative">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search contacts…"
              className="h-8 pl-8 text-xs"
            />
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {filtered.map((contact) => (
              <button
                key={contact.id}
                onClick={() => {
                  setSelectedId(contact.id);
                  setDetailTab("details");
                }}
                className={`w-full rounded-lg border p-2.5 text-left transition ${
                  selectedId === contact.id
                    ? "border-blue-200 bg-blue-50"
                    : "border-transparent hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-fuchsia-100 text-[11px] font-semibold text-fuchsia-700">
                    {(contact.displayName || contact.email || "?")
                      .slice(0, 2)
                      .toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {contact.displayName || "Unnamed contact"}
                    </p>
                    <p className="truncate text-[11px] text-slate-500">
                      {contact.email || contact.phone || "No email"}
                    </p>
                  </div>
                </div>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="py-6 text-center text-xs text-slate-400">
                No contacts found.
              </p>
            )}
          </div>
        </ScrollArea>

        {/* Quick create */}
        <div className="border-t border-slate-200 p-3">
          <form className="space-y-1.5" onSubmit={createContact}>
            <Input
              value={newContact.displayName}
              onChange={(e) =>
                setNewContact((p) => ({ ...p, displayName: e.target.value }))
              }
              placeholder="Name"
              className="h-8 text-xs"
            />
            <div className="grid grid-cols-2 gap-1.5">
              <Input
                value={newContact.email}
                onChange={(e) =>
                  setNewContact((p) => ({ ...p, email: e.target.value }))
                }
                placeholder="Email"
                className="h-8 text-xs"
              />
              <Input
                value={newContact.phone}
                onChange={(e) =>
                  setNewContact((p) => ({ ...p, phone: e.target.value }))
                }
                placeholder="Phone"
                className="h-8 text-xs"
              />
            </div>
            <Button
              type="submit"
              className="h-8 w-full bg-blue-600 text-xs text-white hover:bg-blue-700"
            >
              <Plus size={13} /> Add contact
            </Button>
          </form>
        </div>
      </aside>

      {/* ── Right: detail panel ────────────────────────────── */}
      {selected ? (
        <div className="flex min-h-0 flex-col">
          {/* Header */}
          <header className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-fuchsia-100 text-sm font-semibold text-fuchsia-700">
                {(selected.displayName || selected.email || "?")
                  .slice(0, 2)
                  .toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {selected.displayName || "Unnamed contact"}
                </p>
                <p className="text-[11px] text-slate-500">
                  {selected.email || "No email"}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 rounded-md px-2 text-[11px] text-red-600 hover:bg-red-50 hover:text-red-700"
              onClick={() => {
                deleteContact(selected.id);
                setSelectedId(null);
              }}
            >
              <Trash2 size={12} /> Delete
            </Button>
          </header>

          {/* Tabs */}
          <div className="flex border-b border-slate-200 bg-white px-5">
            {["details", "attributes", "conversations"].map((tab) => (
              <button
                key={tab}
                onClick={() => setDetailTab(tab)}
                className={`border-b-2 px-3 py-2 text-xs font-medium capitalize transition ${
                  detailTab === tab
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <ScrollArea className="flex-1 bg-white">
            <div className="p-5">
              {detailTab === "details" && (
                <div className="space-y-4">
                  <EditableField
                    icon={<User size={14} />}
                    label="Name"
                    value={selected.displayName}
                    onSave={(v) => handleFieldBlur("displayName", v)}
                  />
                  <EditableField
                    icon={<Mail size={14} />}
                    label="Email"
                    value={selected.email}
                    onSave={(v) => handleFieldBlur("email", v)}
                  />
                  <EditableField
                    icon={<Phone size={14} />}
                    label="Phone"
                    value={selected.phone}
                    onSave={(v) => handleFieldBlur("phone", v)}
                  />
                  <EditableField
                    icon={<Building2 size={14} />}
                    label="Company"
                    value={selected.company}
                    onSave={(v) => handleFieldBlur("company", v)}
                  />
                  <EditableField
                    icon={<MapPin size={14} />}
                    label="Location"
                    value={selected.location}
                    onSave={(v) => handleFieldBlur("location", v)}
                  />

                  <Separator />

                  <div className="space-y-1 text-xs text-slate-500">
                    <p>
                      <span className="font-medium text-slate-700">ID:</span>{" "}
                      <span className="break-all">{selected.id}</span>
                    </p>
                    <p>
                      <span className="font-medium text-slate-700">
                        Created:
                      </span>{" "}
                      {formatTime
                        ? formatTime(selected.createdAt)
                        : selected.createdAt}
                    </p>
                    {selected.lastSeenAt && (
                      <p>
                        <span className="font-medium text-slate-700">
                          Last seen:
                        </span>{" "}
                        {formatTime
                          ? formatTime(selected.lastSeenAt)
                          : selected.lastSeenAt}
                      </p>
                    )}
                    {selected.browser && (
                      <p>
                        <span className="font-medium text-slate-700">
                          Browser:
                        </span>{" "}
                        {selected.browser}
                      </p>
                    )}
                    {selected.os && (
                      <p>
                        <span className="font-medium text-slate-700">OS:</span>{" "}
                        {selected.os}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {detailTab === "attributes" && (
                <div className="space-y-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Custom attributes
                  </p>
                  <div className="space-y-2">
                    {contactAttrs.map((attr) => (
                      <div
                        key={attr.attributeKey}
                        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                      >
                        <Tag size={12} className="shrink-0 text-slate-400" />
                        <span className="text-xs font-medium text-slate-700">
                          {attr.attributeKey}
                        </span>
                        <span className="text-xs text-slate-400">=</span>
                        <span className="flex-1 truncate text-xs text-slate-900">
                          {attr.attributeValue}
                        </span>
                        <button
                          onClick={() => deleteAttr(attr.attributeKey)}
                          className="text-slate-400 hover:text-red-500"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                    {contactAttrs.length === 0 && (
                      <p className="text-xs text-slate-400">
                        No custom attributes yet.
                      </p>
                    )}
                  </div>

                  <Separator />

                  <div className="flex items-end gap-2">
                    <div className="flex-1 space-y-1">
                      <label className="text-[10px] font-medium text-slate-500">
                        Key
                      </label>
                      <Input
                        value={newAttrKey}
                        onChange={(e) => setNewAttrKey(e.target.value)}
                        placeholder="e.g. plan"
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="flex-1 space-y-1">
                      <label className="text-[10px] font-medium text-slate-500">
                        Value
                      </label>
                      <Input
                        value={newAttrValue}
                        onChange={(e) => setNewAttrValue(e.target.value)}
                        placeholder="e.g. enterprise"
                        className="h-8 text-xs"
                      />
                    </div>
                    <Button
                      onClick={saveAttr}
                      disabled={!newAttrKey.trim()}
                      className="h-8 bg-blue-600 px-3 text-xs text-white hover:bg-blue-700"
                    >
                      <Plus size={13} /> Add
                    </Button>
                  </div>
                </div>
              )}

              {detailTab === "conversations" && (
                <div className="space-y-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Linked conversations ({contactConvos.length})
                  </p>
                  {contactConvos.map((conv) => (
                    <div
                      key={conv.id}
                      className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <MessageCircle size={13} className="text-slate-400" />
                          <span className="text-xs font-medium text-slate-900">
                            {conv.id.slice(0, 8)}…
                          </span>
                        </div>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${
                            conv.status === "open"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : conv.status === "closed"
                                ? "border-slate-200 bg-slate-100 text-slate-500"
                                : "border-amber-200 bg-amber-50 text-amber-700"
                          }`}
                        >
                          {conv.status}
                        </Badge>
                      </div>
                      {conv.lastMessage && (
                        <p className="mt-1.5 truncate text-[11px] text-slate-500">
                          {conv.lastMessage.text}
                        </p>
                      )}
                      <p className="mt-1 text-[10px] text-slate-400">
                        {formatTime
                          ? formatTime(conv.updatedAt)
                          : conv.updatedAt}
                        {" • "}
                        {conv.messageCount} messages
                      </p>
                    </div>
                  ))}
                  {contactConvos.length === 0 && (
                    <p className="text-xs text-slate-400">
                      No conversations linked to this contact.
                    </p>
                  )}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      ) : (
        <div className="flex items-center justify-center bg-white">
          <div className="text-center">
            <User size={32} className="mx-auto mb-2 text-slate-300" />
            <p className="text-sm text-slate-500">
              Select a contact to view details
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/** Inline-editable field row */
function EditableField({ icon, label, value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");

  useEffect(() => setDraft(value || ""), [value]);

  const commit = () => {
    setEditing(false);
    if (draft !== (value || "")) onSave(draft);
  };

  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-slate-400">{icon}</span>
      <div className="flex-1">
        <p className="text-[10px] uppercase tracking-wide text-slate-400">
          {label}
        </p>
        {editing ? (
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === "Enter" && commit()}
            autoFocus
            className="mt-0.5 h-7 text-xs"
          />
        ) : (
          <p
            className="mt-0.5 cursor-pointer rounded px-1 py-0.5 text-xs text-slate-900 hover:bg-slate-100"
            onClick={() => setEditing(true)}
          >
            {value || <span className="text-slate-400">—</span>}
          </p>
        )}
      </div>
    </div>
  );
}
