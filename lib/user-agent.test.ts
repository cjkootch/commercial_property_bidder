import { describe, expect, it } from "vitest";
import { isPreviewBot } from "./user-agent";

describe("isPreviewBot", () => {
  it("flags the link-preview fetchers that start the clock on delivery", () => {
    for (const ua of [
      "facebookexternalhit/1.1",
      "WhatsApp/2.23",
      "Slackbot-LinkExpanding 1.0",
      "Twitterbot/1.0",
      "Applebot/0.1",
      "Mozilla/5.0 (compatible; Discordbot/2.0)",
      "SkypeUriPreview Preview/0.5",
    ]) {
      expect(isPreviewBot(ua)).toBe(true);
    }
  });
  it("treats a missing UA as automated (not a human tap)", () => {
    expect(isPreviewBot(null)).toBe(true);
    expect(isPreviewBot("")).toBe(true);
  });
  it("lets real mobile browsers through", () => {
    for (const ua of [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36",
    ]) {
      expect(isPreviewBot(ua)).toBe(false);
    }
  });
});
