import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { CatalogViewToggle } from "@/components/POS/CatalogViewToggle";
import { useCatalog } from "@/store/catalog";
import {
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Menu,
  PackageMinus,
  PackagePlus,
  Scale,
  ShoppingCart,
  Truck,
  Undo2,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import { BrandLogo } from "@/components/BrandLogo";
import { LanguageSelector } from "@/components/LanguageSelector";
import { ThemeSelector } from "@/components/ThemeSelector";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  normalizeEnabledPages,
  pageKeyFromPartnerPath,
  type PartnerPortalPageKey,
} from "@/lib/partner-portal-pages";
import { usePartnerSession } from "./PartnerSession";
import styles from "./PartnerPortal.module.css";

type NavItem = {
  pageKey: PartnerPortalPageKey;
  to:
    | "/partner/$publicKey"
    | "/partner/$publicKey/dashboard"
    | "/partner/$publicKey/purchases"
    | "/partner/$publicKey/purchase-returns"
    | "/partner/$publicKey/shipments"
    | "/partner/$publicKey/shipment-returns"
    | "/partner/$publicKey/orders"
    | "/partner/$publicKey/payments"
    | "/partner/$publicKey/reconciliation";
  labelKey: string;
  fallback: string;
  icon: LucideIcon;
  exact?: boolean;
};

type PartnerNavControls = {
  desktopNav: boolean;
  navHidden: boolean;
  showNav: () => void;
};

const PartnerNavContext = createContext<PartnerNavControls>({
  desktopNav: false,
  navHidden: false,
  showNav: () => {},
});

export function usePartnerNav(): PartnerNavControls {
  return useContext(PartnerNavContext);
}

const NAV: NavItem[] = [
  {
    pageKey: "catalog",
    to: "/partner/$publicKey",
    labelKey: "partnerApp.catalog",
    fallback: "Catalog",
    icon: ShoppingCart,
    exact: true,
  },
  {
    pageKey: "orders",
    to: "/partner/$publicKey/orders",
    labelKey: "partnerApp.orders",
    fallback: "My orders",
    icon: ClipboardList,
  },
  {
    pageKey: "purchases",
    to: "/partner/$publicKey/purchases",
    labelKey: "partnerApp.purchase",
    fallback: "Purchases",
    icon: PackagePlus,
  },
  {
    pageKey: "purchase_returns",
    to: "/partner/$publicKey/purchase-returns",
    labelKey: "partnerApp.purchaseReturn",
    fallback: "Purchase returns",
    icon: PackageMinus,
  },
  {
    pageKey: "shipments",
    to: "/partner/$publicKey/shipments",
    labelKey: "partnerApp.wholesale",
    fallback: "Shipments",
    icon: Truck,
  },
  {
    pageKey: "shipment_returns",
    to: "/partner/$publicKey/shipment-returns",
    labelKey: "partnerApp.wholesaleReturn",
    fallback: "Shipment returns",
    icon: Undo2,
  },
  {
    pageKey: "payments",
    to: "/partner/$publicKey/payments",
    labelKey: "partnerApp.payments",
    fallback: "Payments",
    icon: Wallet,
  },
  {
    pageKey: "reconciliation",
    to: "/partner/$publicKey/reconciliation",
    labelKey: "partnerApp.reconciliation",
    fallback: "Reconciliation",
    icon: Scale,
  },
  {
    pageKey: "dashboard",
    to: "/partner/$publicKey/dashboard",
    labelKey: "partnerApp.dashboard",
    fallback: "Reports",
    icon: LayoutDashboard,
  },
];

export function PartnerShell({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  const { publicKey, account, compact, logout } = usePartnerSession();
  const location = useLocation();
  const navigate = useNavigate();
  const hydrateCatalogUi = useCatalog((s) => s.hydrateUiPreferences);
  const [open, setOpen] = useState(false);
  const [navHidden, setNavHidden] = useState(false);
  const [isCompactTopBar, setIsCompactTopBar] = useState(false);
  const name = account.partner_name || account.first_name || account.phone || "";
  const enabledPages = useMemo(
    () => normalizeEnabledPages(account.enabled_pages),
    [account.enabled_pages],
  );
  const visibleNav = useMemo(
    () => NAV.filter((item) => enabledPages[item.pageKey]),
    [enabledPages],
  );
  const firstEnabledNav = visibleNav[0] ?? null;
  const catalogPath = `/partner/${publicKey}`;
  const isCatalogPage = location.pathname === catalogPath || location.pathname === `${catalogPath}/`;
  const showCatalogViewToggle = isCatalogPage && isCompactTopBar;
  const desktopNav = !compact && !isCompactTopBar;
  const currentPageKey = pageKeyFromPartnerPath(location.pathname, publicKey);
  const currentPageEnabled = currentPageKey == null ? true : enabledPages[currentPageKey];

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (currentPageEnabled) return;
    if (!firstEnabledNav) return;
    void navigate({ to: firstEnabledNav.to, params: { publicKey }, replace: true });
  }, [currentPageEnabled, firstEnabledNav, navigate, publicKey]);

  useEffect(() => {
    if (!isCatalogPage) return;
    void hydrateCatalogUi();
  }, [hydrateCatalogUi, isCatalogPage]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const onChange = () => setIsCompactTopBar(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const navControls: PartnerNavControls = {
    desktopNav,
    navHidden,
    showNav: () => setNavHidden(false),
  };

  return (
    <PartnerNavContext.Provider value={navControls}>
    <div
      className={clsx(
        styles.shell,
        compact && styles.compact,
        isCatalogPage && styles.shellCatalog,
        desktopNav && navHidden && styles.navHidden,
      )}
    >
      {open ? (
        <button type="button" className={styles.backdrop} aria-label={t("nav.closeMenu", "Close menu")} onClick={() => setOpen(false)} />
      ) : null}
      <aside className={clsx(styles.sidebar, open && styles.sidebarOpen)}>
        <div className={styles.sidebarHeader}>
          <div className={styles.brand}>
            <BrandLogo size="md" />
            <div className={styles.brandSub}>{name}</div>
          </div>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => {
              if (desktopNav) setNavHidden(true);
              else setOpen(false);
            }}
            aria-label={t("nav.closeMenu", "Close menu")}
          >
            <X size={18} />
          </button>
        </div>
        <nav className={styles.nav} aria-label={t("nav.main", "Main")}>
          {visibleNav.map((item) => {
            const path = item.to.replace("$publicKey", publicKey);
            const active = item.exact
              ? location.pathname === path || location.pathname === `${path}/`
              : location.pathname === path || location.pathname.startsWith(`${path}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                params={{ publicKey }}
                className={clsx(styles.navLink, active && styles.navLinkActive)}
              >
                <Icon size={18} />
                <span>{t(item.labelKey, item.fallback)}</span>
              </Link>
            );
          })}
        </nav>
        <div className={styles.sidebarFooter}>
          <ThemeSelector variant="menu" />
          <LanguageSelector variant="menu" />
          {compact ? null : (
            <button type="button" className={styles.navLink} onClick={logout}>
              <LogOut size={18} />
              <span>{t("partnerApp.signOut", "Sign out")}</span>
            </button>
          )}
        </div>
      </aside>
      <div className={styles.main}>
        <div className={styles.topBar}>
          {!isCatalogPage || !desktopNav ? (
            <button
              type="button"
              className={styles.menuBtn}
              aria-expanded={desktopNav ? false : open}
              aria-label={t("nav.openMenu", "Open menu")}
              onClick={() => {
                if (desktopNav) setNavHidden(false);
                else setOpen(true);
              }}
            >
              <Menu size={20} />
            </button>
          ) : null}
          <strong className={styles.topTitle}>{name}</strong>
          {showCatalogViewToggle ? <CatalogViewToggle className={styles.topBarViewToggle} /> : null}
        </div>
        <div className={styles.content}>
          {!firstEnabledNav ? (
            <div className={styles.emptyState}>
              {t("partnerApp.noPagesAvailable", "No portal pages are enabled for your account.")}
            </div>
          ) : currentPageEnabled ? (
            children
          ) : null}
        </div>
      </div>
    </div>
    </PartnerNavContext.Provider>
  );
}
