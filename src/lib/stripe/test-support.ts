import type { Db } from "../coach/db";
import type { StripeConfig, StripeWebhookConfig } from "./config";
import { stripeSignature } from "./signature";
import { handleStripeWebhook } from "./sync";

/**
 * A Stripe stand-in for tests: checkout sessions, payment intents and refunds
 * held in memory, answering the same REST calls as api.ts. Like Stripe, a
 * repeated Idempotency-Key returns the same session. Requests to anything
 * else go to `fallback` (the test database's fetch).
 */

export const testStripe: StripeConfig = { environment: "sandbox", baseUrl: "https://api.stripe.test", secretKey: "sk_test_not_real" };
export const testWebhook: StripeWebhookConfig = { environment: "sandbox", signingSecret: "whsec_test_not_real" };

export interface StripeCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  form: URLSearchParams;
}

/** Stripe ids are unique across the whole run, as in Stripe (the database refuses a repeated session id). */
let ids = 0;

export function stripeStandIn(fallback: (url: string, init?: RequestInit) => Promise<Response>, config: StripeConfig = testStripe) {
  const sessions = new Map<string, Record<string, unknown>>();
  const byKey = new Map<string, string>();
  const refunds = new Map<string, Record<string, unknown>>();
  const customers = new Map<string, string>(); // idempotency key -> customer id
  const setupIntents = new Map<string, Record<string, unknown>>();
  const intents = new Map<string, Record<string, unknown>>();
  const intentByKey = new Map<string, string>();
  const methods = new Map<string, Record<string, unknown>>(); // payment method id -> payment method
  let intentStatus = 0; // when set, creating a payment intent is refused with this status
  const calls: StripeCall[] = [];
  let down = false;
  const created = () => Math.floor(Date.parse("2026-10-20T10:00:00Z") / 1000);

  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const u = String(url);
    if (!u.startsWith(config.baseUrl)) return fallback(url, init);
    const [path, query = ""] = u.slice(config.baseUrl.length).split("?");
    const form = new URLSearchParams(init.method === "POST" ? String(init.body ?? "") : query);
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ method: init.method ?? "GET", path, headers, form });
    if (down) return Response.json({ error: { type: "api_error" } }, { status: 500 });

    if (init.method === "POST" && path === "/v1/customers") {
      const key = headers["Idempotency-Key"];
      if (!byKey.has(`c:${key}`)) byKey.set(`c:${key}`, `cus_test_${++ids}`);
      customers.set(byKey.get(`c:${key}`)!, form.get("email") ?? "");
      return Response.json({ id: byKey.get(`c:${key}`), object: "customer" });
    }
    if (init.method === "POST" && path === "/v1/payment_intents") {
      if (intentStatus) return Response.json({ error: { type: "invalid_request_error" } }, { status: intentStatus });
      const key = headers["Idempotency-Key"];
      if (!intentByKey.has(key)) {
        const id = `pi_test_${++ids}`;
        // A card answers at once; a Direct Debit is "processing" until Bacs clears.
        const card = form.get("payment_method_types[0]") === "card";
        intents.set(id, {
          id, object: "payment_intent", status: card ? "succeeded" : "processing", amount: Number(form.get("amount")), currency: form.get("currency"), created: created(),
          customer: form.get("customer"), payment_method: form.get("payment_method"),
        });
        intentByKey.set(key, id);
      }
      return Response.json(intents.get(intentByKey.get(key)!));
    }
    // Detaching a saved method (for Bacs, this cancels its mandate). Stripe refuses a second detach.
    const detach = path.match(/^\/v1\/payment_methods\/([\w-]+)\/detach$/);
    if (init.method === "POST" && detach) {
      const m = methods.get(detach[1]);
      if (!m || m.detached) return Response.json({ error: {} }, { status: m ? 400 : 404 });
      methods.set(detach[1], { ...m, detached: true, customer: null });
      return Response.json(methods.get(detach[1]));
    }
    const oneMethod = path.match(/^\/v1\/payment_methods\/([\w-]+)$/);
    if (init.method !== "POST" && oneMethod) return methods.has(oneMethod[1]) ? Response.json(methods.get(oneMethod[1])) : Response.json({ error: {} }, { status: 404 });
    const oneIntent = path.match(/^\/v1\/payment_intents\/([\w-]+)$/);
    if (init.method !== "POST" && oneIntent) return intents.has(oneIntent[1]) ? Response.json(intents.get(oneIntent[1])) : Response.json({ error: {} }, { status: 404 });
    const oneSetup = path.match(/^\/v1\/setup_intents\/([\w-]+)$/);
    if (init.method !== "POST" && oneSetup) return setupIntents.has(oneSetup[1]) ? Response.json(setupIntents.get(oneSetup[1])) : Response.json({ error: {} }, { status: 404 });
    if (init.method === "POST" && path === "/v1/checkout/sessions" && form.get("mode") === "setup") {
      const id = `cs_test_${++ids}`;
      const setup = `seti_test_${++ids}`;
      setupIntents.set(setup, { id: setup, status: "requires_payment_method", customer: form.get("customer"), payment_method: null, mandate: null });
      sessions.set(id, {
        id, object: "checkout.session", mode: "setup", status: "open", payment_status: "no_payment_required", setup_intent: setup,
        method_type: form.get("payment_method_types[0]"), consent: form.get("custom_text[submit][message]"),
        customer: form.get("customer"), client_reference_id: form.get("client_reference_id"), amount_total: null, currency: null,
        created: created(), url: `https://checkout.stripe.test/c/setup/${id}`,
      });
      return Response.json(sessions.get(id));
    }
    if (init.method === "POST" && path === "/v1/checkout/sessions") {
      const key = headers["Idempotency-Key"];
      if (!key || !byKey.has(key)) {
        const id = `cs_test_${++ids}`;
        sessions.set(id, {
          id,
          object: "checkout.session",
          mode: form.get("mode") ?? "payment",
          status: "open",
          payment_status: "unpaid",
          payment_intent: null,
          amount_total: Number(form.get("line_items[0][price_data][unit_amount]") ?? 0),
          currency: "gbp",
          created: created(),
          customer: form.get("customer"),
          client_reference_id: form.get("client_reference_id"),
          keeps_card: form.get("payment_intent_data[setup_future_usage]") === "off_session",
          consent: form.get("custom_text[submit][message]"),
          url: `https://checkout.stripe.test/c/pay/${id}`,
        });
        if (key) byKey.set(key, id);
      }
      return Response.json(sessions.get(key ? byKey.get(key)! : `cs_test_${ids}`));
    }
    // Closing a page: only an open one (Stripe answers 400 for an expired or completed one).
    const expireOne = path.match(/^\/v1\/checkout\/sessions\/([\w-]+)\/expire$/);
    if (init.method === "POST" && expireOne) {
      const sess = sessions.get(expireOne[1]);
      if (!sess) return Response.json({ error: {} }, { status: 404 });
      if (sess.status !== "open") return Response.json({ error: {} }, { status: 400 });
      sessions.set(expireOne[1], { ...sess, status: "expired" });
      return Response.json(sessions.get(expireOne[1]));
    }
    const one = path.match(/^\/v1\/checkout\/sessions\/([\w-]+)$/);
    if (init.method !== "POST" && one) return sessions.has(one[1]) ? Response.json(sessions.get(one[1])) : Response.json({ error: {} }, { status: 404 });
    if (path === "/v1/checkout/sessions") {
      const pi = form.get("payment_intent");
      return Response.json({ data: [...sessions.values()].filter((s) => s.payment_intent === pi) });
    }
    const oneRefund = path.match(/^\/v1\/refunds\/([\w-]+)$/);
    if (oneRefund) return refunds.has(oneRefund[1]) ? Response.json(refunds.get(oneRefund[1])) : Response.json({ error: {} }, { status: 404 });
    if (path === "/v1/refunds") {
      const pi = form.get("payment_intent");
      return Response.json({ data: [...refunds.values()].filter((r) => r.payment_intent === pi) });
    }
    return Response.json({}, { status: 404 });
  }) as typeof fetch;

  return {
    fetchImpl,
    calls,
    sessions,
    setDown: (value: boolean) => (down = value),
    /** The customer paid this session: Stripe now says it is complete and paid. */
    pay(sessionId: string, amountPence?: number, extra: Record<string, unknown> = {}) {
      const intent = `pi_test_${++ids}`;
      const s = sessions.get(sessionId)!;
      const method = s.keeps_card ? `pm_test_${++ids}` : null;
      if (method) methods.set(method, { id: method, object: "payment_method", type: "card", card: { brand: "visa", last4: "4242" } });
      intents.set(intent, { id: intent, object: "payment_intent", status: "succeeded", amount: amountPence ?? s.amount_total, currency: "gbp", created: created(), customer: s.customer ?? null, payment_method: method });
      sessions.set(sessionId, { ...s, status: "complete", payment_status: "paid", payment_intent: intent, ...(amountPence === undefined ? {} : { amount_total: amountPence }), ...extra });
      return intent;
    },
    expire(sessionId: string) {
      sessions.set(sessionId, { ...sessions.get(sessionId)!, status: "expired" });
    },
    patch(sessionId: string, patch: Record<string, unknown>) {
      sessions.set(sessionId, { ...sessions.get(sessionId)!, ...patch });
    },
    customers,
    intents,
    /** The member finished Stripe's Direct Debit page: a Bacs method and mandate are on file. */
    completeSetup(sessionId: string) {
      const s = sessions.get(sessionId)!;
      const seti = String(s.setup_intent);
      const card = s.method_type === "card";
      const method = `pm_test_${++ids}`;
      methods.set(method, card ? { id: method, object: "payment_method", type: "card", card: { brand: "mastercard", last4: "4444" } } : { id: method, object: "payment_method", type: "bacs_debit" });
      setupIntents.set(seti, { ...setupIntents.get(seti)!, status: "succeeded", payment_method: method, mandate: card ? null : `mandate_test_${++ids}` });
      sessions.set(sessionId, { ...s, status: "complete" });
      return setupIntents.get(seti)!;
    },
    /** Bacs cleared (about three working days after submission). */
    succeedIntent(id: string) {
      intents.set(id, { ...intents.get(id)!, status: "succeeded" });
    },
    failIntent(id: string) {
      intents.set(id, { ...intents.get(id)!, status: "requires_payment_method" });
    },
    /** Stripe refuses to create payment intents from now on (0 = accepts again). */
    refuseIntents: (status: number) => (intentStatus = status),
    refund(paymentIntent: string, amountPence: number, status = "succeeded") {
      const id = `re_test_${++ids}`;
      refunds.set(id, { id, object: "refund", status, payment_intent: paymentIntent, amount: amountPence, currency: "gbp", created: created() + 86_400 });
      return id;
    },
  };
}

export type StripeStandIn = ReturnType<typeof stripeStandIn>;

/** A signed Stripe event body and its Stripe-Signature header. */
export function signedEvent(event: Record<string, unknown>, secret = testWebhook.signingSecret, timestamp = Math.floor(Date.now() / 1000)) {
  const raw = JSON.stringify(event);
  return { raw, signature: `t=${timestamp},v1=${stripeSignature(raw, secret, timestamp)}`, timestamp };
}

let eventCounter = 0;
/** Delivers a signed event of `type` about `objectId` to the webhook handler. */
export function deliverStripeEvent(db: Db, api: StripeStandIn, type: string, object: Record<string, unknown>, eventId = `evt_test_${++eventCounter}`, config: StripeConfig = testStripe) {
  const { raw, signature, timestamp } = signedEvent({ id: eventId, object: "event", type, created: 1_792_000_000, data: { object } });
  return handleStripeWebhook(db, config, testWebhook, raw, signature, api.fetchImpl, timestamp);
}
