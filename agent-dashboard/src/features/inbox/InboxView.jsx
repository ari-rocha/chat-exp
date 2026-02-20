import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bell, CheckCheck, MessageSquare } from "lucide-react";

export default function InboxView({
  notifications,
  unreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  openConversationFromNotification,
  formatTime,
}) {
  return (
    <section className="crm-main grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-[#f8f9fb]">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <Bell size={16} className="text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-900">Inbox</h2>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
            {unreadCount} unread
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          onClick={markAllNotificationsRead}
          disabled={unreadCount === 0}
        >
          <CheckCheck size={13} />
          Mark all as read
        </Button>
      </header>

      <ScrollArea className="h-full p-3">
        <div className="space-y-2">
          {notifications.map((notification) => {
            const isUnread = !notification.readAt;
            return (
              <article
                key={notification.id}
                className={`rounded-xl border bg-white p-3 ${
                  isUnread
                    ? "border-blue-200 shadow-[0_1px_0_rgba(59,130,246,0.08)]"
                    : "border-slate-200"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">
                      {notification.title || "Notification"}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-600">
                      {notification.body || ""}
                    </p>
                    <p className="mt-2 text-[11px] text-slate-400">
                      {formatTime(notification.createdAt)}
                    </p>
                  </div>
                  {isUnread ? (
                    <span className="mt-0.5 inline-flex h-2 w-2 rounded-full bg-blue-500" />
                  ) : null}
                </div>
                <div className="mt-3 flex items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    onClick={() => openConversationFromNotification(notification)}
                  >
                    <MessageSquare size={12} />
                    Open conversation
                  </Button>
                  {isUnread ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 text-[11px]"
                      onClick={() => markNotificationRead(notification.id)}
                    >
                      Mark as read
                    </Button>
                  ) : null}
                </div>
              </article>
            );
          })}
          {notifications.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center">
              <p className="text-sm font-medium text-slate-700">No notifications yet</p>
              <p className="mt-1 text-xs text-slate-500">
                Mentions in internal notes will show up here.
              </p>
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </section>
  );
}
