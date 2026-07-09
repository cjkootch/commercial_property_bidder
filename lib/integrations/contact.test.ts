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

describe("integrations/contact domain gate + percent-encoding", () => {
  it("decodes percent-encoded mailto addresses (found live: %20office@...)", () => {
    const { email } = extractFromHtml(`<a href="mailto:%20office@kindredpest.com">us</a>`, "kindredpest.com");
    expect(email).toBe("office@kindredpest.com");
  });

  it("rejects inline vendor-credit emails from foreign domains (found live)", () => {
    // A cleaning company's page sourcing a font foundry's license email.
    const html = `<style>/* font by info@indiantypefoundry.com */</style><p>Call us!</p>`;
    expect(extractFromHtml(html, "cordialclean.com").email).toBeNull();
    // Same-domain inline and freemail inline stay accepted.
    expect(extractFromHtml(`office@cordialclean.com`, "cordialclean.com").email).toBe("office@cordialclean.com");
    expect(extractFromHtml(`bugs@gmail.com`, "cordialclean.com").email).toBe("bugs@gmail.com");
    // Subdomains of the business count as its own.
    expect(extractFromHtml(`sales@mail.cordialclean.com`, "cordialclean.com").email).toBe("sales@mail.cordialclean.com");
  });

  it("mailto links stay trusted regardless of domain — the business chose them", () => {
    const { email } = extractFromHtml(`<a href="mailto:owner@differentdomain.com">email</a>`, "cordialclean.com");
    expect(email).toBe("owner@differentdomain.com");
  });

  it("repairs footer-glued addresses (found live: phone in front, site URL behind)", () => {
    // "77484 713-467-7932 sales@craig-heidt.com www.craig-heidt.com" scraped
    // with the separators collapsed — the glued form is a guaranteed bounce.
    const glued = `77484713-467-7932sales@craig-heidt.comwww.craig-heidt.com`;
    expect(extractFromHtml(glued, "craig-heidt.com").email).toBe("sales@craig-heidt.com");
    // A digits-leading mailbox that is NOT a glued phone stays intact.
    expect(extractFromHtml(`24-7plumbing@gmail.com`, "x.com").email).toBe("24-7plumbing@gmail.com");
    // A foreign domain that merely starts with the site's name is not "repaired"
    // into a fabricated address — it fails the domain gate instead.
    expect(extractFromHtml(`info@cordialclean.company.com`, "cordialclean.com").email).toBeNull();
  });
});
