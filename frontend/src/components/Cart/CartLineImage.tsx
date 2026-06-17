import { useState } from "react";
import clsx from "clsx";
import { hasProductImage } from "@/lib/product-image";
import styles from "./Cart.module.css";

type Props = {
  image: string;
  name: string;
};

export function CartLineImage({ image, name }: Props) {
  const [failed, setFailed] = useState(false);
  const showPlaceholder = !hasProductImage(image) || failed;

  if (showPlaceholder) {
    return (
      <div className={clsx(styles.lineImg, styles.lineImgPlaceholder)} aria-hidden>
        No image
      </div>
    );
  }

  return (
    <img
      src={image}
      alt={name}
      className={styles.lineImg}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
