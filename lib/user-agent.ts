// Link-preview / crawler detection. iMessage, WhatsApp, Slack, corporate SMS
// filters etc. fetch a URL to render a preview the instant a text is delivered.
// Those GETs must NOT trigger anything with a functional consequence — starting
// a 24h hold clock, logging a funnel view, or inflating claim heat — or the
// human who opens the link tomorrow has already burned their window. Best-effort
// UA match on the known offenders (a spoofing previewer slips through; the hold
// is soft + 24h, so the residual risk is small).
const PREVIEW_BOT = new RegExp(
  [
    "facebookexternalhit",
    "facebot",
    "whatsapp",
    "telegrambot",
    "slackbot",
    "slack-imgproxy",
    "discordbot",
    "twitterbot",
    "linkedinbot",
    "applebot",
    "skypeuripreview",
    "google-?(bot|image)",
    "bingbot",
    "yandex(bot|images)",
    "embedly",
    "quora link preview",
    "redditbot",
    "pinterest",
    "vkshare",
    "w3c_validator",
    "outbrain",
    "nuzzel",
    "bitlybot",
    "\\bbot\\b",
    "crawler",
    "spider",
    "preview",
  ].join("|"),
  "i"
);

/** True if the user-agent looks like an automated link-preview fetcher or
 *  crawler rather than a person's browser. */
export function isPreviewBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true; // no UA at all → treat as automated, not a human tap
  return PREVIEW_BOT.test(userAgent);
}
