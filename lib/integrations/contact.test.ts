import { describe, expect, it } from "vitest";
import { extractFromHtml } from "./contact";

// The extraction guardrails: every address that reaches the send queue must be
// a real, publishable one — builder boilerplate and error-reporting addresses
// bounce, and bounces on a young sending domain are reputation poison.
describe("integrations/contact extractFromHtml", () => {
  it("prefers mailto links and lowercases", () => {
    const { email } = extractFromHtml(`<a href="mailto:Sales@TexScape.com?subject=hi">email us</a>`);
    expect(email).toBe("sales@texscape.com");
  });

  it("decodes numeric-entity obfuscated mailto addresses (found live)", () => {
    // "sales@houstonlandscapepros.com" with a few chars entity-encoded.
    const obfuscated = "&#115;a&#108;es&#064;houstonlandscapepros&#046;c&#111;m";
    const { email } = extractFromHtml(`<a href="mailto:${obfuscated}">contact</a>`);
    expect(email).toBe("sales@houstonlandscapepros.com");
  });

  it("rejects wix/sentry error-reporting addresses on any subdomain (found live)", () => {
    const html = `<script>e="605a7baede844d278b89dc95ae0a9123@sentry-next.wixpress.com"</script>
      <p>Call us or write info@realcompany.com</p>`;
    expect(extractFromHtml(html).email).toBe("info@realcompany.com");
    expect(extractFromHtml(`x@sentry.wixpress.com only`).email).toBeNull();
    expect(extractFromHtml(`err@o123.ingest.sentry.io only`).email).toBeNull();
  });

  it("rejects site-builder placeholders (found live) but keeps real addresses", () => {
    expect(extractFromHtml(`reach us: user@domain.com`).email).toBeNull();
    expect(extractFromHtml(`reach us: no@email.com`).email).toBeNull();
    expect(extractFromHtml(`user@domain.com or office@smartscaping.co`).email).toBe(
      "office@smartscaping.co"
    );
  });

  it("never returns asset filenames matched as emails", () => {
    expect(extractFromHtml(`<img src="logo@2x.png">`).email).toBeNull();
  });
});
