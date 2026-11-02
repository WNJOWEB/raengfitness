import type {
  AttendanceStatus,
  ClientStatus,
  ConsentKind,
  ContactMethod,
  PaymentMethodKey,
  PaymentStatus,
  PtStatus,
  RequestStatus,
  ServiceKey,
  SubscriptionStatus,
} from "./types";

/** Words the coach sees for each stored value. */

export const CLIENT_STATUS: Record<ClientStatus, string> = {
  lead: "Lead",
  active: "Active",
  paused: "Paused",
  former: "Former",
};

export const SERVICE: Record<ServiceKey, string> = {
  group: "Group classes",
  pt: "One-to-one",
  online: "Online coaching",
  other: "Other",
};

export const REQUEST_STATUS: Record<RequestStatus, string> = {
  new: "New",
  awaiting: "Awaiting response",
  confirmed: "Confirmed",
  declined: "Declined",
  cancelled: "Cancelled",
  completed: "Completed",
};

export const ATTENDANCE_STATUS: Record<AttendanceStatus, string> = {
  booked: "Booked",
  attended: "Attended",
  cancelled: "Cancelled",
  no_show: "No-show",
};

export const PT_STATUS: Record<PtStatus, string> = {
  scheduled: "Scheduled",
  attended: "Attended",
  no_show: "No-show",
  cancelled: "Cancelled",
};

export const SUBSCRIPTION_STATUS: Record<SubscriptionStatus, string> = {
  active: "Active",
  paused: "Paused",
  cancelled: "Cancelled",
  completed: "Completed",
};

export const PAYMENT_STATUS: Record<PaymentStatus, string> = {
  received: "Received",
  failed: "Failed",
  void: "Void (entered in error)",
};

export const PAYMENT_METHOD: Record<PaymentMethodKey, string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  card: "Card",
  other: "Other",
};

export const CONSENT_KIND: Record<ConsentKind, string> = {
  privacy_notice: "Privacy notice acknowledged",
  photos: "Photos and video",
  marketing: "Marketing messages",
};

export const CONTACT_METHOD: Record<Exclude<ContactMethod, "">, string> = {
  email: "Email",
  phone: "Phone",
  instagram: "Instagram",
};

/** Messages for the portal's own database rules ("akb:<rule>"). */
export const RULE_MESSAGES: Record<string, string> = {
  class_full: "That class is full. Raise its capacity or choose another date.",
  package_used_up: "That package has no sessions left.",
  package_inactive: "That package is cancelled.",
  package_other_client: "That package belongs to another client.",
  payment_overallocated: "That's more than is left of the payment.",
  charge_overpaid: "That's more than is owed on the charge.",
  charge_void: "That charge has been cancelled.",
  other_client: "The payment and the charge belong to different clients.",
  payment_not_received: "Only received payments can be used or refunded.",
  refund_too_large: "The refund is more than is left of the payment.",
  refund_needs_charge: "Part of this payment has been set against a charge. Choose which charge the refund is for.",
  refund_before_payment: "A refund can't be dated before the payment.",
  payment_has_refunds: "This payment has refunds, so it can't be marked failed or void.",
  ledger_immutable: "Payments and refunds can't be edited. Mark the payment void and record it again.",
  already_decided: "This has already been decided. Refresh to see its current state.",
  not_found: "That record no longer exists.",
  not_scheduled: "Only scheduled sessions can be moved.",
  subscription_inactive: "Only active subscriptions can be charged.",
  subscription_ended: "The subscription has ended.",
  no_price: "Set a price first.",
  invalid_status: "That status isn't allowed.",
  provider_managed: "This was a card payment taken through Stripe (or earlier Square). Refund it in that provider's Dashboard; the refund then shows here automatically.",
  currency_mismatch: "The card provider reported a currency other than GBP, so it wasn't recorded.",
  invalid_environment: "Card payments aren't set up correctly for this site.",
  sandbox_in_production: "Test-mode card payments can't be recorded in the live database.",
  live_in_test: "Live card payments can't be recorded in a test database.",
};
