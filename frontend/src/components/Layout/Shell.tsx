import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, LogOut, Receipt, Settings, ShoppingCart, Undo2 } from "lucide-react";
import clsx from "clsx";
import { useAuth } from "@/store/auth";
import styles from "./Shell.module.css";

const NAV = [
  { to: "/", label: "Sell", icon: ShoppingCart },
  { to: "/sales", label: "Sales", icon: Receipt },
  { to: "/returns", label: "Returns", icon: Undo2 },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function Shell() {
  const session = useAuth((s) => s.session);
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate({ to: "/login" });
  };

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.brandMark}>R</div>
          <div>
            <div className={styles.brandText}>Regos Wholesale</div>
            <div className={styles.brandSub}>{user?.company?.name ?? "POS"}</div>
          </div>
        </div>

        {NAV.map(({ to, label, icon: Icon }) => {
          const active =
            to === "/"
              ? location.pathname === "/"
              : location.pathname.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              className={clsx(styles.navLink, active && styles.navLinkActive)}
            >
              <Icon size={18} />
              <span>{label}</span>
            </Link>
          );
        })}

        <div className={styles.spacer} />

        {session && (
          <div className={styles.cashier}>
            <div className={styles.avatar} style={{ background: session.color }}>
              {session.initials}
            </div>
            <div style={{ minWidth: 0 }}>
              <div className={styles.cashierName}>{session.name}</div>
              <div className={styles.cashierRole}>{session.role}</div>
            </div>
            <button
              className={styles.logoutBtn}
              onClick={handleLogout}
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        )}
      </aside>

      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
