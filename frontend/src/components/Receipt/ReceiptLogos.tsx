import type { ReceiptTemplateLogo } from "@/types/receipt-templates";
import styles from "./Receipt.module.css";

type Props = {
  logos: ReceiptTemplateLogo[];
  variant?: "80mm" | "a4";
};

export function ReceiptLogos({ logos, variant = "80mm" }: Props) {
  if (!logos.length) return null;

  return (
    <div
      className={
        variant === "a4" ? styles.logoRowA4 : styles.logoRow
      }
    >
      {logos.map((logo) => (
        <img
          key={logo.id}
          className={styles.logoImage}
          src={logo.src}
          alt={logo.name}
          style={logo.max_width ? { maxWidth: `${logo.max_width}px` } : undefined}
        />
      ))}
    </div>
  );
}
