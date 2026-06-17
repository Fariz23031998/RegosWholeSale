import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.css";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg" | "icon";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  full?: boolean;
  children: ReactNode;
};

export function Button({
  variant = "primary",
  size = "md",
  full,
  className,
  children,
  ...rest
}: Props) {
  return (
    <button
      className={clsx(
        styles.btn,
        styles[variant],
        size !== "md" && styles[size],
        full && styles.full,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
