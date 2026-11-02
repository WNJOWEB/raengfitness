"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { failure, success, type ActionState } from "@/lib/coach/action-state";
import { addPackage, cancelPackage, getPackage } from "@/lib/coach/bookings";
import {
  addConsent,
  addFollowUp,
  CLIENT_STATUSES,
  completeFollowUp,
  CONTACT_METHODS,
  createClient,
  deleteClient,
  getClient,
  updateClient,
  withdrawConsent,
  type ClientInput,
} from "@/lib/coach/clients";
import { actionContext } from "@/lib/coach/context";
import { dbMessage } from "@/lib/coach/errors";
import { addCharge, getCharge, SERVICE_KEYS, voidCharge } from "@/lib/coach/ledger";
import { stripeConfig } from "@/lib/stripe/config";
import { createChargeLink } from "@/lib/stripe/sync";
import type { ConsentKind } from "@/lib/coach/types";
import { FormReader } from "@/lib/coach/validate";

const CHECK = "Please check the highlighted fields.";

function readClient(form: FormReader): ClientInput {
  return {
    full_name: form.text("full_name", { label: "their full name", max: 100, required: true }),
    email: form.email("email"),
    phone: form.phone("phone"),
    instagram: form.text("instagram", { label: "the Instagram username", max: 60 }).replace(/^@/, ""),
    preferred_contact: form.oneOf("preferred_contact", CONTACT_METHODS, { label: "a contact method" }),
    status: form.oneOf("status", CLIENT_STATUSES, { label: "a status", required: true }) || "lead",
    notes: form.text("notes", { label: "the notes", max: 4000, multiline: true }),
  };
}

export async function createClientAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await actionContext();
  if ("error" in ctx) return ctx.error;
  const form = new FormReader(formData);
  const input = readClient(form);
  if (!form.ok) return failure(CHECK, form.errors);
  const result = await createClient(ctx.db, input);
  if (!result.ok) {
    if (result.error.constraint === "akb_clients_email_key") return failure(dbMessage(result.error), { email: "A client already has this email address." });
    return failure(dbMessage(result.error));
  }
  redirect(`/coach/clients/${result.data.id}`);
}

export async function updateClientAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await actionContext();
  if ("error" in ctx) return ctx.error;
  const form = new FormReader(formData);
  const id = form.id("client", { label: "a client", required: true });
  const input = readClient(form);
  if (!form.ok) return failure(CHECK, form.errors);
  const result = await updateClient(ctx.db, id, input);
  if (!result.ok) {
    if (result.error.constraint === "akb_clients_email_key") return failure(dbMessage(result.error), { email: "Another client already has this email address." });
    return failure(dbMessage(result.error));
  }
  if (!result.data) return failure("That client no longer exists.");
  refresh();
  return success("Saved.");
}

export async function deleteClientAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await actionContext();
  if ("error" in ctx) return ctx.error;
  const form = new FormReader(formData);
  const id = form.id("client", { label: "a client", required: true });
  if (!form.ok) return failure("That client no longer exists.");
  const result = await deleteClient(ctx.db, id);
  if (!result.ok) {
    return failure(
      result.error.code === "23503" ? "This client has bookings or payments, so they can't be deleted. Set their status to Former instead." : dbMessage(result.error),
    );
  }
  redirect("/coach/clients");
}

async function clientExists(ctx: Exclude<Awaited<ReturnType<typeof actionContext>>, { error: ActionState }>, id: string): Promise<ActionState | null> {
  const client = await getClient(ctx.db, id);
  if (!client.ok) return failure(dbMessage(client.error));
  return client.data ? null : failure("That client no longer exists.");
}

export async function addConsentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await actionContext();
  if ("error" in ctx) return ctx.error;
  const form = new FormReader(formData);
  const clientId = form.id("client", { label: "a client", required: true });
  const kind = form.oneOf("kind", ["privacy_notice", "photos", "marketing"] as const, { label: "what they agreed to", required: true });
  const givenOn = form.date("given_on", { label: "the date", required: true });
  const source = form.text("source", { label: "how they agreed", max: 200 });
  if (givenOn && givenOn > ctx.today) form.error("given_on", "The date can't be in the future.");
  if (!form.ok) return failure(CHECK, form.errors);
  const missing = await clientExists(ctx, clientId);
  if (missing) return missing;
  const result = await addConsent(ctx.db, clientId, kind as ConsentKind, givenOn, source);
  if (!result.ok) return failure(dbMessage(result.error));
  refresh();
  return success("Consent recorded.");
}

export async function withdrawConsentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await actionContext();
  if ("error" in ctx) return ctx.error;
  const form = new FormReader(formData);
  const clientId = form.id("client", { label: "a client", required: true });
  const id = form.id("consent", { label: "a consent", required: true });
  if (!form.ok) return failure("That record no longer exists.");
  const result = await withdrawConsent(ctx.db, id, clientId, ctx.today);
  if (!result.ok) return failure(dbMessage(result.error));
  if (!result.data) return failure("That record no longer exists.");
  refresh();
  return success("Marked as withdrawn.");
}

export async function addFollowUpAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await actionContext();
  if ("error" in ctx) return ctx.error;
  const form = new FormReader(formData);
  const clientId = form.id("client", { label: "a client", required: true });
  const dueOn = form.date("due_on", { label: "when", required: true });
  const note = form.text("note", { label: "what to do", max: 500, required: true });
  if (!form.ok) return failure(CHECK, form.errors);
  const missing = await clientExists(ctx, clientId);
  if (missing) return missing;
  const result = await addFollowUp(ctx.db, clientId, dueOn, note);
  if (!result.ok) return failure(dbMessage(result.error));
  refresh();
  return success("Follow-up added.");
}

export async function toggleFollowUpAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await actionContext();
  if ("error" in ctx) return ctx.error;
  const form = new FormReader(formData);
  const clientId = form.id("client", { label: "a client", required: true });
  const id = form.id("follow_up", { label: "a follow-up", required: true });
  const done = formData.get("done") === "true";
  if (!form.ok) return failure("That follow-up no longer exists.");
  const result = await completeFollowUp(ctx.db, id, clientId, done);
  if (!result.ok) return failure(dbMessage(result.error));
  if (!result.data) return failure("That follow-up no longer exists.");
  refresh();
  return success(done ? "Marked as done." : "Reopened.");
}

export async function addChargeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await actionContext();
  if ("error" in ctx) return ctx.error;
  const form = new FormReader(formData);
  const clientId = form.id("client", { label: "a client", required: true });
  const service = form.oneOf("service", SERVICE_KEYS, { label: "a service", required: true });
  const description = form.text("description", { label: "what it's for", max: 200, required: true });
  const amount = form.pounds("amount", { label: "the amount", required: true });
  const dueOn = form.date("due_on", { label: "the due date", required: true });
  if (!form.ok || !service || amount === null) return failure(CHECK, form.errors);
  const missing = await clientExists(ctx, clientId);
  if (missing) return missing;
  const result = await addCharge(ctx.db, { clientId, service, description, amountPence: amount, dueOn });
  if (!result.ok) return failure(dbMessage(result.error));
  refresh();
  return success("Charge added.");
}

export async function voidChargeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await actionContext();
  if ("error" in ctx) return ctx.error;
  const form = new FormReader(formData);
  const id = form.id("charge", { label: "a charge", required: true });
  const reason = form.text("reason", { label: "the reason", max: 300, required: true });
  if (!form.ok) return failure(CHECK, form.errors);
  const charge = await getCharge(ctx.db, id);
  if (!charge.ok) return failure(dbMessage(charge.error));
  if (!charge.data) return failure("That charge no longer exists.");
  const result = await voidCharge(ctx.db, id, reason);
  if (!result.ok) return failure(dbMessage(result.error));
  refresh();
  return success(charge.data.paid_pence > 0 ? "Charge cancelled. The money paid towards it is now their credit." : "Charge cancelled.");
}

/** A Stripe-hosted card payment link for what's owed on a charge. Recorded as paid only when Stripe confirms it. */
export async function cardLinkAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await actionContext();
  if ("error" in ctx) return ctx.error;
  const stripe = stripeConfig();
  if (!stripe) return failure("Card payments aren't set up (see DEPLOYMENT.md → Stripe).");
  const form = new FormReader(formData);
  const id = form.id("charge", { label: "a charge", required: true });
  if (!form.ok) return failure(CHECK, form.errors);
  const result = await createChargeLink(ctx.db, stripe, id);
  if (!result.ok) {
    const message = {
      "not-found": "That charge no longer exists.",
      "nothing-owed": "Nothing is owed on this charge.",
      stripe: "Stripe didn't create the link. Nothing was charged; try again in a moment.",
      db: "The database isn't responding, so nothing was saved. Try again in a moment.",
    }[result.reason];
    return failure(message);
  }
  refresh();
  return success("Payment link ready. Send it to the client; the payment shows here once Stripe confirms it. The link works for 24 hours.");
}

export async function addPackageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await actionContext();
  if ("error" in ctx) return ctx.error;
  const form = new FormReader(formData);
  const clientId = form.id("client", { label: "a client", required: true });
  const name = form.text("name", { label: "the package name", max: 100, required: true });
  const sessions = form.int("sessions", { label: "the number of sessions", min: 1, max: 100, required: true });
  const price = form.pounds("price", { label: "the price", required: true, allowZero: true });
  const purchasedOn = form.date("purchased_on", { label: "the purchase date", required: true });
  const expiresOn = form.date("expires_on", { label: "the expiry date" });
  if (expiresOn && purchasedOn && expiresOn < purchasedOn) form.error("expires_on", "The expiry date must be after the purchase date.");
  if (!form.ok || sessions === null || price === null) return failure(CHECK, form.errors);
  const missing = await clientExists(ctx, clientId);
  if (missing) return missing;
  const result = await addPackage(ctx.db, { clientId, name, sessions, pricePence: price, purchasedOn, expiresOn: expiresOn || null, notes: "" });
  if (!result.ok) return failure(dbMessage(result.error));
  refresh();
  return success("Package added, with its charge.");
}

export async function cancelPackageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await actionContext();
  if ("error" in ctx) return ctx.error;
  const form = new FormReader(formData);
  const id = form.id("package", { label: "a package", required: true });
  if (!form.ok) return failure("That package no longer exists.");
  const pkg = await getPackage(ctx.db, id);
  if (!pkg.ok) return failure(dbMessage(pkg.error));
  if (!pkg.data) return failure("That package no longer exists.");
  const result = await cancelPackage(ctx.db, id);
  if (!result.ok) return failure(dbMessage(result.error));
  refresh();
  return success("Package cancelled. Its charge is unchanged: cancel or refund it under Payments if needed.");
}
