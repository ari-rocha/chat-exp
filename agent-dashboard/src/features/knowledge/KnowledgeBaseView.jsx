import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { BookOpenText, FileText, Plus, Search, Tag } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export default function KnowledgeBaseView({ apiFetch, token }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [collections, setCollections] = useState([]);
  const [articles, setArticles] = useState([]);
  const [tags, setTags] = useState([]);

  const [collectionName, setCollectionName] = useState("");
  const [collectionDescription, setCollectionDescription] = useState("");
  const [selectedCollectionId, setSelectedCollectionId] = useState("");

  const [selectedArticleId, setSelectedArticleId] = useState("");
  const [editorTitle, setEditorTitle] = useState("");
  const [editorMarkdown, setEditorMarkdown] = useState("");

  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#3b82f6");
  const [newTagDescription, setNewTagDescription] = useState("");
  const [attachTagId, setAttachTagId] = useState("");

  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchHits, setSearchHits] = useState([]);

  const loadKb = async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const [collectionsRes, articlesRes, tagsRes] = await Promise.all([
        apiFetch("/api/kb/collections", token),
        apiFetch("/api/kb/articles", token),
        apiFetch("/api/kb/tags", token),
      ]);
      const nextCollections = collectionsRes.collections ?? [];
      const nextArticles = articlesRes.articles ?? [];
      setCollections(nextCollections);
      setArticles(nextArticles);
      setTags(tagsRes.tags ?? []);

      if (!selectedCollectionId && nextCollections.length > 0) {
        setSelectedCollectionId(nextCollections[0].id);
      }
    } catch (err) {
      setError(err.message || "Failed to load knowledge base");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadKb().catch((err) => console.error("kb load failed", err));
  }, [token]);

  const selectedArticle = useMemo(
    () => articles.find((a) => a.id === selectedArticleId) ?? null,
    [articles, selectedArticleId],
  );

  const filteredArticles = useMemo(() => {
    if (!selectedCollectionId) return articles;
    return articles.filter((a) => a.collectionId === selectedCollectionId);
  }, [articles, selectedCollectionId]);

  const openArticle = async (articleId) => {
    if (!articleId) return;
    setError("");
    try {
      const res = await apiFetch(`/api/kb/articles/${articleId}`, token);
      const article = res.article;
      if (!article) return;
      setSelectedArticleId(article.id);
      setSelectedCollectionId(article.collectionId || "");
      setEditorTitle(article.title || "");
      setEditorMarkdown(article.markdown || "");
      setArticles((prev) => prev.map((item) => (item.id === article.id ? article : item)));
    } catch (err) {
      setError(err.message);
    }
  };

  const createCollection = async (e) => {
    e.preventDefault();
    if (!collectionName.trim()) return;
    setError("");
    try {
      const res = await apiFetch("/api/kb/collections", token, {
        method: "POST",
        body: JSON.stringify({
          name: collectionName.trim(),
          description: collectionDescription.trim(),
        }),
      });
      const collection = res.collection;
      if (!collection) return;
      setCollections((prev) => [...prev, collection]);
      setSelectedCollectionId(collection.id);
      setCollectionName("");
      setCollectionDescription("");
    } catch (err) {
      setError(err.message);
    }
  };

  const createArticle = async () => {
    if (!selectedCollectionId || !editorTitle.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch("/api/kb/articles", token, {
        method: "POST",
        body: JSON.stringify({
          collectionId: selectedCollectionId,
          title: editorTitle.trim(),
          markdown: editorMarkdown,
          status: "draft",
        }),
      });
      const article = res.article;
      if (!article) return;
      setArticles((prev) => [article, ...prev]);
      setSelectedArticleId(article.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const saveArticle = async () => {
    if (!selectedArticleId) return;
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch(`/api/kb/articles/${selectedArticleId}`, token, {
        method: "PATCH",
        body: JSON.stringify({
          collectionId: selectedCollectionId,
          title: editorTitle.trim(),
          markdown: editorMarkdown,
        }),
      });
      const article = res.article;
      if (!article) return;
      setArticles((prev) => prev.map((item) => (item.id === article.id ? article : item)));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const publishArticle = async () => {
    if (!selectedArticleId) return;
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch(`/api/kb/articles/${selectedArticleId}/publish`, token, {
        method: "POST",
      });
      const article = res.article;
      if (!article) return;
      setArticles((prev) => prev.map((item) => (item.id === article.id ? article : item)));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const unpublishArticle = async () => {
    if (!selectedArticleId) return;
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch(`/api/kb/articles/${selectedArticleId}/unpublish`, token, {
        method: "POST",
      });
      const article = res.article;
      if (!article) return;
      setArticles((prev) => prev.map((item) => (item.id === article.id ? article : item)));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteArticle = async () => {
    if (!selectedArticleId || !confirm("Delete this article?")) return;
    setSaving(true);
    setError("");
    try {
      await apiFetch(`/api/kb/articles/${selectedArticleId}`, token, { method: "DELETE" });
      const deleted = selectedArticleId;
      setArticles((prev) => prev.filter((item) => item.id !== deleted));
      setSelectedArticleId("");
      setEditorTitle("");
      setEditorMarkdown("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const createKbTag = async (e) => {
    e.preventDefault();
    if (!newTagName.trim()) return;
    setError("");
    try {
      const res = await apiFetch("/api/kb/tags", token, {
        method: "POST",
        body: JSON.stringify({
          name: newTagName.trim(),
          color: newTagColor,
          description: newTagDescription.trim(),
        }),
      });
      if (res.tag) {
        setTags((prev) => [...prev, res.tag]);
        setNewTagName("");
        setNewTagDescription("");
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const attachTagToCollection = async () => {
    if (!selectedCollectionId || !attachTagId) return;
    try {
      await apiFetch(`/api/kb/collections/${selectedCollectionId}/tags/${attachTagId}`, token, {
        method: "POST",
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const attachTagToArticle = async () => {
    if (!selectedArticleId || !attachTagId) return;
    try {
      await apiFetch(`/api/kb/articles/${selectedArticleId}/tags/${attachTagId}`, token, {
        method: "POST",
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const runSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    setError("");
    try {
      const res = await apiFetch("/api/kb/search", token, {
        method: "POST",
        body: JSON.stringify({
          query: searchQuery.trim(),
          topK: 8,
          collectionIds: selectedCollectionId ? [selectedCollectionId] : [],
          tagIds: [],
        }),
      });
      setSearchHits(res.hits ?? []);
    } catch (err) {
      setError(err.message);
      setSearchHits([]);
    } finally {
      setSearching(false);
    }
  };

  return (
    <section className="crm-main h-full min-h-0 bg-[#f8f9fb]">
      <div className="h-full min-h-0 grid grid-cols-[280px_1fr_320px] gap-3 p-3">
        <aside className="min-h-0 rounded-xl border border-slate-200 bg-white p-3 flex flex-col">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Knowledge</h3>
            <Button size="sm" variant="outline" onClick={() => loadKb()} disabled={loading}>
              {loading ? "..." : "Refresh"}
            </Button>
          </div>

          <div className="space-y-1 overflow-auto pr-1">
            {(collections || []).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedCollectionId(c.id)}
                className={`w-full rounded-lg px-2 py-1.5 text-left text-sm ${
                  selectedCollectionId === c.id
                    ? "bg-blue-50 text-blue-700"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>

          <form onSubmit={createCollection} className="mt-3 space-y-2 border-t border-slate-200 pt-3">
            <Input value={collectionName} onChange={(e) => setCollectionName(e.target.value)} placeholder="Collection name" />
            <Input
              value={collectionDescription}
              onChange={(e) => setCollectionDescription(e.target.value)}
              placeholder="Collection description"
            />
            <Button size="sm" type="submit" className="w-full">
              <Plus size={14} className="mr-1" />
              Add Collection
            </Button>
          </form>

          <div className="mt-3 border-t border-slate-200 pt-3 min-h-0 flex-1 flex flex-col">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Articles</p>
            <div className="min-h-0 flex-1 overflow-auto space-y-1 pr-1">
              {(filteredArticles || []).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => openArticle(a.id)}
                  className={`w-full rounded-lg border px-2 py-2 text-left ${
                    selectedArticleId === a.id
                      ? "border-blue-200 bg-blue-50"
                      : "border-transparent hover:border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-slate-800">{a.title}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {a.status}
                    </Badge>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <main className="min-h-0 rounded-xl border border-slate-200 bg-white p-3 flex flex-col">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BookOpenText size={16} className="text-slate-500" />
              <h3 className="text-sm font-semibold text-slate-900">Markdown Editor</h3>
            </div>
            {selectedArticle ? (
              <Badge variant="outline" className="text-[10px]">
                {selectedArticle.status}
              </Badge>
            ) : null}
          </div>

          <div className="space-y-2">
            <Input value={editorTitle} onChange={(e) => setEditorTitle(e.target.value)} placeholder="Article title" />
            <select
              value={selectedCollectionId}
              onChange={(e) => setSelectedCollectionId(e.target.value)}
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <option value="">Select collection...</option>
              {(collections || []).map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {collection.name}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-2 min-h-0 flex-1">
            <Textarea
              value={editorMarkdown}
              onChange={(e) => setEditorMarkdown(e.target.value)}
              placeholder="# Write markdown..."
              className="h-full min-h-[480px] resize-none font-mono text-sm"
            />
          </div>

          {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
        </main>

        <aside className="min-h-0 rounded-xl border border-slate-200 bg-white p-3 flex flex-col gap-3 overflow-auto">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Actions</p>
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" onClick={selectedArticleId ? saveArticle : createArticle} disabled={saving || !editorTitle.trim() || !selectedCollectionId}>
                {saving ? "Saving..." : selectedArticleId ? "Save" : "Create"}
              </Button>
              <Button size="sm" variant="outline" disabled={!selectedArticleId || saving} onClick={publishArticle}>
                Publish
              </Button>
              <Button size="sm" variant="outline" disabled={!selectedArticleId || saving} onClick={unpublishArticle}>
                Unpublish
              </Button>
              <Button size="sm" variant="outline" className="text-red-600" disabled={!selectedArticleId || saving} onClick={deleteArticle}>
                Delete
              </Button>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Tags</p>
            <form onSubmit={createKbTag} className="space-y-2">
              <Input value={newTagName} onChange={(e) => setNewTagName(e.target.value)} placeholder="Tag name" />
              <Input
                value={newTagDescription}
                onChange={(e) => setNewTagDescription(e.target.value)}
                placeholder="Tag description"
              />
              <div className="flex items-center gap-2">
                <input type="color" value={newTagColor} onChange={(e) => setNewTagColor(e.target.value)} className="h-9 w-12 rounded border border-slate-200" />
                <Button size="sm" type="submit" className="flex-1">
                  <Tag size={14} className="mr-1" />
                  Create Tag
                </Button>
              </div>
            </form>

            <div className="mt-2 flex items-center gap-2">
              <select
                value={attachTagId}
                onChange={(e) => setAttachTagId(e.target.value)}
                className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
              >
                <option value="">Attach existing tag...</option>
                {(tags || []).map((tag) => (
                  <option key={tag.id} value={tag.id}>{tag.name}</option>
                ))}
              </select>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button size="sm" variant="outline" disabled={!attachTagId || !selectedCollectionId} onClick={attachTagToCollection}>
                Tag Collection
              </Button>
              <Button size="sm" variant="outline" disabled={!attachTagId || !selectedArticleId} onClick={attachTagToArticle}>
                Tag Article
              </Button>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-3 min-h-0 flex flex-col">
            <form onSubmit={runSearch} className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">RAG Search</p>
              <div className="flex gap-2">
                <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search knowledge..." />
                <Button size="sm" type="submit" disabled={searching || !searchQuery.trim()}>
                  <Search size={14} />
                </Button>
              </div>
            </form>
            <div className="mt-2 min-h-0 flex-1 space-y-2 overflow-auto">
              {(searchHits || []).map((hit) => (
                <article key={hit.chunkId} className="rounded-md border border-slate-200 p-2">
                  <div className="flex items-center gap-1 text-xs text-slate-500">
                    <FileText size={11} />
                    <span className="font-medium text-slate-700">{hit.articleTitle}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">{hit.snippet}</p>
                </article>
              ))}
              {(searchHits || []).length === 0 ? (
                <p className="text-xs text-slate-400">No results.</p>
              ) : null}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
