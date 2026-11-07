import type { ShopifyCredentials } from "@/lib/platforms/types";

const API_VERSION = process.env.SHOPIFY_API_VERSION ?? "2026-07";
// SSRF guard: users type the shop domain and the server fetches from it, so it
// must be a myshopify.com host. SHOPIFY_BASE_URL (server env only) is for tests.
export const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function normaliseShopDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

export interface ShopifySales {
  shopName: string;
  currency: string;
  netRevenue: number; // after discounts & refunds, ex tax and shipping
  orders: number;
  newCustomers: number;
  returningOrders: number;
  aov: number;
  truncated: boolean; // hit the page cap, so numbers are a floor
}

interface OrderNode {
  createdAt: string;
  cancelledAt: string | null;
  test: boolean;
  currentSubtotalPriceSet: { shopMoney: { amount: string } };
  customer: { id: string; createdAt: string } | null;
}

const QUERY = `
query Orders($q: String!, $cursor: String) {
  shop { name currencyCode }
  orders(first: 100, after: $cursor, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      createdAt cancelledAt test
      currentSubtotalPriceSet { shopMoney { amount } }
      customer { id createdAt }
    }
  }
}`;

const MAX_PAGES = 50; // 5,000 orders per refresh

export interface ProductSales {
  productId: string;
  title: string;
  units: number;
  revenue: number; // line revenue after line discounts, before refunds
  cost: number; // units x unit cost, only for lines whose cost is known
  costedRevenue: number; // revenue of lines with a known cost
  unitsMissingCost: number;
}

export interface ProductSalesResult {
  currency: string;
  ordersScanned: number;
  products: ProductSales[];
  truncated: boolean; // hit the order cap: a recent-orders sample
}

const PRODUCT_QUERY = `
query ProductSales($q: String!, $cursor: String) {
  shop { currencyCode }
  orders(first: 25, after: $cursor, query: $q, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      cancelledAt test
      lineItems(first: 20) {
        nodes {
          quantity title
          discountedTotalSet { shopMoney { amount } }
          product { id title }
          variant { inventoryItem { unitCost { amount } } }
        }
      }
    }
  }
}`;

export class ShopifyClient {
  private lastThrottle?: { wait: () => Promise<void> };
  constructor(private creds: ShopifyCredentials) {}

  private async gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    if (!SHOP_DOMAIN_RE.test(this.creds.shop)) throw new Error("Invalid shop domain");
    const base = process.env.SHOPIFY_BASE_URL ?? `https://${this.creds.shop}`;
    const res = await fetch(`${base}/admin/api/${API_VERSION}/graphql.json`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Shopify-Access-Token": this.creds.accessToken,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error("Shopify rejected the access token (check the token and its scopes)");
    }
    if (!res.ok) throw new Error(`Shopify API ${res.status}`);
    const json = (await res.json()) as {
      data?: T;
      errors?: { message: string }[];
      extensions?: {
        cost?: {
          requestedQueryCost: number;
          throttleStatus: { currentlyAvailable: number; restoreRate: number };
        };
      };
    };
    if (json.errors?.length) throw new Error(`Shopify: ${json.errors[0].message}`);
    const cost = json.extensions?.cost;
    if (cost) {
      // Wait until the bucket can afford the next page of the same size.
      const missing = cost.requestedQueryCost * 1.1 - cost.throttleStatus.currentlyAvailable;
      const ms = missing > 0 ? Math.ceil((missing / cost.throttleStatus.restoreRate) * 1000) : 0;
      this.lastThrottle = { wait: () => new Promise((r) => setTimeout(r, ms)) };
    }
    return json.data as T;
  }

  async testConnection(): Promise<string> {
    const d = await this.gql<{ shop: { name: string; currencyCode: string } }>(
      `{ shop { name currencyCode } }`,
    );
    return `${d.shop.name} (${d.shop.currencyCode})`;
  }

  async fetchSales(days: number): Promise<ShopifySales> {
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const q = `created_at:>=${since} AND test:false`;

    let cursor: string | null = null;
    let shopName = "", currency = "";
    let net = 0, orders = 0, returning = 0;
    const newCustomerIds = new Set<string>();
    let newGuestOrders = 0;
    let truncated = false;

    for (let page = 0; ; page++) {
      if (page >= MAX_PAGES) { truncated = true; break; }
      const d: {
        shop: { name: string; currencyCode: string };
        orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: OrderNode[] };
      } = await this.gql(QUERY, { q, cursor });
      shopName = d.shop.name;
      currency = d.shop.currencyCode;

      for (const o of d.orders.nodes) {
        if (o.cancelledAt || o.test) continue;
        orders++;
        net += Number(o.currentSubtotalPriceSet.shopMoney.amount);
        // Approximation: Shopify's customer.createdAt is within a day of their
        // first order for normal checkouts, so treat that as a new customer.
        const isNew =
          !o.customer ||
          Math.abs(Date.parse(o.createdAt) - Date.parse(o.customer.createdAt)) <= 86_400_000;
        if (!isNew) returning++;
        else if (o.customer) newCustomerIds.add(o.customer.id);
        else newGuestOrders++;
      }
      if (!d.orders.pageInfo.hasNextPage) break;
      cursor = d.orders.pageInfo.endCursor;
    }

    return {
      shopName,
      currency,
      netRevenue: net,
      orders,
      newCustomers: newCustomerIds.size + newGuestOrders,
      returningOrders: returning,
      aov: orders ? net / orders : 0,
      truncated,
    };
  }

  /**
   * Product-level sales and Shopify's own unit costs. Line items make queries
   * expensive, so this scans the most recent orders up to `maxOrders` and
   * respects Shopify's rate limit instead of failing on it.
   */
  async fetchProductSales(days: number, maxOrders = 1500): Promise<ProductSalesResult> {
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const q = `created_at:>=${since} AND test:false`;
    const byProduct = new Map<string, ProductSales>();
    let cursor: string | null = null;
    let scanned = 0;
    let currency = "";
    let truncated = false;

    for (;;) {
      const d: {
        shop: { currencyCode: string };
        orders: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: {
            cancelledAt: string | null;
            test: boolean;
            lineItems: {
              nodes: {
                quantity: number;
                title: string;
                discountedTotalSet: { shopMoney: { amount: string } };
                product: { id: string; title: string } | null;
                variant: { inventoryItem: { unitCost: { amount: string } | null } | null } | null;
              }[];
            };
          }[];
        };
      } = await this.gql(PRODUCT_QUERY, { q, cursor });
      currency = d.shop.currencyCode;

      for (const o of d.orders.nodes) {
        if (o.cancelledAt || o.test) continue;
        scanned++;
        for (const li of o.lineItems.nodes) {
          const id = li.product?.id ?? `custom:${li.title}`;
          const p = byProduct.get(id) ?? {
            productId: id,
            title: li.product?.title ?? li.title,
            units: 0, revenue: 0, cost: 0, costedRevenue: 0, unitsMissingCost: 0,
          };
          const rev = Number(li.discountedTotalSet.shopMoney.amount);
          const unitCost = li.variant?.inventoryItem?.unitCost?.amount;
          p.units += li.quantity;
          p.revenue += rev;
          if (unitCost != null) {
            p.cost += Number(unitCost) * li.quantity;
            p.costedRevenue += rev;
          } else {
            p.unitsMissingCost += li.quantity;
          }
          byProduct.set(id, p);
        }
      }
      if (!d.orders.pageInfo.hasNextPage) break;
      if (scanned >= maxOrders) { truncated = true; break; }
      cursor = d.orders.pageInfo.endCursor;
      await this.lastThrottle?.wait();
    }
    return { currency, ordersScanned: scanned, products: [...byProduct.values()], truncated };
  }
}
