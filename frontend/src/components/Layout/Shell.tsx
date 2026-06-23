import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Receipt,
  Settings,
  ShoppingCart,
  Undo2,
  Users,
  X,
} from "lucide-react";
import clsx from "clsx";
import { CatalogViewToggle } from "@/components/POS/CatalogViewToggle";
import { SellContextBar } from "@/components/POS/SellContextBar";
import { useAuth } from "@/store/auth";
import { useSellContext } from "@/store/sell-context";
import styles from "./Shell.module.css";

const NAV = [
  { to: "/", label: "Sell", icon: ShoppingCart },
  { to: "/sales", label: "Sales", icon: Receipt },
  { to: "/returns", label: "Returns", icon: Undo2 },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/users", label: "Users", icon: Users, permission: "users.manage" },
  { to: "/telegram-users", label: "Telegram users", icon: MessageCircle },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function Shell() {
  const session = useAuth((s) => s.session);
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isCompactTopBar, setIsCompactTopBar] = useState(false);
  const sellContextHydrated = useSellContext((s) => s.hydrated);
  const canOverrideRegos = Boolean(user?.permissions.includes("pos.override_regos"));
  const isSellPage = location.pathname === "/";
  const showSellContext = isSellPage && canOverrideRegos && sellContextHydrated;
  const showCatalogViewToggle = isSellPage && isCompactTopBar;

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const onChange = () => setIsCompactTopBar(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!sidebarOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSidebarOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [sidebarOpen]);

  const handleLogout = () => {
    logout();
    navigate({ to: "/login" });
  };

  return (
    <div className={styles.shell}>
      {sidebarOpen && (
        <button
          type="button"
          className={styles.backdrop}
          aria-label="Close menu"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={clsx(styles.sidebar, sidebarOpen && styles.sidebarOpen)}>
        <div className={styles.sidebarHeader}>
          <div className={styles.brand}>
            <div className={styles.brandMark}>R</div>
            <div>
              <div className={styles.brandSub}>{user?.company?.name ?? "POS"}</div>
            </div>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        </div>

        {NAV.filter(
          (item) => !("permission" in item) || user?.permissions.includes(item.permission),
        ).map(({ to, label, icon: Icon }) => {
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
        {!sidebarOpen && (
          <div className={styles.topBar}>
            <button
              type="button"
              className={styles.menuBtn}
              onClick={() => setSidebarOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={20} />
            </button>
            {showSellContext ? <SellContextBar className={styles.topBarContext} /> : null}
            {showCatalogViewToggle ? (
              <CatalogViewToggle className={styles.topBarViewToggle} />
            ) : null}
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
