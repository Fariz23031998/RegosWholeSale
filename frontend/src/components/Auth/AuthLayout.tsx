import type { ReactNode } from "react";
import { BrandLogo } from "@/components/BrandLogo";
import styles from "./Auth.module.css";

type Props = {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
  headerAction?: ReactNode;
};

export function AuthLayout({ title, subtitle, children, footer, headerAction }: Props) {
  return (
    <div className={styles.wrap}>
      {headerAction ? <div className={styles.headerAction}>{headerAction}</div> : null}
      <div className={`${styles.card} ${styles.cardCenter}`}>
        <BrandLogo size="lg" className={styles.brand} />
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.subtitle}>{subtitle}</p>
        {children}
        {footer}
      </div>
    </div>
  );
}
