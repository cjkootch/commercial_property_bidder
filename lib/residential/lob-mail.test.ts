import { describe, it, expect } from "vitest";
import {
  validateRecipientAddressShape,
  formatLobAddressPayload,
  estimateLobMailCost,
  calculateClientPrice,
  buildLobMailCampaignDraft,
} from "./lob-mail";

describe("Lob Mail Helpers", () => {
  describe("validateRecipientAddressShape", () => {
    it("should return valid for complete addresses", () => {
      const result = validateRecipientAddressShape({
        address: "123 Main St",
        city: "Tomball",
        state: "TX",
        zip: "77375",
      });
      expect(result.valid).toBe(true);
      expect(result.reasons).toHaveLength(0);
    });

    it("should return invalid for missing fields", () => {
      const result = validateRecipientAddressShape({
        address: "",
        city: " ",
        state: "TX",
        zip: "77375",
      });
      expect(result.valid).toBe(false);
      expect(result.reasons).toContain("Missing address");
      expect(result.reasons).toContain("Missing city");
    });
  });

  describe("formatLobAddressPayload", () => {
    it("should format address correctly with default name", () => {
      const payload = formatLobAddressPayload({
        address: "123 Main St",
        city: "Tomball",
        state: "TX",
        zip: "77375",
      });
      expect(payload.name).toBe("Current Resident");
      expect(payload.address_line1).toBe("123 Main St");
      expect(payload.address_country).toBe("US");
    });

    it("should use provided recipient name", () => {
      const payload = formatLobAddressPayload({
        address: "123 Main St",
        city: "Tomball",
        state: "TX",
        zip: "77375",
        recipient_name: "John Doe",
      });
      expect(payload.name).toBe("John Doe");
    });
  });

  describe("estimateLobMailCost", () => {
    it("should estimate cost correctly for different formats", () => {
      expect(estimateLobMailCost(100, "postcard_6x9")).toBe(11500);
      expect(estimateLobMailCost(100, "postcard_6x11")).toBe(13500);
      expect(estimateLobMailCost(100, "letter")).toBe(15000);
    });
  });

  describe("calculateClientPrice", () => {
    it("should apply markup and enforce minimum", () => {
      // 100 recipients * 115 = 11500. 11500 * 2.5 = 28750.
      expect(calculateClientPrice(11500, 100)).toBe(28750);
      // 10 recipients * 115 = 1150. 1150 * 2.5 = 2875. Minimum 25000.
      expect(calculateClientPrice(1150, 10)).toBe(25000);
    });
  });

  describe("buildLobMailCampaignDraft", () => {
    it("should generate a draft with placeholders replaced", () => {
      const pkg = { id: "pkg_123", name: "New Homeowners" } as any;
      const recipients = [{ address: "123 Main St", city: "Tomball", state: "TX", zip: "77375" }];
      const opts = {
        company_name: "Greenkeep",
        company_phone: "555-0199",
        cta_url: "https://greenkeep.us/quote",
        offer_headline: "Welcome Offer",
      };

      const draft = buildLobMailCampaignDraft(pkg, recipients, opts);
      expect(draft.status).toBe("proof_ready");
      expect(draft.offer_headline).toBe("Welcome Offer");
      expect(draft.proof_front_html).toContain("Welcome Offer");
      expect(draft.proof_back_html).toContain("Greenkeep");
      expect(draft.proof_back_html).toContain("555-0199");
      expect(draft.proof_back_html).toContain("https://greenkeep.us/quote");
    });
  });
});
