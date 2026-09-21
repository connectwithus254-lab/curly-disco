/**
 * Explicit state machines (docs/05-state-machines.md).
 * Money-related transitions live here so they are testable in isolation and can never be
 * expressed as an ad-hoc UPDATE elsewhere in the codebase.
 */

export class TransitionError extends Error {
  constructor(
    readonly machine: string,
    readonly from: string,
    readonly event: string,
  ) {
    super(`${machine}: event "${event}" is not allowed from state "${from}"`);
  }
}

export interface Machine<S extends string, E extends string> {
  name: string;
  initial: S;
  states: readonly S[];
  terminals: readonly S[];
  transitions: Readonly<Record<S, Partial<Record<E, S>>>>;
  can(from: S, event: E): boolean;
  apply(from: S, event: E): S;
}

function build<S extends string, E extends string>(
  name: string,
  initial: S,
  states: readonly S[],
  terminals: readonly S[],
  transitions: Record<S, Partial<Record<E, S>>>,
): Machine<S, E> {
  return {
    name,
    initial,
    states,
    terminals,
    transitions,
    can: (from, event) => Boolean(transitions[from]?.[event]),
    apply: (from, event) => {
      const next = transitions[from]?.[event];
      if (!next) throw new TransitionError(name, from, event);
      return next;
    },
  };
}

/* ------------------------------------------------------------------ orders */

export const ORDER_STATES = [
  'pending_payment',
  'paid',
  'processing',
  'shipped',
  'delivered',
  'completed',
  'cancelled',
  'expired',
  'refunded',
  'partially_refunded',
  'disputed',
] as const;
export type OrderState = (typeof ORDER_STATES)[number];

export const ORDER_EVENTS = [
  'payment_confirmed',
  'start_processing',
  'ship',
  'deliver',
  'complete',
  'cancel',
  'expire',
  'refund',
  'partial_refund',
  'dispute',
  'resolve_dispute',
  'revive_late_payment',
] as const;
export type OrderEvent = (typeof ORDER_EVENTS)[number];

export const orderMachine = build<OrderState, OrderEvent>(
  'order',
  'pending_payment',
  ORDER_STATES,
  // Neither `completed` (can still be refunded/disputed) nor `expired` (can be revived by a
  // verified late payment) is terminal.
  ['cancelled', 'refunded'],
  {
    pending_payment: { payment_confirmed: 'paid', cancel: 'cancelled', expire: 'expired', revive_late_payment: 'paid' },
    paid: {
      start_processing: 'processing',
      deliver: 'delivered', // digital goods fulfil immediately
      refund: 'refunded',
      partial_refund: 'partially_refunded',
      dispute: 'disputed',
    },
    processing: { ship: 'shipped', deliver: 'delivered', refund: 'refunded', partial_refund: 'partially_refunded', dispute: 'disputed' },
    shipped: { deliver: 'delivered', dispute: 'disputed' },
    delivered: { complete: 'completed', refund: 'refunded', partial_refund: 'partially_refunded', dispute: 'disputed' },
    completed: { refund: 'refunded', partial_refund: 'partially_refunded', dispute: 'disputed' },
    disputed: { resolve_dispute: 'completed', refund: 'refunded', cancel: 'cancelled' },
    refunded: {},
    partially_refunded: { refund: 'refunded', dispute: 'disputed' },
    cancelled: {},
    expired: { revive_late_payment: 'paid' },
  },
);

/* --------------------------------------------------------------- payments */

export const PAYMENT_STATES = [
  'created',
  'awaiting_payment',
  'detected',
  'confirming',
  'confirmed',
  'settled',
  'underpaid',
  'awaiting_remainder',
  'expired',
  'late_payment',
  'failed',
  'cancelled',
  'refunded',
  'review',
] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

export const PAYMENT_EVENTS = [
  'invoice_created',
  'payment_detected',
  'confirmations_progress',
  'confirmations_reached',
  'settlement_reached',
  'amount_short',
  'remainder_received',
  'accept_underpayment',
  'expire',
  'late_detected',
  'fail',
  'cancel',
  'refund',
  'flag_review',
  'resolve_review',
] as const;
export type PaymentEvent = (typeof PAYMENT_EVENTS)[number];

/** True only for states where the merchant's money is verifiably received. */
export function paymentSettlesOrder(state: PaymentState): boolean {
  return state === 'confirmed' || state === 'settled';
}

export const paymentMachine = build<PaymentState, PaymentEvent>(
  'payment',
  'created',
  PAYMENT_STATES,
  ['refunded', 'cancelled', 'failed'],
  {
    created: { invoice_created: 'awaiting_payment', fail: 'failed', cancel: 'cancelled' },
    awaiting_payment: {
      payment_detected: 'detected',
      expire: 'expired',
      cancel: 'cancelled',
      fail: 'failed',
      flag_review: 'review',
    },
    detected: {
      confirmations_progress: 'confirming',
      confirmations_reached: 'confirmed',
      amount_short: 'underpaid',
      fail: 'failed',
      flag_review: 'review',
    },
    confirming: {
      confirmations_progress: 'confirming',
      confirmations_reached: 'confirmed',
      amount_short: 'underpaid',
      fail: 'failed',
      flag_review: 'review',
    },
    confirmed: { settlement_reached: 'settled', refund: 'refunded', flag_review: 'review' },
    settled: { refund: 'refunded' },
    underpaid: {
      remainder_received: 'confirmed',
      accept_underpayment: 'confirmed',
      expire: 'expired',
      refund: 'refunded',
      flag_review: 'review',
    },
    awaiting_remainder: { remainder_received: 'confirmed', expire: 'expired', flag_review: 'review' },
    expired: { late_detected: 'late_payment', cancel: 'cancelled' },
    late_payment: { confirmations_reached: 'confirmed', accept_underpayment: 'confirmed', flag_review: 'review', refund: 'refunded' },
    failed: {},
    cancelled: {},
    refunded: {},
    review: { resolve_review: 'confirmed', refund: 'refunded', cancel: 'cancelled' },
  },
);

/* -------------------------------------------------------------- referrals */

export const REFERRAL_STATES = ['attributed', 'qualified', 'active', 'rejected', 'expired', 'revoked'] as const;
export type ReferralState = (typeof REFERRAL_STATES)[number];

export const REFERRAL_EVENTS = [
  'qualify',
  'activate',
  'expire',
  'reject',
  'revoke',
  'fraud_detected',
] as const;
export type ReferralEvent = (typeof REFERRAL_EVENTS)[number];

export const referralMachine = build<ReferralState, ReferralEvent>(
  'referral',
  'attributed',
  REFERRAL_STATES,
  ['rejected', 'expired', 'revoked'],
  {
    attributed: { qualify: 'qualified', expire: 'expired', reject: 'rejected', fraud_detected: 'rejected' },
    qualified: { activate: 'active', expire: 'expired', reject: 'rejected', fraud_detected: 'rejected' },
    active: { revoke: 'revoked', fraud_detected: 'revoked' },
    rejected: {},
    expired: {},
    revoked: {},
  },
);

export const COMMISSION_STATES = ['pending', 'held', 'approved', 'paid', 'reversed', 'rejected'] as const;
export type CommissionState = (typeof COMMISSION_STATES)[number];

export const COMMISSION_EVENTS = ['hold', 'approve', 'pay', 'reverse', 'reject'] as const;
export type CommissionEvent = (typeof COMMISSION_EVENTS)[number];

export const commissionMachine = build<CommissionState, CommissionEvent>(
  'commission',
  'pending',
  COMMISSION_STATES,
  // `paid` is not terminal either: a payout can be reversed after a refund.
  ['reversed', 'rejected'],
  {
    pending: { hold: 'held', approve: 'approved', reject: 'rejected', reverse: 'reversed' },
    held: { approve: 'approved', reverse: 'reversed', reject: 'rejected' },
    approved: { pay: 'paid', reverse: 'reversed' },
    paid: { reverse: 'reversed' },
    reversed: {},
    rejected: {},
  },
);
