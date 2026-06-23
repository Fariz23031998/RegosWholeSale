import { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Modal } from "@/components/posui/Modal";
import { formatAuthError, useAuth } from "@/store/auth";
import { useCart, type CartItem, type DiscountMode } from "@/store/cart";
import { useCatalog } from "@/store/catalog";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { PRODUCT_FALLBACK_IMAGE } from "@/lib/product-image";
import {
  fetchWholesaleDocuments,
  fetchWholesaleOperations,
  type WholesaleDocument,
  type WholesaleOperationLine,
} from "@/lib/sales-api";
import type { Product } from "@/types/catalog";
import styles from "@/components/Returns/Returns.module.css";

type Props = {
  open: boolean;
  onClose: () => void;
};

function operationsToCartItems(
  operations: WholesaleOperationLine[],
  catalogProducts: Product[],
): CartItem[] {
  return operations.map((op) => {
    const productId = String(op.item_id);
    const catalogProduct = catalogProducts.find(
      (product) =>
        product.regos_item_id === op.item_id || product.id === productId,
    );
    return {
      productId,
      regosItemId: op.item_id,
      name: op.item_name ?? catalogProduct?.name ?? `Item #${op.item_id}`,
      price: op.price2 ?? op.price,
      qty: op.quantity,
      image: catalogProduct?.image ?? PRODUCT_FALLBACK_IMAGE,
      unitType: catalogProduct?.unit_type ?? null,
    };
  });
}

function discountFromOperations(operations: WholesaleOperationLine[]): {
  discountMode: DiscountMode;
  discountValue: number;
} {
  const subtotal = operations.reduce(
    (sum, op) => sum + (op.price2 ?? op.price) * op.quantity,
    0,
  );
  const total = operations.reduce((sum, op) => sum + op.price * op.quantity, 0);
  const discount = Math.max(0, +(subtotal - total).toFixed(2));
  if (discount <= 0) {
    return { discountMode: "percent", discountValue: 0 };
  }
  return { discountMode: "amount", discountValue: discount };
}

export function ContinueSaleModal({ open, onClose }: Props) {
  const accessToken = useAuth((s) => s.accessToken);
  const restore = useCart((s) => s.restore);
  const setPostponedWholesaleDocId = useCart((s) => s.setPostponedWholesaleDocId);
  const catalogProducts = useCatalog((s) => s.products);

  const [search, setSearch] = useState("");
  const [documents, setDocuments] = useState<WholesaleDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectingId, setSelectingId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const reset = useCallback(() => {
    setSearch("");
    setDocuments([]);
    setLoading(false);
    setSelectingId(null);
    setError("");
  }, []);

  const handleClose = () => {
    if (selectingId !== null) return;
    reset();
    onClose();
  };

  useEffect(() => {
    if (!open || !accessToken) return;

    let cancelled = false;
    setLoading(true);
    setError("");

    void fetchWholesaleDocuments(accessToken, { performed: false, limit: 100 })
      .then((response) => {
        if (!cancelled) setDocuments(response.documents);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(formatAuthError(err, "Failed to load postponed sales"));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, accessToken]);

  const filteredDocuments = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return documents;
    return documents.filter((doc) => {
      const haystack = [doc.code, doc.partner_name ?? "", doc.stock_name ?? ""]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [documents, search]);

  const selectDocument = async (doc: WholesaleDocument) => {
    if (!accessToken) return;

    setSelectingId(doc.id);
    setError("");

    try {
      const { operations } = await fetchWholesaleOperations(accessToken, doc.id);
      if (operations.length === 0) {
        setError("This postponed sale has no line items.");
        return;
      }

      const { discountMode, discountValue } = discountFromOperations(operations);
      restore({
        items: operationsToCartItems(operations, catalogProducts),
        discountMode,
        discountValue,
        postponedWholesaleDocId: doc.id,
      });
      setPostponedWholesaleDocId(doc.id);
      reset();
      onClose();
    } catch (err: unknown) {
      setError(formatAuthError(err, "Failed to load postponed sale"));
    } finally {
      setSelectingId(null);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="Continue Sale">
      <div className={styles.searchBox}>
        <Search size={16} />
        <input
          className={styles.searchInput}
          placeholder="Search by code, customer, or warehouse…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {loading ? (
        <div className={styles.status}>Loading postponed sales…</div>
      ) : filteredDocuments.length === 0 ? (
        <div className={styles.status}>No unperformed wholesale sales found.</div>
      ) : (
        <div className={styles.saleList}>
          {filteredDocuments.map((doc) => (
            <button
              key={doc.id}
              type="button"
              className={styles.saleRow}
              disabled={selectingId !== null}
              onClick={() => void selectDocument(doc)}
            >
              <div>
                <div className={styles.saleCode}>{doc.code}</div>
                <div className={styles.saleMeta}>
                  {formatDateTime(new Date(doc.date * 1000).toISOString())}
                  {doc.partner_name ? ` · ${doc.partner_name}` : ""}
                  {doc.stock_name ? ` · ${doc.stock_name}` : ""}
                </div>
              </div>
              <div className={styles.saleAmount}>
                {selectingId === doc.id ? "Loading…" : formatCurrency(doc.amount ?? 0)}
              </div>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
