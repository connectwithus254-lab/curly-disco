import { describe, expect, it } from 'vitest';
import {
  TransitionError,
  commissionMachine,
  orderMachine,
  paymentMachine,
  paymentSettlesOrder,
  referralMachine,
} from '@botshop/core';

describe('order state machine', () => {
  it('never lets an order become paid without a confirmed payment event', () => {
    expect(orderMachine.can('pending_payment', 'ship')).toBe(false);
    expect(() => orderMachine.apply('pending_payment', 'ship')).toThrow(TransitionError);
    expect(orderMachine.apply('pending_payment', 'payment_confirmed')).toBe('paid');
  });

  it('walks the happy path for physical and digital goods', () => {
    expect(orderMachine.apply('paid', 'start_processing')).toBe('processing');
    expect(orderMachine.apply('processing', 'ship')).toBe('shipped');
    expect(orderMachine.apply('shipped', 'deliver')).toBe('delivered');
    expect(orderMachine.apply('delivered', 'complete')).toBe('completed');
    // Digital goods fulfil straight from paid.
    expect(orderMachine.apply('paid', 'deliver')).toBe('delivered');
  });

  it('allows reviving an expired order only for a late, verified payment', () => {
    expect(orderMachine.apply('expired', 'revive_late_payment')).toBe('paid');
    expect(orderMachine.can('cancelled', 'revive_late_payment')).toBe(false);
  });

  it('treats cancelled/refunded as the only terminal order states', () => {
    for (const state of orderMachine.terminals) {
      const events = Object.keys(orderMachine.transitions[state] ?? {});
      expect(events, `terminal state ${state} must have no outgoing transitions`).toHaveLength(0);
    }
  });
});

describe('payment state machine', () => {
  it('only confirms the order when money is verifiably confirmed', () => {
    expect(paymentSettlesOrder('detected')).toBe(false);
    expect(paymentSettlesOrder('confirming')).toBe(false);
    expect(paymentSettlesOrder('confirmed')).toBe(true);
    expect(paymentSettlesOrder('settled')).toBe(true);
    expect(paymentSettlesOrder('awaiting_payment')).toBe(false);
  });

  it('handles underpayment without silently accepting it', () => {
    expect(paymentMachine.apply('detected', 'amount_short')).toBe('underpaid');
    expect(paymentMachine.apply('underpaid', 'remainder_received')).toBe('confirmed');
    expect(paymentMachine.apply('underpaid', 'accept_underpayment')).toBe('confirmed');
    expect(paymentMachine.can('underpaid', 'settlement_reached')).toBe(false);
  });

  it('routes suspicious changes to manual review', () => {
    expect(paymentMachine.apply('confirming', 'flag_review')).toBe('review');
    expect(paymentMachine.apply('review', 'resolve_review')).toBe('confirmed');
  });

  it('keeps confirmations monotonic (no regressions to awaiting_payment)', () => {
    expect(paymentMachine.can('confirming', 'invoice_created')).toBe(false);
    expect(paymentMachine.can('confirmed', 'payment_detected')).toBe(false);
    expect(paymentMachine.apply('confirming', 'confirmations_progress')).toBe('confirming');
  });

  it('supports late payment after expiry but not after cancellation', () => {
    expect(paymentMachine.apply('expired', 'late_detected')).toBe('late_payment');
    expect(paymentMachine.apply('late_payment', 'confirmations_reached')).toBe('confirmed');
    expect(paymentMachine.can('cancelled', 'late_detected')).toBe(false);
  });
});

describe('referral + commission machines', () => {
  it('requires qualification before a referral becomes active', () => {
    expect(referralMachine.apply('attributed', 'qualify')).toBe('qualified');
    expect(referralMachine.apply('qualified', 'activate')).toBe('active');
    expect(referralMachine.can('attributed', 'activate')).toBe(false);
  });

  it('sends self-referral / fraud to rejected', () => {
    expect(referralMachine.apply('attributed', 'fraud_detected')).toBe('rejected');
    expect(referralMachine.can('rejected', 'activate')).toBe(false);
  });

  it('can reverse a commission that was already paid out', () => {
    expect(commissionMachine.apply('pending', 'hold')).toBe('held');
    expect(commissionMachine.apply('held', 'approve')).toBe('approved');
    expect(commissionMachine.apply('approved', 'pay')).toBe('paid');
    expect(commissionMachine.apply('paid', 'reverse')).toBe('reversed');
  });

  it('never pays a rejected commission', () => {
    expect(commissionMachine.can('rejected', 'pay')).toBe(false);
    expect(() => commissionMachine.apply('rejected', 'pay')).toThrow(TransitionError);
  });
});
