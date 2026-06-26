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
import { LanguageSelector } from "@/components/LanguageSelector";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePermissions } from "@/hooks/use-permissions";
import { useAuth } from "@/store/auth";
import { useSellContext } from "@/store/sell-context";
import styles from "./Shell.module.css";

const NAV = [
  { to: "/", labelKey: "nav.sell", icon: ShoppingCart, permission: "pos.access" },
  { to: "/sales", labelKey: "nav.sales", icon: Receipt, permission: "sales.read" },
  { to: "/returns", labelKey: "nav.returns", icon: Undo2, permission: "returns.manage" },
  { to: "/dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard, permission: "dashboard.read" },
  { to: "/users", labelKey: "nav.users", icon: Users, permission: "users.manage" },
  { to: "/telegram-users", labelKey: "nav.telegramUsers", icon: MessageCircle, permission: "users.manage" },
  { to: "/settings", labelKey: "nav.settings", icon: Settings, permission: "settings.manage" },
] as const;

export function Shell() {
  const { t } = useLanguage();

  const session = useAuth((s) => s.session);
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isCompactTopBar, setIsCompactTopBar] = useState(false);
  const sellContextHydrated = useSellContext((s) => s.hydrated);
  const { can, canChangePosContext } = usePermissions();
  const isSellPage = location.pathname === "/";
  const showSellContext = isSellPage && canChangePosContext() && sellContextHydrated;
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
          aria-label={t("nav.closeMenu", "Close menu")}
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
          <div className={styles.sidebarActions}>
            <button
            type="button"
            className={styles.closeBtn}
            onClick={() => setSidebarOpen(false)}
            aria-label={t("nav.closeMenu", "Close menu")}
          >
            <X size={20} />
          </button>
          </div>
        </div>

        {NAV.filter((item) => can(item.permission)).map(({ to, labelKey, icon: Icon }) => {
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
              <span>{t(labelKey)}</span>
            </Link>
          );
        })}

        <div className={styles.spacer} />

        <div className={styles.sidebarFooter}>
          <LanguageSelector variant="menu" />

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
                aria-label={t("nav.signOut", "Sign out")}
                title={t("nav.signOut", "Sign out")}
              >
                <LogOut size={16} />
              </button>
            </div>
          )}
        </div>
      </aside>

      <main className={styles.main}>
        {!sidebarOpen && (
          <div className={styles.topBar}>
            <button
              type="button"
              className={styles.menuBtn}
              onClick={() => setSidebarOpen(true)}
              aria-label={t("nav.openMenu", "Open menu")}
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
