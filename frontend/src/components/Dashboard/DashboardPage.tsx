import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useSales } from "@/store/sales";
import { formatCurrency } from "@/lib/format";
import styles from "./Dashboard.module.css";

const COLORS = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444"];

export function DashboardPage() {
  const sales = useSales((s) => s.sales);

  const stats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();

    const todaySales = sales.filter(
      (s) => new Date(s.createdAt).getTime() >= todayMs,
    );
    const todayRevenue = todaySales.reduce((n, s) => n + s.total, 0);
    const itemsSold = todaySales.reduce(
      (n, s) => n + s.items.reduce((m, i) => m + i.qty, 0),
      0,
    );
    const avgBasket = todaySales.length
      ? todayRevenue / todaySales.length
      : 0;

    // Last 7 days revenue
    const days: { day: string; revenue: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const start = d.getTime();
      const end = start + 24 * 60 * 60 * 1000;
      const rev = sales
        .filter((s) => {
          const t = new Date(s.createdAt).getTime();
          return t >= start && t < end;
        })
        .reduce((n, s) => n + s.total, 0);
      days.push({
        day: d.toLocaleDateString("en-US", { weekday: "short" }),
        revenue: +rev.toFixed(2),
      });
    }

    // Top products
    const productMap = new Map<string, { name: string; qty: number; revenue: number }>();
    sales.forEach((s) =>
      s.items.forEach((i) => {
        const cur = productMap.get(i.productId) ?? {
          name: i.name,
          qty: 0,
          revenue: 0,
        };
        cur.qty += i.qty;
        cur.revenue += i.price * i.qty;
        productMap.set(i.productId, cur);
      }),
    );
    const top = [...productMap.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    // Payment mix (cash vs non-cash)
    const cash = sales.filter((s) => s.isCash).length;
    const nonCash = sales.filter((s) => !s.isCash).length;
    const mix = [
      { name: "Cash", value: cash },
      { name: "Non-cash", value: nonCash },
    ];

    return {
      todayRevenue,
      todayCount: todaySales.length,
      itemsSold,
      avgBasket,
      days,
      top,
      mix,
    };
  }, [sales]);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Dashboard</h1>
        <div className={styles.subtitle}>Today's performance at a glance</div>
      </div>

      <div className={styles.kpis}>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Today's revenue</div>
          <div className={styles.kpiValue}>{formatCurrency(stats.todayRevenue)}</div>
          <div className={styles.kpiDelta}>{stats.todayCount} transactions</div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Average basket</div>
          <div className={styles.kpiValue}>{formatCurrency(stats.avgBasket)}</div>
          <div className={styles.kpiDelta}>per sale</div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>Items sold</div>
          <div className={styles.kpiValue}>{stats.itemsSold}</div>
          <div className={styles.kpiDelta}>units today</div>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiLabel}>All-time sales</div>
          <div className={styles.kpiValue}>{sales.length}</div>
          <div className={styles.kpiDelta}>transactions logged</div>
        </div>
      </div>

      <div className={styles.charts}>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Revenue · last 7 days</div>
          <div className={styles.cardSub}>Daily totals across all cashiers</div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={stats.days} margin={{ left: -12, right: 8, top: 8 }}>
              <CartesianGrid stroke="#eef0f6" vertical={false} />
              <XAxis dataKey="day" stroke="#8a93a6" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#8a93a6" fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip
                formatter={(v: number) => formatCurrency(v)}
                contentStyle={{
                  borderRadius: 10,
                  border: "1px solid #e3e6ee",
                  fontSize: 12,
                }}
              />
              <Line
                type="monotone"
                dataKey="revenue"
                stroke="#4f46e5"
                strokeWidth={2.5}
                dot={{ r: 4, fill: "#4f46e5" }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}>Payment mix</div>
          <div className={styles.cardSub}>By transaction count</div>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={stats.mix}
                dataKey="value"
                nameKey="name"
                innerRadius={60}
                outerRadius={90}
                paddingAngle={3}
              >
                {stats.mix.map((_, i) => (
                  <Cell key={i} fill={i === 0 ? "#10b981" : "#4f46e5"} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ borderRadius: 10, border: "1px solid #e3e6ee", fontSize: 12 }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div style={{ display: "flex", justifyContent: "center", gap: 16, fontSize: 12, color: "var(--color-text-muted)" }}>
            <span>● <span style={{ color: "#10b981" }}>Cash</span> {stats.mix[0].value}</span>
            <span>● <span style={{ color: "#4f46e5" }}>Non-cash</span> {stats.mix[1].value}</span>
          </div>
        </div>
      </div>

      <div className={styles.row2}>
        <div className={styles.card}>
          <div className={styles.cardTitle}>Top products by revenue</div>
          <div className={styles.cardSub}>All-time</div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart
              data={stats.top.map((t) => ({ name: t.name, revenue: +t.revenue.toFixed(2) }))}
              layout="vertical"
              margin={{ left: 8, right: 16 }}
            >
              <CartesianGrid stroke="#eef0f6" horizontal={false} />
              <XAxis type="number" stroke="#8a93a6" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis
                type="category"
                dataKey="name"
                stroke="#8a93a6"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                width={130}
              />
              <Tooltip
                formatter={(v: number) => formatCurrency(v)}
                contentStyle={{ borderRadius: 10, border: "1px solid #e3e6ee", fontSize: 12 }}
              />
              <Bar dataKey="revenue" radius={[0, 6, 6, 0]}>
                {stats.top.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}>Best sellers</div>
          <div className={styles.cardSub}>Units sold</div>
          <div className={styles.topList}>
            {stats.top.length === 0 && (
              <div style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
                No sales yet.
              </div>
            )}
            {stats.top.map((t, i) => (
              <div key={i} className={styles.topItem}>
                <div className={styles.topRank}>{i + 1}</div>
                <div className={styles.topName}>{t.name}</div>
                <div className={styles.topVal}>{t.qty} sold</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
