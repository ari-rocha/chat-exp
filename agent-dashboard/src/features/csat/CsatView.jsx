import { ScrollArea } from "@/components/ui/scroll-area";

const formatTime = (iso) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

export default function CsatView({ csatReport }) {
  return (
    <div className="grid h-full min-h-0 grid-cols-[320px_1fr] gap-4 bg-slate-50 p-4 max-[1080px]:grid-cols-[1fr]">
      <aside className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">CSAT Overview</h3>
        <div className="mt-3 space-y-2">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs text-slate-500">Responses</p>
            <p className="text-2xl font-semibold text-slate-900">{csatReport.count || 0}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs text-slate-500">Average score</p>
            <p className="text-2xl font-semibold text-slate-900">{Number(csatReport.average || 0).toFixed(2)}</p>
          </div>
        </div>
      </aside>
      <section className="grid min-h-0 grid-rows-[auto_1fr] rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">CSAT submissions</h3>
        <ScrollArea className="h-full">
          <div className="space-y-2 pr-2">
            {(csatReport.surveys || []).map((survey) => (
              <article key={survey.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm font-semibold text-slate-900">Score: {survey.score}/5</p>
                <p className="text-xs text-slate-600">{survey.comment || "No comment"}</p>
                <p className="text-[11px] text-slate-400">{formatTime(survey.submittedAt)}</p>
              </article>
            ))}
            {(csatReport.surveys || []).length === 0 && (
              <p className="text-xs text-slate-400">No CSAT submissions yet.</p>
            )}
          </div>
        </ScrollArea>
      </section>
    </div>
  );
}
