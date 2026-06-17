import type { ReactNode } from "react";
import styles from "./Auth.module.css";

type Props = {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthLayout({ title, subtitle, children, footer }: Props) {
  return (
    <div className={styles.wrap}>
      <div className={`${styles.card} ${styles.cardCenter}`}>
        <div className={styles.brand}>R</div>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.subtitle}>{subtitle}</p>
        {children}
        {footer}
      </div>
    </div>
  );
}
