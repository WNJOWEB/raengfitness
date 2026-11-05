import { STRIPE_API_VERSION, type StripeConfig } from "./config";

/**
 * The few Stripe REST calls the site makes, with plain fetch (no SDK, like
 * Supabase and Resend). Errors are reduced to an HTTP status: Stripe's error
 * text and the secret key never reach logs or the browser.
 */

export type StripeResult<T> = { ok: true; data: T } | { ok: false; status: number | null };

interface Form {
  [key: string]: string | number | boolean | undefined | Form;
}

/** Stripe takes form bodies with bracketed keys: a[b][0]=c. */
function encode(form: Form, prefix = "", out: URLSearchParams = new URLSearchParams()): URLSearchParams {
  for (const [key, value] of Object.entries(form)) {
    if (value === undefined) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === "object") encode(value, name, out);
    else out.append(name, String(value));
  }
  return out;
}

async function call<T>(
  config: StripeConfig,
  method: "GET" | "POST",
  path: string,
  form: Form | undefined,
  read: (json: unknown) => T | null,
  fetchImpl: typeof fetch,
  idempotencyKey?: string,
): Promise<StripeResult<T>> {
  try {
    const query = method === "GET" && form ? `?${encode(form)}` : "";
    const response = await fetchImpl(`${config.baseUrl}${path}${query}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        "Stripe-Version": STRIPE_API_VERSION,
        Accept: "application/json",
        ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey.slice(0, 255) } : {}),
      },
      body: method === "POST" && form ? encode(form).toString() : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { ok: false, status: response.status };
    const data = read(await response.json());
    return data ? { ok: true, data } : { ok: false, status: 502 };
  } catch {
    return { ok: false, status: null };
  }
}

const obj = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);
const iso = (unixSeconds: unknown): string | null => {
  const n = int(unixSeconds);
  return n === null ? null : new Date(n * 1000).toISOString();
};

/** A Stripe id from either the id itself or an expanded object. */
const idOf = (v: unknown): string | null => str(v) ?? str(obj(v)?.id);

export interface CheckoutSessionLink {
  id: string;
  url: string;
}

/**
 * Stripe-hosted checkout for one card payment in GBP. The idempotency key makes
 * a retried call return the same session. successUrl: where Stripe sends the
 * buyer after paying (only a "thanks" page: payment state always comes from
 * the signed webhook). `savePaymentMethod` keeps the card for the membership's
 * later set-up step.
 */
export function createPaymentSession(
  config: StripeConfig,
  args: {
    idempotencyKey: string;
    name: string;
    amountPence: number;
    note: string;
    buyerEmail?: string;
    successUrl: string;
    cancelUrl: string;
    customerId?: string;
    metadata?: Record<string, string>;
    /** A membership payment: keeps the card for the renewals (needs customerId), with this consent line shown beside the pay button. */
    saveCard?: { clientReference: string; consent: string };
    /** Stripe's page stops accepting payment after this many minutes. Stripe needs 30 minutes to 24 hours from when it receives the request, so this is kept between 31 and 1,439 (a request that arrives a moment late would otherwise be refused). Stripe's own default is 24 hours. */
    expiresInMinutes?: number;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<StripeResult<CheckoutSessionLink>> {
  return call(
    config,
    "POST",
    "/v1/checkout/sessions",
    {
      mode: "payment",
      payment_method_types: { 0: "card" },
      line_items: { 0: { quantity: 1, price_data: { currency: "gbp", unit_amount: args.amountPence, product_data: { name: args.name.slice(0, 250) } } } },
      success_url: args.successUrl,
      cancel_url: args.cancelUrl,
      ...(args.expiresInMinutes ? { expires_at: Math.floor(Date.now() / 1000) + Math.min(Math.max(Math.round(args.expiresInMinutes), 31), 1439) * 60 } : {}),
      ...(args.customerId ? { customer: args.customerId } : args.buyerEmail ? { customer_email: args.buyerEmail } : {}),
      payment_intent_data: { description: args.note.slice(0, 500), ...(args.saveCard && args.customerId ? { setup_future_usage: "off_session" } : {}) },
      ...(args.saveCard && args.customerId ? { client_reference_id: args.saveCard.clientReference, custom_text: { submit: { message: args.saveCard.consent.slice(0, 1000) } } } : {}),
      ...(args.metadata ? { metadata: args.metadata } : {}),
    },
    (json) => {
      const s = obj(json);
      const id = str(s?.id);
      const url = str(s?.url);
      // Stripe's pages are https; the localhost API stand-in (tests only) serves its own checkout page.
      const ok = url?.startsWith("https://") || (config.baseUrl.startsWith("http://localhost:") && url?.startsWith("http://localhost:"));
      return id && url && ok ? { id, url } : null;
    },
    fetchImpl,
    args.idempotencyKey,
  );
}

/**
 * Closes a payment page nobody should pay any more (it was replaced by a newer
 * one), so a stale tab can't take a second payment. Best effort: a page that
 * is already paid or expired just answers with an error, which is fine.
 */
export function expireCheckoutSession(config: StripeConfig, sessionId: string, fetchImpl: typeof fetch = fetch): Promise<StripeResult<{ id: string }>> {
  return call(config, "POST", `/v1/checkout/sessions/${encodeURIComponent(sessionId)}/expire`, {}, (json) => {
    const id = str(obj(json)?.id);
    return id ? { id } : null;
  }, fetchImpl);
}

export interface CheckoutSession {
  id: string;
  mode: string;
  /** "open" | "complete" | "expired" */
  status: string;
  /** "paid" | "unpaid" | "no_payment_required" */
  paymentStatus: string;
  paymentIntentId: string | null;
  amountPence: number;
  currency: string;
  createdAt: string;
  customerId: string | null;
  setupIntentId: string | null;
  clientReference: string | null;
}

function readSession(json: unknown): CheckoutSession | null {
  const s = obj(json);
  const id = str(s?.id);
  const createdAt = iso(s?.created);
  if (!s || !id || !createdAt) return null;
  return {
    id,
    mode: str(s.mode) ?? "payment",
    status: str(s.status) ?? "open",
    paymentStatus: str(s.payment_status) ?? "unpaid",
    paymentIntentId: idOf(s.payment_intent),
    amountPence: int(s.amount_total) ?? 0,
    currency: (str(s.currency) ?? "gbp").toUpperCase(),
    createdAt,
    customerId: idOf(s.customer),
    setupIntentId: idOf(s.setup_intent),
    clientReference: str(s.client_reference_id),
  };
}

export function getCheckoutSession(config: StripeConfig, id: string, fetchImpl: typeof fetch = fetch): Promise<StripeResult<CheckoutSession>> {
  return call(config, "GET", `/v1/checkout/sessions/${encodeURIComponent(id)}`, undefined, readSession, fetchImpl);
}

/** The checkout session(s) that created a payment (to find a refund's payment). */
export function listSessionsForPaymentIntent(config: StripeConfig, paymentIntentId: string, fetchImpl: typeof fetch = fetch): Promise<StripeResult<CheckoutSession[]>> {
  return call(config, "GET", "/v1/checkout/sessions", { payment_intent: paymentIntentId, limit: 5 }, (json) => {
    const data = obj(json)?.data;
    return Array.isArray(data) ? data.map(readSession).filter((s): s is CheckoutSession => s !== null) : null;
  }, fetchImpl);
}

export interface StripeRefund {
  id: string;
  /** "succeeded" | "pending" | "failed" | "canceled" | "requires_action" */
  status: string;
  paymentIntentId: string;
  amountPence: number;
  currency: string;
  createdAt: string;
}

function readRefund(json: unknown): StripeRefund | null {
  const r = obj(json);
  const id = str(r?.id);
  const status = str(r?.status);
  const paymentIntentId = idOf(r?.payment_intent);
  const amount = int(r?.amount);
  const currency = str(r?.currency);
  const createdAt = iso(r?.created);
  if (!id || !status || !paymentIntentId || amount === null || !currency || !createdAt) return null;
  return { id, status, paymentIntentId, amountPence: amount, currency: currency.toUpperCase(), createdAt };
}

export function getRefund(config: StripeConfig, id: string, fetchImpl: typeof fetch = fetch): Promise<StripeResult<StripeRefund>> {
  return call(config, "GET", `/v1/refunds/${encodeURIComponent(id)}`, undefined, readRefund, fetchImpl);
}

/**
 * Refunds a card payment (all of `amountPence`, which the caller works out
 * from what is still unrefunded). The idempotency key makes a retried call
 * return the same refund, so a booking can never be refunded twice.
 */
export function createRefund(
  config: StripeConfig,
  args: { paymentIntentId: string; amountPence: number; idempotencyKey: string; metadata?: Record<string, string> },
  fetchImpl: typeof fetch = fetch,
): Promise<StripeResult<StripeRefund>> {
  return call(
    config,
    "POST",
    "/v1/refunds",
    { payment_intent: args.paymentIntentId, amount: args.amountPence, reason: "requested_by_customer", metadata: args.metadata ?? {} },
    readRefund,
    fetchImpl,
    args.idempotencyKey,
  );
}

export function listRefundsForPaymentIntent(config: StripeConfig, paymentIntentId: string, fetchImpl: typeof fetch = fetch): Promise<StripeResult<StripeRefund[]>> {
  return call(config, "GET", "/v1/refunds", { payment_intent: paymentIntentId, limit: 20 }, (json) => {
    const data = obj(json)?.data;
    return Array.isArray(data) ? data.map(readRefund).filter((r): r is StripeRefund => r !== null) : null;
  }, fetchImpl);
}

// ---------------------------------------------------------------------------
// Direct Debit (Bacs): a customer, a set-up checkout that collects the bank
// details and mandate, and off-session payments against the saved method.
// ---------------------------------------------------------------------------

export function createCustomer(
  config: StripeConfig,
  args: { idempotencyKey: string; email: string; name: string; clientId: string },
  fetchImpl: typeof fetch = fetch,
): Promise<StripeResult<{ id: string }>> {
  return call(
    config,
    "POST",
    "/v1/customers",
    { email: args.email, name: args.name.slice(0, 200), metadata: { client: args.clientId } },
    (json) => {
      const id = str(obj(json)?.id);
      return id ? { id } : null;
    },
    fetchImpl,
    args.idempotencyKey,
  );
}

/** Updates a customer's email (when the member changes theirs), so Stripe's receipts and Direct Debit notices follow. */
export function updateCustomerEmail(config: StripeConfig, customerId: string, email: string, fetchImpl: typeof fetch = fetch): Promise<StripeResult<{ id: string }>> {
  return call(config, "POST", `/v1/customers/${encodeURIComponent(customerId)}`, { email }, (json) => {
    const id = str(obj(json)?.id);
    return id ? { id } : null;
  }, fetchImpl);
}

/**
 * Stripe-hosted page that collects a Direct Debit mandate (bank details) for a
 * customer without taking money. `clientReference` comes back on the session so
 * the webhook knows whose it is.
 */
export function createDirectDebitSetupSession(
  config: StripeConfig,
  args: { idempotencyKey: string; customerId: string; clientReference: string; successUrl: string; cancelUrl: string; method?: "bacs_debit" | "card"; consent?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<StripeResult<CheckoutSessionLink>> {
  const method = args.method ?? "bacs_debit";
  return call(
    config,
    "POST",
    "/v1/checkout/sessions",
    {
      mode: "setup",
      // Bacs needs the currency named; a card page doesn't.
      ...(method === "bacs_debit" ? { currency: "gbp" } : {}),
      payment_method_types: { 0: method },
      ...(args.consent ? { custom_text: { submit: { message: args.consent.slice(0, 1000) } } } : {}),
      customer: args.customerId,
      client_reference_id: args.clientReference,
      success_url: args.successUrl,
      cancel_url: args.cancelUrl,
    },
    (json) => {
      const s = obj(json);
      const id = str(s?.id);
      const url = str(s?.url);
      const ok = url?.startsWith("https://") || (config.baseUrl.startsWith("http://localhost:") && url?.startsWith("http://localhost:"));
      return id && url && ok ? { id, url } : null;
    },
    fetchImpl,
    args.idempotencyKey,
  );
}

export interface StripeSetupIntent {
  id: string;
  /** "succeeded" | "processing" | "requires_payment_method" | "canceled" | ... */
  status: string;
  customerId: string | null;
  paymentMethodId: string | null;
  mandateId: string | null;
}

export function getSetupIntent(config: StripeConfig, id: string, fetchImpl: typeof fetch = fetch): Promise<StripeResult<StripeSetupIntent>> {
  return call(config, "GET", `/v1/setup_intents/${encodeURIComponent(id)}`, undefined, (json) => {
    const s = obj(json);
    const sid = str(s?.id);
    const status = str(s?.status);
    if (!sid || !status) return null;
    return { id: sid, status, customerId: idOf(s?.customer), paymentMethodId: idOf(s?.payment_method), mandateId: idOf(s?.mandate) };
  }, fetchImpl);
}

export interface StripePaymentIntent {
  id: string;
  /** "succeeded" | "processing" | "requires_payment_method" | "canceled" | ... */
  status: string;
  amountPence: number;
  currency: string;
  createdAt: string;
  customerId: string | null;
  paymentMethodId: string | null;
}

function readPaymentIntent(json: unknown): StripePaymentIntent | null {
  const p = obj(json);
  const id = str(p?.id);
  const status = str(p?.status);
  const amount = int(p?.amount);
  const currency = str(p?.currency);
  const createdAt = iso(p?.created);
  if (!id || !status || amount === null || !currency || !createdAt) return null;
  return { id, status, amountPence: amount, currency: currency.toUpperCase(), createdAt, customerId: idOf(p?.customer), paymentMethodId: idOf(p?.payment_method) };
}

export function getPaymentIntent(config: StripeConfig, id: string, fetchImpl: typeof fetch = fetch): Promise<StripeResult<StripePaymentIntent>> {
  return call(config, "GET", `/v1/payment_intents/${encodeURIComponent(id)}`, undefined, readPaymentIntent, fetchImpl);
}

/**
 * Takes a payment from a method the member saved, off session (the member
 * isn't there). A Direct Debit (Bacs) takes about three working days: the
 * intent is "processing" at first. A card answers at once (a declined card or
 * one that needs the bank's confirmation is a 402 here). Either way
 * `payment_intent.succeeded` / `.payment_failed` say how it ended. The
 * idempotency key (one per period and try) means a retried call never
 * charges twice.
 */
export function createDirectDebitPayment(
  config: StripeConfig,
  args: { idempotencyKey: string; customerId: string; paymentMethodId: string; amountPence: number; description: string; method?: "bacs_debit" | "card"; metadata?: Record<string, string> },
  fetchImpl: typeof fetch = fetch,
): Promise<StripeResult<StripePaymentIntent>> {
  return call(
    config,
    "POST",
    "/v1/payment_intents",
    {
      amount: args.amountPence,
      currency: "gbp",
      customer: args.customerId,
      payment_method: args.paymentMethodId,
      payment_method_types: { 0: args.method ?? "bacs_debit" },
      confirm: true,
      off_session: true,
      description: args.description.slice(0, 500),
      ...(args.metadata ? { metadata: args.metadata } : {}),
    },
    readPaymentIntent,
    fetchImpl,
    args.idempotencyKey,
  );
}

export interface StripePaymentMethod {
  id: string;
  /** "card" | "bacs_debit" | ... */
  type: string;
  /** For a card, e.g. "Visa ending 4242"; empty otherwise. */
  label: string;
}

/**
 * Detaches a saved payment method from its customer. For a Bacs Direct Debit
 * this cancels its mandate: Stripe tells the bank (the member's banking app
 * then shows it as cancelled) and emails the member, as Bacs requires.
 */
export function detachPaymentMethod(config: StripeConfig, id: string, fetchImpl: typeof fetch = fetch): Promise<StripeResult<{ id: string }>> {
  return call(config, "POST", `/v1/payment_methods/${encodeURIComponent(id)}/detach`, {}, (json) => {
    const mid = str(obj(json)?.id);
    return mid ? { id: mid } : null;
  }, fetchImpl, `detach-${id}`);
}

const BRANDS: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", amex: "American Express", discover: "Discover", diners: "Diners Club", jcb: "JCB", unionpay: "UnionPay" };

export function getPaymentMethod(config: StripeConfig, id: string, fetchImpl: typeof fetch = fetch): Promise<StripeResult<StripePaymentMethod>> {
  return call(config, "GET", `/v1/payment_methods/${encodeURIComponent(id)}`, undefined, (json) => {
    const m = obj(json);
    const mid = str(m?.id);
    const type = str(m?.type);
    if (!mid || !type) return null;
    const card = obj(m?.card);
    const last4 = str(card?.last4);
    const brand = BRANDS[str(card?.brand) ?? ""] ?? "Card";
    return { id: mid, type, label: type === "card" && last4 ? `${brand} ending ${last4.slice(-4)}` : "" };
  }, fetchImpl);
}
