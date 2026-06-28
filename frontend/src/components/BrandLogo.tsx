import clsx from "clsx";
import { SITE_LOGO_PATH, SITE_LOGO_WEBP_PATH, SITE_NAME } from "@/lib/site";
import styles from "./BrandLogo.module.css";

type Props = {
  size?: "sm" | "md" | "lg";
  className?: string;
  showName?: boolean;
};

const SIZE_CLASS = {
  sm: styles.sizeSm,
  md: styles.sizeMd,
  lg: styles.sizeLg,
} as const;

export function BrandLogo({ size = "md", className, showName = false }: Props) {
  return (
    <div className={clsx(styles.wrap, className)}>
      <picture>
        <source srcSet={SITE_LOGO_WEBP_PATH} type="image/webp" />
        <img
          className={clsx(styles.logo, SIZE_CLASS[size])}
          src={SITE_LOGO_PATH}
          alt={SITE_NAME}
          width={size === "lg" ? 56 : size === "md" ? 36 : 28}
          height={size === "lg" ? 56 : size === "md" ? 36 : 28}
          decoding="async"
        />
      </picture>
      {showName ? <span className={styles.name}>{SITE_NAME}</span> : null}
    </div>
  );
}
