import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useCatalog } from "@/store/catalog";
import {
  ClipboardList,
  Home,
  LayoutDashboard,
  LogOut,
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

type PartnerMobileCartNav = {
  itemCount: number;
  open: () => void;
};

type PartnerNavControls = {
  desktopNav: boolean;
  navHidden: boolean;
  showNav: () => void;
  setMobileCartNav: (cart: PartnerMobileCartNav | null) => void;
};

const PartnerNavContext = createContext<PartnerNavControls>({
  desktopNav: false,
  navHidden: false,
  showNav: () => {},
  setMobileCartNav: () => {},
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

const BOTTOM_NAV_KEYS: PartnerPortalPageKey[] = [
  "catalog",
  "orders",
  "payments",
  "dashboard",
];

function isNavActive(item: NavItem, pathname: string, publicKey: string): boolean {
  const path = item.to.replace("$publicKey", publicKey);
  if (item.exact) {
    return pathname === path || pathname === `${path}/`;
  }
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function PartnerShell({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  const { publicKey, account, compact, logout } = usePartnerSession();
  const location = useLocation();
  const navigate = useNavigate();
  const hydrateCatalogUi = useCatalog((s) => s.hydrateUiPreferences);
  const [open, setOpen] = useState(false);
  const [navHidden, setNavHidden] = useState(false);
  const [isCompactTopBar, setIsCompactTopBar] = useState(false);
  const [headerLinkCount, setHeaderLinkCount] = useState(0);
  const [mobileCartNav, setMobileCartNavState] = useState<PartnerMobileCartNav | null>(null);
  const topBarRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const name = account.partner_name || account.first_name || account.phone || "";
  const enabledPages = useMemo(
    () => normalizeEnabledPages(account.enabled_pages),
    [account.enabled_pages],
  );
  const visibleNav = useMemo(
    () => NAV.filter((item) => enabledPages[item.pageKey]),
    [enabledPages],
  );
  const bottomNav = useMemo(
    () =>
      BOTTOM_NAV_KEYS.map((key) => visibleNav.find((item) => item.pageKey === key)).filter(
        (item): item is NavItem => item != null,
      ),
    [visibleNav],
  );
  const firstEnabledNav = visibleNav[0] ?? null;
  const catalogPath = `/partner/${publicKey}`;
  const isCatalogPage = location.pathname === catalogPath || location.pathname === `${catalogPath}/`;
  const desktopNav = !compact && !isCompactTopBar;
  const showDesktopHeaderLinks = desktopNav && navHidden;
  const showTopBar = showDesktopHeaderLinks;
  const showMobileChrome = !desktopNav;
  const showCatalogCartInNav = isCatalogPage && mobileCartNav != null;
  const currentPageKey = pageKeyFromPartnerPath(location.pathname, publicKey);
  const currentPageEnabled = currentPageKey == null ? true : enabledPages[currentPageKey];

  const setMobileCartNav = useCallback((cart: PartnerMobileCartNav | null) => {
    setMobileCartNavState(cart);
  }, []);

  const openMenu = useCallback(() => {
    if (desktopNav) setNavHidden(false);
    else setOpen(true);
  }, [desktopNav]);

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

  useLayoutEffect(() => {
    if (!showDesktopHeaderLinks) {
      setHeaderLinkCount(0);
      return;
    }

    const topBar = topBarRef.current;
    const measureRoot = measureRef.current;
    if (!topBar || !measureRoot) return;

    const measure = () => {
      const items = Array.from(measureRoot.children) as HTMLElement[];
      if (items.length < 2) {
        setHeaderLinkCount(0);
        return;
      }
      const style = getComputedStyle(topBar);
      const available =
        topBar.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const buttonWidth = items[0].offsetWidth;
      let used = buttonWidth;
      let count = 0;
      for (let i = 1; i < items.length; i += 1) {
        const next = used + items[i].offsetWidth;
        if (next > available + 0.5) break;
        used = next;
        count += 1;
      }
      setHeaderLinkCount(count);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(topBar);
    return () => observer.disconnect();
  }, [showDesktopHeaderLinks, visibleNav, t, location.pathname]);

  const navControls: PartnerNavControls = {
    desktopNav,
    navHidden,
    showNav: () => setNavHidden(false),
    setMobileCartNav,
  };

  const bottomNavItems = useMemo(() => {
    if (!showCatalogCartInNav) return bottomNav;
    return bottomNav.filter((item) => item.pageKey !== "dashboard");
  }, [bottomNav, showCatalogCartInNav]);

  const bottomNavMid = Math.ceil(bottomNavItems.length / 2);
  const bottomNavLeft = bottomNavItems.slice(0, bottomNavMid);
  const bottomNavRight = bottomNavItems.slice(bottomNavMid);
  const bottomNavSlotCount =
    bottomNavItems.length + 1 + (showCatalogCartInNav ? 1 : 0);

  const headerLinks = showDesktopHeaderLinks ? visibleNav.slice(0, headerLinkCount) : [];

  return (
    <PartnerNavContext.Provider value={navControls}>
      <div
        className={clsx(
          styles.shell,
          compact && styles.compact,
          isCatalogPage && styles.shellCatalog,
          desktopNav && navHidden && styles.navHidden,
          showMobileChrome && styles.hasMobileChrome,
        )}
      >
        {open ? (
          <button
            type="button"
            className={styles.backdrop}
            aria-label={t("nav.closeMenu", "Close menu")}
            onClick={() => setOpen(false)}
          />
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
              const active = isNavActive(item, location.pathname, publicKey);
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
          {showTopBar ? (
            <div
              ref={topBarRef}
              className={clsx(
                styles.topBar,
                showDesktopHeaderLinks && styles.topBarWithHeaderLinks,
              )}
            >
              {showDesktopHeaderLinks ? (
                <>
                  <button
                    type="button"
                    className={styles.menuBtn}
                    aria-expanded={false}
                    aria-label={t("nav.openMenu", "Open menu")}
                    onClick={openMenu}
                  >
                    <Home size={20} />
                  </button>
                  {headerLinks.map((item) => {
                    const active = isNavActive(item, location.pathname, publicKey);
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        params={{ publicKey }}
                        className={clsx(styles.headerNavLink, active && styles.navLinkActive)}
                      >
                        <Icon size={16} />
                        <span>{t(item.labelKey, item.fallback)}</span>
                      </Link>
                    );
                  })}
                  <div ref={measureRef} className={styles.headerNavMeasure} aria-hidden="true">
                    <span className={styles.menuBtn}>
                      <Home size={20} />
                    </span>
                    {visibleNav.map((item) => {
                      const Icon = item.icon;
                      return (
                        <span key={item.to} className={styles.headerNavLink}>
                          <Icon size={16} />
                          <span>{t(item.labelKey, item.fallback)}</span>
                        </span>
                      );
                    })}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
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
        {showMobileChrome ? (
          bottomNavItems.length > 0 || showCatalogCartInNav ? (
            <nav
              className={styles.bottomNav}
              aria-label={t("nav.main", "Main")}
              style={{ gridTemplateColumns: `repeat(${Math.max(bottomNavSlotCount, 1)}, minmax(0, 1fr))` }}
            >
              {bottomNavLeft.map((item) => {
                const active = isNavActive(item, location.pathname, publicKey);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    params={{ publicKey }}
                    className={clsx(styles.bottomNavLink, active && styles.bottomNavLinkActive)}
                    aria-label={t(item.labelKey, item.fallback)}
                  >
                    <Icon size={22} />
                    <span>{t(item.labelKey, item.fallback)}</span>
                  </Link>
                );
              })}
              <button
                type="button"
                className={clsx(styles.menuBtn, styles.menuBtnMobile)}
                aria-expanded={open}
                aria-label={t("nav.openMenu", "Open menu")}
                onClick={openMenu}
              >
                <Home size={20} />
              </button>
              {bottomNavRight.map((item) => {
                const active = isNavActive(item, location.pathname, publicKey);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    params={{ publicKey }}
                    className={clsx(styles.bottomNavLink, active && styles.bottomNavLinkActive)}
                    aria-label={t(item.labelKey, item.fallback)}
                  >
                    <Icon size={22} />
                    <span>{t(item.labelKey, item.fallback)}</span>
                  </Link>
                );
              })}
              {showCatalogCartInNav && mobileCartNav ? (
                <button
                  type="button"
                  className={styles.bottomNavCart}
                  onClick={mobileCartNav.open}
                  aria-label={t("partnerApp.cart", "Cart")}
                >
                  <ShoppingCart size={22} />
                  {mobileCartNav.itemCount > 0 ? (
                    <span className={styles.bottomNavCartBadge}>{mobileCartNav.itemCount}</span>
                  ) : null}
                </button>
              ) : null}
            </nav>
          ) : (
            <button
              type="button"
              className={clsx(styles.menuBtn, styles.menuBtnMobile, styles.menuBtnMobileFixed)}
              aria-expanded={open}
              aria-label={t("nav.openMenu", "Open menu")}
              onClick={openMenu}
            >
              <Home size={20} />
            </button>
          )
        ) : null}
      </div>
    </PartnerNavContext.Provider>
  );
}
