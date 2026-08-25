import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Building2, CreditCard, KeyRound, LayoutDashboard, LogOut, Users } from "lucide-react";
import clsx from "clsx";
import { ApiError } from "@/lib/api";
import { ChangePasswordModal } from "@/components/ChangePasswordModal";
import { changePlatformPassword } from "@/lib/platform-api";
import { usePlatformAuth } from "@/store/platform-auth";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/companies", label: "Companies", icon: Building2 },
  { to: "/payments", label: "Payments", icon: CreditCard },
  { to: "/admins", label: "Admins", icon: Users },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logout = usePlatformAuth((s) => s.logout);
  const admin = usePlatformAuth((s) => s.admin);
  const accessToken = usePlatformAuth((s) => s.accessToken);
  const setSession = usePlatformAuth((s) => s.setSession);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  const changePasswordMutation = useMutation({
    mutationFn: ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) =>
      changePlatformPassword(accessToken!, {
        current_password: currentPassword,
        new_password: newPassword,
      }),
    onSuccess: (updatedAdmin) => {
      if (accessToken) setSession(accessToken, updatedAdmin);
      setShowPasswordModal(false);
      setPasswordError("");
    },
    onError: (err) => {
      setPasswordError(err instanceof ApiError ? err.message : "Failed to update password");
    },
  });

  const handleLogout = () => {
    logout();
    queryClient.clear();
    navigate({ to: "/login" });
  };

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-5">
          <p className="text-sm font-semibold text-slate-900">Regos Platform</p>
          <p className="text-xs text-slate-500">Admin panel</p>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className={clsx(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
                pathname === to || (to !== "/" && pathname.startsWith(to))
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-slate-600 hover:bg-slate-50",
              )}
            >
              <Icon size={16} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-3">
          <p className="truncate px-3 text-xs font-medium text-slate-700">{admin?.display_name}</p>
          <p className="truncate px-3 text-xs text-slate-500">{admin?.username ?? admin?.email}</p>
          <button
            type="button"
            onClick={() => {
              setPasswordError("");
              setShowPasswordModal(true);
            }}
            className="mt-2 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            <KeyRound size={16} />
            Change password
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 p-6">{children}</main>
      <ChangePasswordModal
        open={showPasswordModal}
        title="Change your password"
        requireCurrentPassword
        loading={changePasswordMutation.isPending}
        error={passwordError}
        onClose={() => {
          setShowPasswordModal(false);
          setPasswordError("");
        }}
        onSubmit={({ currentPassword, newPassword }) =>
          changePasswordMutation.mutate({ currentPassword, newPassword })
        }
      />
    </div>
  );
}
