import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import {
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
import { usePartnerSession } from "./PartnerSession";
import styles from "./PartnerPortal.module.css";

type NavItem = {
  to:
    | "/partner/$publicKey"
    | "/partner/$publicKey/purchases"
    | "/partner/$publicKey/purchase-returns"
    | "/partner/$publicKey/shipments"
    | "/partner/$publicKey/shipment-returns"
    | "/partner/$publicKey/payments"
    | "/partner/$publicKey/reconciliation";
  labelKey: string;
  fallback: string;
  icon: LucideIcon;
  exact?: boolean;
};

const NAV: NavItem[] = [
  { to: "/partner/$publicKey", labelKey: "partnerApp.catalog", fallback: "Catalog", icon: ShoppingCart, exact: true },
  { to: "/partner/$publicKey/purchases", labelKey: "partnerApp.purchase", fallback: "Purchases", icon: PackagePlus },
  {
    to: "/partner/$publicKey/purchase-returns",
    labelKey: "partnerApp.purchaseReturn",
    fallback: "Purchase returns",
    icon: PackageMinus,
  },
  { to: "/partner/$publicKey/shipments", labelKey: "partnerApp.wholesale", fallback: "Shipments", icon: Truck },
  {
    to: "/partner/$publicKey/shipment-returns",
    labelKey: "partnerApp.wholesaleReturn",
    fallback: "Shipment returns",
    icon: Undo2,
  },
  { to: "/partner/$publicKey/payments", labelKey: "partnerApp.payments", fallback: "Payments", icon: Wallet },
  {
    to: "/partner/$publicKey/reconciliation",
    labelKey: "partnerApp.reconciliation",
    fallback: "Reconciliation",
    icon: Scale,
  },
];

export function PartnerShell({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  const { publicKey, account, compact, logout } = usePartnerSession();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const name = account.partner_name || account.first_name || account.phone || "";

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className={clsx(styles.shell, compact && styles.compact)}>
      {open ? (
        <button type="button" className={styles.backdrop} aria-label={t("nav.closeMenu", "Close menu")} onClick={() => setOpen(false)} />
      ) : null}
      <aside className={clsx(styles.sidebar, open && styles.sidebarOpen)}>
        <div className={styles.sidebarHeader}>
          <div className={styles.brand}>
            <BrandLogo size="md" />
            <div className={styles.brandSub}>{name}</div>
          </div>
          <button type="button" className={styles.iconBtn} onClick={() => setOpen(false)} aria-label={t("nav.closeMenu", "Close menu")}>
            <X size={18} />
          </button>
        </div>
        <nav className={styles.nav} aria-label={t("nav.main", "Main")}>
          {NAV.map((item) => {
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
          <button type="button" className={styles.menuBtn} onClick={() => setOpen(true)} aria-label={t("nav.openMenu", "Open menu")}>
            <Menu size={20} />
          </button>
          <strong className={styles.topTitle}>{name}</strong>
        </div>
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
