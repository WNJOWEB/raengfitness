import { STRIPE_API_VERSION, type StripeConfig } from "./config";

/**
 * The few Stripe REST calls the site makes, with plain fetch (no SDK, like
 * Supabase and Resend). Requests are form-encoded, as Stripe requires. Errors
 * are reduced to an HTTP status: Stripe's error text and the secret key never
 * reach logs or the browser.
 */

export type StripeResult<T> = { ok: true; data: T } | { ok: false; status: number | null };

/** Stripe's nested form encoding: a[b][0][c]=v. Only the shapes this file sends. */
export function formEncode(value: Record<string, unknown>): string {
  const pairs: string[] = [];
  const walk = (prefix: string, v: unknown) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) v.forEach((item, i) => walk(`${prefix}[${i}]`, item));
    else if (typeof v === "object") for (const [k, inner] of Object.entries(v)) walk(`${prefix}[${k}]`, inner);
    else pairs.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(v))}`);
  };
  for (const [k, v] of Object.entries(value)) walk(k, v);
  return pairs.join("&");
}

async function call<T>(
  config: StripeConfig,
  method: "GET" | "POST",
  path: string,
  options: { body?: Record<string, unknown>; query?: Record<string, string>; idempotencyKey?: string },
  read: (json: unknown) => T | undefined,
  fetchImpl: typeof fetch,
): Promise<StripeResult<T>> {
  try {
    const query = options.query ? `?${new URLSearchParams(options.query)}` : "";
    const response = await fetchImpl(`${config.baseUrl}${path}${query}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        "Stripe-Version": STRIPE_API_VERSION,
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      },
      body: options.body ? formEncode(options.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { ok: false, status: response.status };
    const data = read(await response.json());
    return data !== undefined ? { ok: true, data } : { ok: false, status: 502 };
  } catch {
    return { ok: false, status: null };
  }
}

const obj = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);
/** A reference that Stripe returns as an id, or as the expanded object. */
const ref = (v: unknown): string | null => str(v) ?? str(obj(v)?.id);

export interface CheckoutSession {
  id: string;
  /** open | complete | expired */
  status: string;
  /** paid | unpaid | no_payment_required */
  paymentStatus: string;
  paymentIntentId: string | null;
  amountTotalPence: number;
  currency: string;
  livemode: boolean;
  /** Unix seconds. */
  created: number;
  url: string | null;
}

function readSession(json: unknown): CheckoutSession | undefined {
  const s = obj(json);
  const id = str(s?.id);
  const status = str(s?.status);
  const paymentStatus = str(s?.payment_status);
  const amount = int(s?.amount_total);
  const currency = str(s?.currency);
  const created = int(s?.created);
  if (!s || !id || !status || !paymentStatus || amount === null || !currency || created === null || typeof s.livemode !== "boolean") return undefined;
  return { id, status, paymentStatus, paymentIntentId: ref(s.payment_intent), amountTotalPence: amount, currency, livemode: s.livemode, created, url: str(s.url) };
}

/**
 * Stripe-hosted checkout for one amount, card only, in GBP. The idempotency key
 * makes a retried call return the same session. Metadata carries our link id
 * (an opaque UUID, no personal data) so a payment in the Dashboard can be traced.
 */
export function createCheckoutSession(
  config: StripeConfig,
  args: { idempotencyKey: string; name: string; amountPence: number; linkId: string; successUrl: string },
  fetchImpl: typeof fetch = fetch,
): Promise<StripeResult<CheckoutSession & { url: string }>> {
  return call(
    config,
    "POST",
    "/v1/checkout/sessions",
    {
      idempotencyKey: args.idempotencyKey,
      body: {
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [{ quantity: 1, price_data: { currency: "gbp", unit_amount: args.amountPence, product_data: { name: args.name.slice(0, 250) } } }],
        success_url: args.successUrl,
        client_reference_id: args.linkId,
        metadata: { akb_link: args.linkId },
        payment_intent_data: { metadata: { akb_link: args.linkId } },
      },
    },
    (json) => {
      const session = readSession(json);
      return session && session.url?.startsWith("https://") ? { ...session, url: session.url } : undefined;
    },
    fetchImpl,
  );
}

export function getSession(config: StripeConfig, id: string, fetchImpl: typeof fetch = fetch): Promise<StripeResult<CheckoutSession>> {
  return call(config, "GET", `/v1/checkout/sessions/${encodeURIComponent(id)}`, {}, readSession, fetchImpl);
}

/** The session that collected a payment (for a refund that arrives before its payment's webhook). */
export function getSessionByPaymentIntent(config: StripeConfig, paymentIntentId: string, fetchImpl: typeof fetch = fetch): Promise<StripeResult<CheckoutSession | null>> {
  return call(
    config,
    "GET",
    "/v1/checkout/sessions",
    { query: { payment_intent: paymentIntentId, limit: "1" } },
    (json): CheckoutSession | null | undefined => {
      const list = obj(json);
      if (!list || !Array.isArray(list.data)) return undefined;
      // An empty list is a valid answer ("not one of ours"), not a failure.
      return list.data.length ? (readSession(list.data[0]) ?? undefined) : null;
    },
    fetchImpl,
  );
}

export interface StripeRefund {
  id: string;
  /** pending | requires_action | succeeded | failed | canceled */
  status: string;
  paymentIntentId: string | null;
  amountPence: number;
  currency: string;
  livemode: boolean;
  /** Unix seconds. */
  created: number;
}

export function getRefund(config: StripeConfig, id: string, fetchImpl: typeof fetch = fetch): Promise<StripeResult<StripeRefund>> {
  return call(config, "GET", `/v1/refunds/${encodeURIComponent(id)}`, {}, (json) => {
    const r = obj(json);
    const rid = str(r?.id);
    const status = str(r?.status);
    const amount = int(r?.amount);
    const currency = str(r?.currency);
    const created = int(r?.created);
    if (!r || !rid || !status || amount === null || !currency || created === null || typeof r.livemode !== "boolean") return undefined;
    return { id: rid, status, paymentIntentId: ref(r.payment_intent), amountPence: amount, currency, livemode: r.livemode, created };
  }, fetchImpl);
}
