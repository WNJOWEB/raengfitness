// Stand-in for Stripe during e2e tests: Checkout Sessions, refunds and a hosted
// "checkout" page. Paying on the page does what Stripe does: marks the session
// complete and paid, sends a signed checkout.session.completed webhook to the
// site, then sends the buyer to the session's success_url. Never used in builds
// deployed to Vercel: the API override only accepts localhost there off Vercel.
import { createHmac } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.MOCK_STRIPE_PORT ?? 3297);
const signingSecret = process.env.MOCK_STRIPE_WEBHOOK_SECRET ?? "whsec_e2e_not_real";
const webhookUrl = process.env.MOCK_STRIPE_WEBHOOK_URL ?? "http://localhost:3202/api/stripe/webhook";

let n = 0;
const byKey = new Map(); // idempotency key -> session id
const sessions = new Map(); // session id -> session
const setupIntents = new Map(); // setup intent id -> setup intent
const intents = new Map(); // payment intent id -> payment intent
const methods = new Map(); // payment method id -> payment method
const customers = new Map(); // idempotency key -> customer id
const refunds = new Map(); // refund id -> refund
const refundByKey = new Map(); // idempotency key -> refund id

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};
const read = (req) => new Promise((resolve) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => resolve(body));
});

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (req.method === "GET" && url.pathname === "/") return res.end("ok");
  if (req.method === "GET" && url.pathname === "/sessions") return json(res, 200, [...sessions.values()]);

  if (req.method === "POST" && url.pathname === "/v1/customers") {
    await read(req);
    const key = String(req.headers["idempotency-key"] ?? n);
    if (!customers.has(key)) customers.set(key, `cus_test_e2e_${++n}`);
    return json(res, 200, { id: customers.get(key), object: "customer" });
  }
  const oneIntent = url.pathname.match(/^\/v1\/payment_intents\/([\w-]+)$/);
  if (req.method === "GET" && oneIntent) return intents.has(oneIntent[1]) ? json(res, 200, intents.get(oneIntent[1])) : json(res, 404, { error: {} });
  const oneMethod = url.pathname.match(/^\/v1\/payment_methods\/([\w-]+)$/);
  if (req.method === "GET" && oneMethod) return methods.has(oneMethod[1]) ? json(res, 200, methods.get(oneMethod[1])) : json(res, 404, { error: {} });
  const oneSetup = url.pathname.match(/^\/v1\/setup_intents\/([\w-]+)$/);
  if (req.method === "GET" && oneSetup) return setupIntents.has(oneSetup[1]) ? json(res, 200, setupIntents.get(oneSetup[1])) : json(res, 404, { error: {} });

  if (req.method === "POST" && url.pathname === "/v1/checkout/sessions") {
    const form = new URLSearchParams(await read(req));
    if (form.get("mode") === "setup") {
      const id = `cs_test_e2e_${++n}`;
      const setup = `seti_test_e2e_${++n}`;
      setupIntents.set(setup, { id: setup, status: "requires_payment_method", customer: form.get("customer"), payment_method: null, mandate: null });
      sessions.set(id, {
        id, object: "checkout.session", mode: "setup", status: "open", payment_status: "no_payment_required", setup_intent: setup,
        customer: form.get("customer"), client_reference_id: form.get("client_reference_id"), amount_total: null, currency: null,
        created: Math.floor(Date.now() / 1000), url: `http://localhost:${port}/checkout/${id}`, success_url: form.get("success_url") ?? "", cancel_url: form.get("cancel_url") ?? "",
        method_type: form.get("payment_method_types[0]"), consent: form.get("custom_text[submit][message]") ?? "",
        name: form.get("payment_method_types[0]") === "card" ? "Save your card" : "Set up Direct Debit",
      });
      return json(res, 200, sessions.get(id));
    }
    const key = req.headers["idempotency-key"];
    if (!key || !byKey.has(key)) {
      const id = `cs_test_e2e_${++n}`;
      sessions.set(id, {
        id,
        object: "checkout.session",
        mode: form.get("mode") ?? "payment",
        status: "open",
        payment_status: "unpaid",
        payment_intent: null,
        amount_total: Number(form.get("line_items[0][price_data][unit_amount]") ?? 0),
        currency: "gbp",
        created: Math.floor(Date.now() / 1000),
        url: `http://localhost:${port}/checkout/${id}`,
        name: form.get("line_items[0][price_data][product_data][name]") ?? "Payment",
        success_url: form.get("success_url") ?? "",
        cancel_url: form.get("cancel_url") ?? "",
        expires_at: form.get("expires_at") ? Number(form.get("expires_at")) : null,
        customer: form.get("customer"),
        client_reference_id: form.get("client_reference_id"),
        keeps_card: form.get("payment_intent_data[setup_future_usage]") === "off_session",
        consent: form.get("custom_text[submit][message]") ?? "",
      });
      if (key) byKey.set(key, id);
    }
    return json(res, 200, sessions.get(key ? byKey.get(key) : `cs_test_e2e_${n}`));
  }

  // Closing a payment page nobody should pay any more (the site replaced it).
  const expire = url.pathname.match(/^\/v1\/checkout\/sessions\/([\w-]+)\/expire$/);
  if (req.method === "POST" && expire) {
    const s = sessions.get(expire[1]);
    if (!s || s.status !== "open") return json(res, 400, { error: { type: "invalid_request_error" } });
    s.status = "expired";
    return json(res, 200, s);
  }

  const one = url.pathname.match(/^\/v1\/checkout\/sessions\/([\w-]+)$/);
  if (req.method === "GET" && one) return sessions.has(one[1]) ? json(res, 200, sessions.get(one[1])) : json(res, 404, { error: {} });
  if (req.method === "GET" && url.pathname === "/v1/checkout/sessions") return json(res, 200, { data: [...sessions.values()].filter((s) => s.payment_intent === url.searchParams.get("payment_intent")) });
  // Refunds: created at once as succeeded; a repeated Idempotency-Key returns the same refund, as in Stripe.
  if (req.method === "POST" && url.pathname === "/v1/refunds") {
    const form = new URLSearchParams(await read(req));
    const key = String(req.headers["idempotency-key"] ?? `refund-${++n}`);
    const intent = intents.get(form.get("payment_intent") ?? "");
    if (!intent) return json(res, 404, { error: { type: "invalid_request_error" } });
    if (!refundByKey.has(key)) {
      const id = `re_test_e2e_${++n}`;
      refunds.set(id, { id, object: "refund", status: "succeeded", payment_intent: intent.id, amount: Number(form.get("amount") ?? intent.amount), currency: "gbp", created: Math.floor(Date.now() / 1000) });
      refundByKey.set(key, id);
    }
    return json(res, 200, refunds.get(refundByKey.get(key)));
  }
  const oneRefund = url.pathname.match(/^\/v1\/refunds\/([\w-]+)$/);
  if (req.method === "GET" && oneRefund) return refunds.has(oneRefund[1]) ? json(res, 200, refunds.get(oneRefund[1])) : json(res, 404, { error: {} });
  if (req.method === "GET" && url.pathname === "/v1/refunds") return json(res, 200, { data: [...refunds.values()].filter((r) => r.payment_intent === url.searchParams.get("payment_intent")) });

  // Stripe's back arrow: the buyer goes to the session's cancel_url without paying.
  const back = url.pathname.match(/^\/checkout\/([\w-]+)\/cancel$/);
  if (back && sessions.has(back[1])) {
    res.writeHead(303, { Location: sessions.get(back[1]).cancel_url || "/" });
    return res.end();
  }

  const checkout = url.pathname.match(/^\/checkout\/([\w-]+)$/);
  if (checkout && sessions.has(checkout[1])) {
    const session = sessions.get(checkout[1]);
    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      const consent = session.consent ? `<p class="consent">${session.consent}</p>` : "";
      if (session.status === "expired") return res.end(`<!doctype html><title>Stripe test checkout</title><h1>This page has expired</h1>`);
      if (session.mode === "setup") return res.end(`<!doctype html><title>Stripe test set-up</title><h1>${session.name}</h1>${consent}<form method="post"><button>${session.method_type === "card" ? "Save card" : "Authorise Direct Debit"}</button></form>`);
      return res.end(`<!doctype html><title>Stripe test checkout</title><h1>${session.name}</h1><p>£${(session.amount_total / 100).toFixed(2)}</p>${consent}<form method="post"><button>Pay £${(session.amount_total / 100).toFixed(2)}</button></form><p><a href="/checkout/${session.id}/cancel">Back</a></p>`);
    }
    if (session.mode === "setup") {
      // Authorise: the bank details and mandate are on file; tell the site (signed), send the member back.
      session.status = "complete";
      const card = session.method_type === "card";
      const method = `pm_test_e2e_${++n}`;
      methods.set(method, card ? { id: method, object: "payment_method", type: "card", card: { brand: "mastercard", last4: "4444" } } : { id: method, object: "payment_method", type: "bacs_debit" });
      setupIntents.set(session.setup_intent, { ...setupIntents.get(session.setup_intent), status: "succeeded", payment_method: method, mandate: card ? null : `mandate_test_e2e_${++n}` });
      const raw = JSON.stringify({ id: `evt_e2e_${++n}`, object: "event", type: "checkout.session.completed", created: Math.floor(Date.now() / 1000), data: { object: { id: session.id } } });
      const t = Math.floor(Date.now() / 1000);
      const signature = createHmac("sha256", signingSecret).update(`${t}.${raw}`).digest("hex");
      await fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": `t=${t},v1=${signature}` }, body: raw });
      res.writeHead(303, { Location: session.success_url || "/" });
      return res.end();
    }
    // Pay: complete the session, tell the site (signed, as Stripe does), send the buyer back.
    session.status = "complete";
    session.payment_status = "paid";
    session.payment_intent = `pi_test_e2e_${++n}`;
    const kept = session.keeps_card ? `pm_test_e2e_${++n}` : null;
    if (kept) methods.set(kept, { id: kept, object: "payment_method", type: "card", card: { brand: "visa", last4: "4242" } });
    intents.set(session.payment_intent, { id: session.payment_intent, object: "payment_intent", status: "succeeded", amount: session.amount_total, currency: "gbp", created: Math.floor(Date.now() / 1000), customer: session.customer ?? null, payment_method: kept });
    const raw = JSON.stringify({ id: `evt_e2e_${n}`, object: "event", type: "checkout.session.completed", created: Math.floor(Date.now() / 1000), data: { object: { id: session.id } } });
    const t = Math.floor(Date.now() / 1000);
    const signature = createHmac("sha256", signingSecret).update(`${t}.${raw}`).digest("hex");
    await fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": `t=${t},v1=${signature}` }, body: raw });
    res.writeHead(303, { Location: session.success_url || "/" });
    return res.end();
  }

  json(res, 404, { error: { type: "invalid_request_error" } });
}).listen(port, () => console.log(`Mock Stripe on ${port}`));
