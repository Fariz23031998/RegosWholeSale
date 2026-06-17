/** POS sidebar / receipt compat derived from API user */

const COLORS = [
  "#4f46e5",
  "#7c3aed",
  "#0891b2",
  "#059669",
  "#d97706",
  "#dc2626",
  "#db2777",
];

export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function colorFromId(id: number): string {
  return COLORS[Math.abs(id) % COLORS.length];
}

export type SessionDisplay = {
  id: string;
  name: string;
  initials: string;
  color: string;
  role: string;
};

export function sessionFromUser(user: {
  id: number;
  display_name: string;
  role: string;
}): SessionDisplay {
  return {
    id: String(user.id),
    name: user.display_name,
    initials: initialsFromName(user.display_name),
    color: colorFromId(user.id),
    role: user.role,
  };
}
