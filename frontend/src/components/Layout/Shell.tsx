import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import {
  ArrowDownUp,
  ArrowLeftRight,
  ChevronDown,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Package,
  PackageMinus,
  PackagePlus,
  Receipt,
  Settings,
  ShoppingCart,
  Undo2,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import { BrandLogo } from "@/components/BrandLogo";
import { ProfileEditModal } from "@/components/Auth/ProfileEditModal";
import { CatalogViewToggle } from "@/components/POS/CatalogViewToggle";
import { SellContextBar } from "@/components/POS/SellContextBar";
import { LanguageSelector } from "@/components/LanguageSelector";
import { ThemeSelector } from "@/components/ThemeSelector";
import { CacheManagement } from "@/components/Layout/CacheManagement";
import { NotificationMenu } from "@/components/Notifications/NotificationMenu";
import { useLanguage } from "@/contexts/LanguageContext";
import { usePermissions } from "@/hooks/use-permissions";
import { useAuth } from "@/store/auth";
import { useSellContext } from "@/store/sell-context";
import styles from "./Shell.module.css";

type NavLinkItem = {
  kind: "link";
  to: string;
  labelKey: string;
  icon: LucideIcon;
  permission: string;
};

type NavGroupItem = {
  kind: "group";
  id: string;
  labelKey: string;
  icon: LucideIcon;
  children: Array<{
    to: string;
    labelKey: string;
    icon: LucideIcon;
    permission: string;
  }>;
};

type NavItem = NavLinkItem | NavGroupItem;

const NAV: NavItem[] = [
  { kind: "link", to: "/", labelKey: "nav.sell", icon: ShoppingCart, permission: "pos.access" },
  { kind: "link", to: "/sales", labelKey: "nav.sales", icon: Receipt, permission: "sales.read" },
  {
    kind: "group",
    id: "stock",
    labelKey: "nav.stock",
    icon: Package,
    children: [
      { to: "/purchases", labelKey: "nav.purchases", icon: PackagePlus, permission: "purchase.read" },
      {
        to: "/partner-returns",
        labelKey: "nav.partnerReturns",
        icon: PackageMinus,
        permission: "return_to_partner.read",
      },
      {
        to: "/movements",
        labelKey: "nav.movements",
        icon: ArrowLeftRight,
        permission: "movement.read",
      },
      {
        to: "/inventories",
        labelKey: "nav.inventories",
        icon: ClipboardList,
        permission: "inventory.read",
      },
      { to: "/inouts", labelKey: "nav.inouts", icon: ArrowDownUp, permission: "inout.read" },
    ],
  },
  { kind: "link", to: "/payments", labelKey: "nav.payments", icon: Wallet, permission: "payments.read" },
  { kind: "link", to: "/returns", labelKey: "nav.returns", icon: Undo2, permission: "returns.manage" },
  {
    kind: "link",
    to: "/dashboard",
    labelKey: "nav.dashboard",
    icon: LayoutDashboard,
    permission: "dashboard.read",
  },
  { kind: "link", to: "/users", labelKey: "nav.users", icon: Users, permission: "users.manage" },
  {
    kind: "link",
    to: "/telegram-users",
    labelKey: "nav.telegramUsers",
    icon: MessageCircle,
    permission: "users.manage",
  },
  {
    kind: "link",
    to: "/settings",
    labelKey: "nav.settings",
    icon: Settings,
    permission: "settings.manage",
  },
];

function isPathActive(pathname: string, to: string) {
  return to === "/" ? pathname === "/" : pathname.startsWith(to);
}

export function Shell() {
  const { t } = useLanguage();

  const session = useAuth((s) => s.session);
  const user = useAuth((s) => s.user);
  const accessToken = useAuth((s) => s.accessToken);
  const setSession = useAuth((s) => s.setSession);
  const logout = useAuth((s) => s.logout);
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isCompactTopBar, setIsCompactTopBar] = useState(false);
  const [stockOpen, setStockOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const sellContextHydrated = useSellContext((s) => s.hydrated);
  const { can, canChangePosContext } = usePermissions();
  const isSellPage = location.pathname === "/";
  const showSellContext = isSellPage && canChangePosContext() && sellContextHydrated;
  const showCatalogViewToggle = isSellPage && isCompactTopBar;

  const stockGroup = NAV.find((item): item is NavGroupItem => item.kind === "group" && item.id === "stock");
  const stockChildActive = Boolean(
    stockGroup?.children.some((child) => isPathActive(location.pathname, child.to)),
  );

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
    if (stockChildActive) setStockOpen(true);
  }, [stockChildActive]);

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
            <BrandLogo size="md" />
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

        <nav className={styles.sidebarNav} aria-label={t("nav.main", "Main")}>
          {NAV.map((item) => {
            if (item.kind === "link") {
              if (!can(item.permission)) return null;
              const active = isPathActive(location.pathname, item.to);
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={clsx(styles.navLink, active && styles.navLinkActive)}
                >
                  <Icon size={18} />
                  <span>{t(item.labelKey)}</span>
                </Link>
              );
            }

            const visibleChildren = item.children.filter((child) => can(child.permission));
            if (visibleChildren.length === 0) return null;

            const open = stockOpen;
            const GroupIcon = item.icon;

            return (
              <div key={item.id} className={styles.navGroup}>
                <button
                  type="button"
                  className={clsx(
                    styles.navGroupToggle,
                    stockChildActive && styles.navGroupToggleActive,
                  )}
                  aria-expanded={open}
                  onClick={() => setStockOpen((prev) => !prev)}
                >
                  <GroupIcon size={18} />
                  <span>{t(item.labelKey, "Stock")}</span>
                  <ChevronDown
                    size={16}
                    className={clsx(styles.navGroupChevron, open && styles.navGroupChevronOpen)}
                  />
                </button>
                {open ? (
                  <div className={styles.navGroupChildren}>
                    {visibleChildren.map((child) => {
                      const active = isPathActive(location.pathname, child.to);
                      const ChildIcon = child.icon;
                      return (
                        <Link
                          key={child.to}
                          to={child.to}
                          className={clsx(
                            styles.navLink,
                            styles.navSubLink,
                            active && styles.navLinkActive,
                          )}
                        >
                          <ChildIcon size={16} />
                          <span>{t(child.labelKey)}</span>
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>

        <div className={styles.sidebarFooter}>
          <CacheManagement variant="menu" />
          <ThemeSelector variant="menu" />
          <LanguageSelector variant="menu" />

          {session && (
            <div className={styles.cashier}>
              <button
                type="button"
                className={styles.avatar}
                style={{ background: session.color }}
                onClick={() => setProfileOpen(true)}
                aria-label={t("profile.editTitle", "Edit profile")}
                title={t("profile.editTitle", "Edit profile")}
              >
                {session.initials}
              </button>
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
            <NotificationMenu />
          </div>
        )}
        <Outlet />
      </main>

      {accessToken && user && (
        <ProfileEditModal
          open={profileOpen}
          token={accessToken}
          user={user}
          onClose={() => setProfileOpen(false)}
          onSaved={(updated) => setSession(accessToken, updated)}
        />
      )}
    </div>
  );
}
