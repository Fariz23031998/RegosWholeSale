import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/posui/Button";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  createPartnerOrder,
  fetchPartnerCatalogOptions,
  fetchPartnerProductGroups,
  fetchPartnerProducts,
  type PartnerCatalogProduct,
  type PartnerProductGroup,
  type PartnerWarehouseOption,
} from "@/lib/partner-telegram-api";
import { formatAuthError } from "@/store/auth";
import { usePartnerSession } from "./PartnerSession";
import { formatAmount, partnerCartKey, partnerWarehouseKey } from "./partner-format";
import styles from "./PartnerPortal.module.css";

type CartLine = {
  id: number;
  name: string;
  price: number;
  available: number;
  quantity: number;
  unitName: string;
};

type Panel = "shop" | "checkout";

function readCart(publicKey: string): CartLine[] {
  try {
    const raw = sessionStorage.getItem(partnerCartKey(publicKey));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((line): line is CartLine => {
      if (!line || typeof line !== "object") return false;
      const row = line as CartLine;
      return typeof row.id === "number" && typeof row.quantity === "number";
    });
  } catch {
    return [];
  }
}

export function PartnerCatalog() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { token, publicKey, account } = usePartnerSession();
  const [panel, setPanel] = useState<Panel>("shop");
  const [cart, setCart] = useState<CartLine[]>(() => readCart(publicKey));
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("in-stock");
  const [groupId, setGroupId] = useState<number | null>(null);
  const [groups, setGroups] = useState<PartnerProductGroup[]>([]);
  const [products, setProducts] = useState<PartnerCatalogProduct[]>([]);
  const [currency, setCurrency] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [optionsReady, setOptionsReady] = useState(false);
  const [allowWarehouse, setAllowWarehouse] = useState(false);
  const [warehouses, setWarehouses] = useState<PartnerWarehouseOption[]>([]);
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [takeaway, setTakeaway] = useState(true);
  const [address, setAddress] = useState("");
  const [orderPhone, setOrderPhone] = useState(account.phone ?? "");
  const [placing, setPlacing] = useState(false);

  useEffect(() => {
    sessionStorage.setItem(partnerCartKey(publicKey), JSON.stringify(cart));
  }, [cart, publicKey]);

  useEffect(() => {
    void fetchPartnerProductGroups(token)
      .then((response) => setGroups(response.groups))
      .catch(() => setGroups([]));
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    void fetchPartnerCatalogOptions(token)
      .then((options) => {
        if (cancelled) return;
        setAllowWarehouse(options.allow_warehouse_selection);
        setWarehouses(options.warehouses);
        setCurrency(options.currency_name);
        const stored = Number(sessionStorage.getItem(partnerWarehouseKey(publicKey)) || "");
        const storedOk = options.warehouses.some((item) => item.id === stored);
        const next = options.allow_warehouse_selection && storedOk ? stored : options.warehouse_id;
        setWarehouseId(next);
        setOptionsReady(true);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(formatAuthError(loadError));
        setOptionsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [publicKey, token]);

  useEffect(() => {
    if (!optionsReady || panel !== "shop") return;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      void fetchPartnerProducts(token, {
        search,
        filterType: filter,
        groupId,
        warehouseId: allowWarehouse ? warehouseId : null,
      })
        .then((response) => {
          setProducts(response.products);
          setCurrency(response.currency_name);
        })
        .catch((loadError) => setError(formatAuthError(loadError)))
        .finally(() => setLoading(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [allowWarehouse, filter, groupId, optionsReady, panel, search, token, warehouseId]);

  const add = (product: PartnerCatalogProduct) => {
    if (product.available <= 0) return;
    setCart((current) =>
      current.some((line) => line.id === product.id)
        ? current.map((line) =>
            line.id === product.id ? { ...line, quantity: Math.min(line.available, line.quantity + 1) } : line,
          )
        : [
            ...current,
            {
              id: product.id,
              name: product.name,
              price: product.price,
              available: product.available,
              quantity: 1,
              unitName: product.unit_name,
            },
          ],
    );
  };

  const total = cart.reduce((sum, line) => sum + line.price * line.quantity, 0);

  const changeWarehouse = (next: number) => {
    setWarehouseId(next);
    sessionStorage.setItem(partnerWarehouseKey(publicKey), String(next));
    setCart([]);
  };

  const place = async () => {
    setPlacing(true);
    setError("");
    try {
      const result = await createPartnerOrder(token, {
        is_takeaway: takeaway,
        address,
        phone: orderPhone,
        warehouse_id: allowWarehouse ? warehouseId : null,
        items: cart.map((line) => ({ product_id: line.id, quantity: line.quantity })),
      });
      setCart([]);
      const placed = result.code || String(result.order_id);
      void navigate({
        to: "/partner/$publicKey/orders",
        params: { publicKey },
        search: { placed },
      });
    } catch (placeError) {
      setError(formatAuthError(placeError));
    } finally {
      setPlacing(false);
    }
  };

  return (
    <div className={styles.catalogLayout}>
      <section className={styles.catalog}>
        {panel === "checkout" ? (
          <div className={styles.panel}>
            <button type="button" className={styles.textButton} onClick={() => setPanel("shop")}>
              {t("partnerApp.back", "Back")}
            </button>
            <h2>{t("partnerApp.checkout", "Checkout")}</h2>
            <label className={styles.choice}>
              <input type="radio" checked={takeaway} onChange={() => setTakeaway(true)} />
              {t("partnerApp.pickup", "Pickup")}
            </label>
            <label className={styles.choice}>
              <input type="radio" checked={!takeaway} onChange={() => setTakeaway(false)} />
              {t("partnerApp.delivery", "Delivery")}
            </label>
            {!takeaway ? (
              <label className={styles.field}>
                {t("partnerApp.address", "Address")}
                <input className={styles.input} value={address} onChange={(event) => setAddress(event.target.value)} />
              </label>
            ) : null}
            <label className={styles.field}>
              {t("partnerApp.phone", "Phone")}
              <input className={styles.input} value={orderPhone} onChange={(event) => setOrderPhone(event.target.value)} />
            </label>
            <p>
              {t("partnerApp.total", "Total")}: {formatAmount(total)} {currency}
            </p>
            {error ? <p className={styles.error}>{error}</p> : null}
            <Button type="button" full disabled={placing || cart.length === 0} onClick={() => void place()}>
              {t("partnerApp.placeOrder", "Place order")}
            </Button>
          </div>
        ) : (
          <>
            <div className={styles.toolbar}>
              <input
                className={styles.input}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("partnerApp.search", "Search products")}
              />
              {allowWarehouse ? (
                <label className={styles.field}>
                  {t("partnerApp.warehouse", "Warehouse")}
                  <select
                    className={styles.input}
                    value={warehouseId ?? ""}
                    onChange={(event) => changeWarehouse(Number(event.target.value))}
                  >
                    {warehouses.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {warehouse.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <LinkOrders />
            </div>
            <div className={styles.filters}>
              {(["in-stock", "low-stock", "cheap", "expensive"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={filter === item ? styles.chipOn : styles.chip}
                  onClick={() => setFilter(item)}
                >
                  {t(`partnerApp.${item === "in-stock" ? "inStock" : item === "low-stock" ? "lowStock" : item}`, item)}
                </button>
              ))}
            </div>
            <select
              className={styles.input}
              value={groupId ?? ""}
              onChange={(event) => setGroupId(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">{t("partnerApp.allGroups", "All groups")}</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.path || group.name}
                </option>
              ))}
            </select>
            {loading ? <p>{t("common.loading", "Loading...")}</p> : null}
            {error ? <p className={styles.error}>{error}</p> : null}
            {!loading && products.length === 0 ? <p>{t("partnerApp.emptyCatalog", "No products match this filter.")}</p> : null}
            <div className={styles.grid}>
              {products.map((product) => (
                <article key={product.id} className={styles.product}>
                  {product.image ? <img src={product.image} alt="" /> : <div className={styles.productImage} />}
                  <div className={styles.productBody}>
                    <strong>{product.name}</strong>
                    <div className={styles.muted}>{product.sku}</div>
                    <div>
                      {formatAmount(product.price)} {currency}
                    </div>
                    <div className={styles.muted}>
                      {product.available > 0
                        ? `${formatAmount(product.available)} ${product.unit_name}`
                        : t("partnerApp.outOfStock", "Out of stock")}
                    </div>
                    <Button type="button" size="sm" disabled={product.available <= 0} onClick={() => add(product)}>
                      {t("partnerApp.add", "Add")}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
      <aside className={styles.cart} id="cart">
        <h2>{t("partnerApp.cart", "Cart")}</h2>
        {cart.length === 0 ? <p className={styles.muted}>{t("partnerApp.emptyCart", "Your cart is empty.")}</p> : null}
        {cart.map((line) => (
          <div key={line.id} className={styles.line}>
            <div>
              <strong>{line.name}</strong>
              <div className={styles.muted}>
                {formatAmount(line.price)} {currency}
              </div>
            </div>
            <input
              className={styles.qty}
              type="number"
              min={1}
              max={line.available}
              value={line.quantity}
              onChange={(event) => {
                const next = Number(event.target.value);
                setCart((current) =>
                  current.map((item) =>
                    item.id === line.id ? { ...item, quantity: Math.min(item.available, Math.max(1, next || 1)) } : item,
                  ),
                );
              }}
            />
          </div>
        ))}
        {cart.length > 0 && panel === "shop" ? (
          <>
            <p>
              {t("partnerApp.total", "Total")}: {formatAmount(total)} {currency}
            </p>
            <Button type="button" full onClick={() => setPanel("checkout")}>
              {t("partnerApp.checkout", "Checkout")}
            </Button>
          </>
        ) : null}
      </aside>
    </div>
  );
}

function LinkOrders() {
  const { t } = useLanguage();
  const { publicKey } = usePartnerSession();
  const navigate = useNavigate();
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={() =>
        void navigate({
          to: "/partner/$publicKey/orders",
          params: { publicKey },
          search: {},
        })
      }
    >
      {t("partnerApp.orders", "My orders")}
    </Button>
  );
}
