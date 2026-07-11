export function getVerificationWithdrawalLimit(user = {}) {
  const required = Boolean(user?.verification_required);
  const status = String(user?.verification_status || '').trim().toLowerCase();
  const isApproved = status === 'approved' || status === 'verified';

  if (required && !isApproved) {
    return 20;
  }

  return Number.POSITIVE_INFINITY;
}

export function canWithdrawAmount(user = {}, amount) {
  const numericAmount = Number(amount || 0);
  const limit = getVerificationWithdrawalLimit(user);

  if (!Number.isFinite(limit)) {
    return { allowed: true, limit, reason: null };
  }

  if (numericAmount > limit) {
    return {
      allowed: false,
      limit,
      reason: `Verification is required before withdrawals above GHC ${limit.toFixed(2)}.`
    };
  }

  return { allowed: true, limit, reason: null };
}
