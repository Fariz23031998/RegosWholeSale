import { create } from "zustand";

type NotificationsState = {
  unreadFailedIds: Set<string>;
  markRead: (localId: string) => void;
  markAllRead: (localIds: string[]) => void;
  markUnread: (localId: string) => void;
  clear: () => void;
};

export const useNotifications = create<NotificationsState>((set, get) => ({
  unreadFailedIds: new Set(),

  markRead: (localId) => {
    const next = new Set(get().unreadFailedIds);
    next.delete(localId);
    set({ unreadFailedIds: next });
  },

  markAllRead: (localIds) => {
    const next = new Set(get().unreadFailedIds);
    for (const id of localIds) next.delete(id);
    set({ unreadFailedIds: next });
  },

  markUnread: (localId) => {
    const next = new Set(get().unreadFailedIds);
    next.add(localId);
    set({ unreadFailedIds: next });
  },

  clear: () => set({ unreadFailedIds: new Set() }),
}));

export function unreadFailedCount(
  failedLocalIds: string[],
  unreadFailedIds: Set<string>,
): number {
  return failedLocalIds.filter((id) => unreadFailedIds.has(id)).length;
}
