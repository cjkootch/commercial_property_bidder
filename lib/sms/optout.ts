// Opt-out PHRASE detection (2026-07-20 incident): "Remove us from your list"
// got a polite AI close — "you won't hear from us again" — but never wrote
// sms_opt_out, so nothing actually guaranteed the promise; any other lane
// (lead alerts, a future opener) could text them again. Keyword detection
// (STOP/UNSUBSCRIBE leading word, in the webhook) catches the carrier-style
// replies; this catches removal requests phrased as sentences. Deterministic
// regex, not model judgment — a compliance ledger must not depend on an LLM's
// intent classification. False positives cost one recoverable prospect
// (START re-opts, operator paged); false negatives are violations.

const OPT_OUT_PHRASES =
  /\b(remove\s+(us|me)|take\s+(us|me)\s+off|(do\s?n[o']?t|dont|do\s+not)\s+(text|message|contact)|no\s+more\s+(texts?|messages?)|lose\s+(my|our)\s+number|wrong\s+number)\b/i;

/** Does this inbound SMS read as a removal request? Test the RAW body. */
export function isOptOutPhrase(body: string): boolean {
  return OPT_OUT_PHRASES.test(body);
}
