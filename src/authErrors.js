// Plain-English wrappers for the errors GoTrue actually returns.
//
// Most auth screens in this app have carefully written copy for the failures
// they anticipate, and then fall back to `error.message` for everything else.
// That fallback is where members meet strings like
// "For security purposes, you can only request this after 47 seconds" and
// "over_email_send_rate_limit" — accurate, and useless to a person who just
// wants to sign in.
//
// Anything not listed here falls through unchanged, so a genuinely novel error
// is never swallowed or replaced with something vague.

const RULES = [
  // Wrong password, or an address that was never registered. GoTrue returns
  // the same message for both on purpose (no account enumeration) and so do we.
  {
    test: /invalid login credentials|invalid_credentials/i,
    message: 'That email and password don’t match an account. Check both, or use “Forgot password?” below.',
  },
  // Only reachable once "Confirm email" is switched on in the dashboard.
  {
    test: /email not confirmed|email_not_confirmed/i,
    message: 'You still need to confirm your email address — check your inbox (and your spam folder) for the link we sent when you joined.',
  },
  // GoTrue's per-address cooldown on password resets / confirmation resends.
  // The number in the original message is worth keeping, so this one rebuilds
  // rather than replaces.
  {
    test: /you can only request this after (\d+) seconds?/i,
    message: (m) => `Please wait ${m[1]} seconds before asking for another email — that’s a limit on our side, not a problem with your account.`,
  },
  // Project-wide send limit. Nothing the member can do; say so rather than
  // letting them retry into the same wall.
  {
    test: /over_email_send_rate_limit|email rate limit exceeded/i,
    message: 'We’ve sent too many emails in a short space of time. Please try again in an hour, or get in touch if it’s urgent.',
  },
  {
    test: /over_request_rate_limit|too many requests/i,
    message: 'Too many attempts from this connection. Please wait a few minutes and try again.',
  },
  // Turnstile: token missing, expired, or replayed.
  {
    test: /captcha/i,
    message: 'The security check didn’t go through. Tick it again — if it isn’t showing, disable any ad or privacy blocker for this site and refresh.',
  },
  {
    test: /user already registered|already exists|user_already_exists/i,
    message: 'There’s already an account with that email address. Try signing in instead — or reset your password if you’ve forgotten it.',
  },
  {
    test: /password should be at least (\d+)/i,
    message: (m) => `Your password needs to be at least ${m[1]} characters.`,
  },
  // Enabled by "leaked password protection" in the dashboard.
  {
    test: /pwned|compromised|found in a data breach/i,
    message: 'That password has appeared in a known data breach, so it can’t be used here. Please pick a different one.',
  },
  {
    test: /same_password|should be different from the old password/i,
    message: 'That’s already your current password — pick a different one.',
  },
  {
    test: /email address .* is invalid|invalid email/i,
    message: 'That email address doesn’t look right — check it for typos.',
  },
  // Expired or already-used magic/recovery link.
  {
    test: /otp_expired|token has expired|invalid or has expired/i,
    message: 'That link has expired or has already been used. Please request a new one.',
  },
  {
    test: /signups not allowed|signup_disabled/i,
    message: 'New sign-ups are closed at the moment. Please get in touch if you think that’s wrong.',
  },
]

// `fallback` is what to show when the error carries no message at all — a
// network failure, usually.
export function friendlyAuthError(error, fallback = 'Something went wrong. Please try again.') {
  const raw = typeof error === 'string' ? error : error?.message
  if (!raw) return fallback
  for (const rule of RULES) {
    const match = raw.match(rule.test)
    if (match) return typeof rule.message === 'function' ? rule.message(match) : rule.message
  }
  return raw
}
