/** Rows as the portal reads them (columns of the akb_* tables and views). */

export type ClientStatus = "lead" | "active" | "paused" | "former";
export type ServiceKey = "group" | "pt" | "online" | "other";
export type RequestStatus = "new" | "awaiting" | "confirmed" | "declined" | "cancelled" | "completed";
export type AttendanceStatus = "booked" | "attended" | "cancelled" | "no_show";
export type PtStatus = "scheduled" | "attended" | "no_show" | "cancelled";
export type SubscriptionStatus = "active" | "paused" | "cancelled" | "completed";
export type PaymentStatus = "received" | "failed" | "void";
export type PaymentMethodKey = "cash" | "bank_transfer" | "card" | "other";
export type ConsentKind = "privacy_notice" | "photos" | "marketing";
export type ContactMethod = "" | "email" | "phone" | "instagram";

export interface Client {
  id: string;
  created_at: string;
  updated_at: string;
  full_name: string;
  email: string;
  phone: string;
  instagram: string;
  preferred_contact: ContactMethod;
  status: ClientStatus;
  notes: string;
}

export interface ClientBalance {
  client_id: string;
  received_pence: number;
  outstanding_pence: number;
  due_later_pence: number;
  credit_pence: number;
}

export interface Consent {
  id: string;
  client_id: string;
  kind: ConsentKind;
  given_on: string;
  withdrawn_on: string | null;
  source: string;
}

export interface FollowUp {
  id: string;
  created_at: string;
  client_id: string;
  due_on: string;
  note: string;
  done_at: string | null;
}

export interface BookingRequest {
  id: string;
  created_at: string;
  /** The sender's request key; the customer's reference ("RAENG-3F9A1C07") is made from it. */
  idempotency_key?: string;
  kind: "booking" | "online";
  service: string;
  summary: string;
  name: string;
  email: string;
  phone: string;
  message: string;
  details: Record<string, unknown>;
  status: RequestStatus;
  client_id: string | null;
  decided_at: string | null;
  decision_note: string;
  notified_at: string | null;
  class_date: string | null;
  class_slot: string | null;
  /** Email alert to the coach (optional: absent until 20261020000100_akb_request_alerts.sql is applied). */
  alert_status?: "sent" | "failed" | null;
  alert_sent_at?: string | null;
  alert_attempts?: number;
}

export interface ClassSessionRow {
  id: string;
  slot: string;
  class_date: string;
  starts_at: string;
  duration_minutes: number;
  /** The size that applies: the date's own, else the usual class size. */
  capacity: number | null;
  /** Only what Alex set for this date (null: the usual size applies). */
  capacity_set?: number | null;
  notes: string;
  booked: number;
  attended: number;
  /** Set when the coach cancelled the whole class (akb_cancel_class). */
  cancelled_at: string | null;
  cancel_reason: string;
}

export interface Attendance {
  id: string;
  created_at: string;
  class_session_id: string;
  client_id: string;
  request_id: string | null;
  status: AttendanceStatus;
  notes: string;
  /** Paid with a credit from this membership period (migration 20261023000000). */
  membership_period_id?: string | null;
  /** Cancelled within 24 hours of the class: the credit is forfeited. */
  late_cancel?: boolean;
}

export interface Package {
  id: string;
  created_at: string;
  client_id: string;
  name: string;
  sessions_total: number;
  price_pence: number;
  purchased_on: string;
  expires_on: string | null;
  status: "active" | "cancelled";
  notes: string;
  sessions_used: number;
  sessions_delivered: number;
  sessions_remaining: number;
}

export interface PtSession {
  id: string;
  created_at: string;
  client_id: string;
  request_id: string | null;
  package_id: string | null;
  requested: string;
  starts_at: string;
  ends_at: string;
  price_pence: number | null;
  status: PtStatus;
  notes: string;
}

export interface Subscription {
  id: string;
  created_at: string;
  client_id: string;
  plan: string;
  price_pence: number;
  start_on: string;
  end_on: string | null;
  renews_on: string | null;
  status: SubscriptionStatus;
  check_in_days: number;
  next_check_in_on: string | null;
  notes: string;
}

export interface CheckIn {
  id: string;
  created_at: string;
  subscription_id: string;
  checked_in_on: string;
  summary: string;
  actions: string;
}

export interface Charge {
  id: string;
  created_at: string;
  client_id: string;
  service: ServiceKey;
  description: string;
  amount_pence: number;
  due_on: string;
  attendance_id: string | null;
  pt_session_id: string | null;
  package_id: string | null;
  subscription_id: string | null;
  period_start: string | null;
  voided_at: string | null;
  void_reason: string;
  paid_pence: number;
  outstanding_pence: number;
}

export interface Payment {
  id: string;
  created_at: string;
  client_id: string;
  service: ServiceKey;
  amount_pence: number;
  currency: "GBP";
  paid_on: string;
  method: PaymentMethodKey;
  status: PaymentStatus;
  status_reason: string;
  reference: string;
  note: string;
  provider: string;
  allocated_pence: number;
  refunded_pence: number;
  unallocated_pence: number;
}

export interface Allocation {
  id: string;
  payment_id: string;
  charge_id: string;
  amount_pence: number;
}

export interface Refund {
  id: string;
  created_at: string;
  payment_id: string;
  amount_pence: number;
  refunded_on: string;
  note: string;
}

export interface ActivityEvent {
  id: number;
  created_at: string;
  client_id: string | null;
  entity: string;
  entity_id: string | null;
  action: string;
  detail: Record<string, unknown>;
}
