import { Link } from "@tanstack/react-router";
import { BrandLogo } from "@/components/BrandLogo";
import { LanguageSelector } from "@/components/LanguageSelector";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/store/auth";
import styles from "./DocsPage.module.css";

const SECTIONS = [
  { titleKey: "docs.gettingStarted.title", bodyKey: "docs.gettingStarted.body" },
  { titleKey: "docs.selling.title", bodyKey: "docs.selling.body" },
  { titleKey: "docs.stock.title", bodyKey: "docs.stock.body" },
  { titleKey: "docs.reports.title", bodyKey: "docs.reports.body" },
  { titleKey: "docs.settings.title", bodyKey: "docs.settings.body" },
  { titleKey: "docs.languages.title", bodyKey: "docs.languages.body" },
] as const;

export function DocsPage() {
  const { t } = useLanguage();
  const signedIn = Boolean(useAuth((s) => s.accessToken));

  return (
    <div className={styles.page}>
      <div className={styles.pageToolbar}>
        <LanguageSelector />
      </div>

      <div className={styles.content}>
        <header className={styles.header}>
          <div className={styles.brandRow}>
            <BrandLogo size="md" />
          </div>
          <h1 className={styles.title}>{t("docs.title", "Documentation")}</h1>
          <p className={styles.subtitle}>
            {t("docs.subtitle", "A short guide to using Regos Optom.")}
          </p>
        </header>

        <article className={styles.card}>
          <p className={styles.intro}>
            {t(
              "docs.intro",
              "Regos Optom is a wholesale point-of-sale app for selling, stock, payments, and reports. Use the sidebar after you sign in to open each area.",
            )}
          </p>

          {SECTIONS.map((section) => (
            <section key={section.titleKey} className={styles.section}>
              <h2 className={styles.sectionTitle}>{t(section.titleKey)}</h2>
              <p className={styles.sectionBody}>{t(section.bodyKey)}</p>
            </section>
          ))}
        </article>

        <div className={styles.actions}>
          {signedIn ? (
            <Link to="/" className={styles.primaryLink}>
              {t("docs.backToApp", "Back to app")}
            </Link>
          ) : (
            <Link to="/login" className={styles.primaryLink}>
              {t("docs.signIn", "Sign in")}
            </Link>
          )}
          {!signedIn ? (
            <Link to="/register" className={styles.secondaryLink}>
              {t("auth.createAccount", "Create account")}
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
