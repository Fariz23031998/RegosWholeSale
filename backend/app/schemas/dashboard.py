from pydantic import BaseModel, Field


class DashboardDayPoint(BaseModel):
    day: str
    sales: float
    cost: float
    profit: float


class DashboardTopProduct(BaseModel):
    item_id: int
    name: str
    qty: float
    revenue: float


class DashboardPartnerPoint(BaseModel):
    name: str
    count: int


class DashboardPaymentRow(BaseModel):
    id: int
    code: str
    date: int
    amount: float | None = None
    category_id: int | None = None
    category_name: str | None = None
    payment_type_name: str | None = None
    partner_name: str | None = None


class DashboardProductRow(BaseModel):
    item_id: int
    code: str = ""
    name: str
    category: str = ""
    purchase_cost: float | None = None
    average_price: float = 0.0
    sold_quantity: float = 0.0
    sold_purchase_cost: float = 0.0
    sold_total: float = 0.0
    refund_quantity: float = 0.0
    refund_purchase_cost: float = 0.0
    refund_total: float = 0.0
    net_sold_quantity: float = 0.0
    net_purchase_cost: float = 0.0
    net_total_sells: float = 0.0
    net_gross_profit: float = 0.0


class DashboardProductsResponse(BaseModel):
    products: list[DashboardProductRow] = Field(default_factory=list)
    next_offset: int = 0
    total: int = 0


class DashboardStatsResponse(BaseModel):
    sales_total: float
    cost_total: float
    gross_profit: float
    refunds_cost_total: float
    net_sales_total: float
    net_cost_total: float
    net_gross_profit: float
    transaction_count: int
    items_sold: float
    avg_basket: float
    refunds_total: float
    refund_count: int
    income_payments_total: float
    outcome_payments_total: float
    income_payment_category_name: str | None = None
    outcome_payment_category_name: str | None = None
    income_payments: list[DashboardPaymentRow] = Field(default_factory=list)
    outcome_payments: list[DashboardPaymentRow] = Field(default_factory=list)
    days: list[DashboardDayPoint] = Field(default_factory=list)
    top_products: list[DashboardTopProduct] = Field(default_factory=list)
    top_partners: list[DashboardPartnerPoint] = Field(default_factory=list)
    sales_count_total: int = 0
