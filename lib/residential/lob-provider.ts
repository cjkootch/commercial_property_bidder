// Lob provider abstraction for residential direct mail fulfillment.
//
// This module defines the interface for interacting with the Lob API and
// provides safe stubs for future implementation. It includes checks to
// ensure that real mail is not sent during the foundation building phase.

export interface CreateLobPostcardArgs {
  to: {
    name: string;
    address_line1: string;
    address_city: string;
    address_state: string;
    address_zip: string;
    address_country: string;
  };
  front: string; // HTML string
  back: string; // HTML string
  size: "6x9" | "6x11";
  metadata?: Record<string, string>;
}

export interface LobProviderResult {
  id: string;
  status: string;
  expected_delivery_date?: string;
  raw_response: any;
}

export interface LobProvider {
  createTestPostcard(args: CreateLobPostcardArgs): Promise<LobProviderResult>;
  createLivePostcard(args: CreateLobPostcardArgs): Promise<LobProviderResult>;
}

/**
 * Returns the Lob API key from environment variables.
 */
export function getLobApiKey(): string | null {
  return process.env.LOB_API_KEY || null;
}

/**
 * Ensures that the environment is in test mode only.
 * This is a safeguard against accidental live mailings.
 */
export function assertLobTestMode() {
  const apiKey = getLobApiKey();
  if (apiKey && !apiKey.startsWith("test_")) {
    throw new Error(
      "Safety check failed: A live Lob API key was detected, but only test keys are allowed for now."
    );
  }
}

/**
 * Foundation implementation of the Lob provider.
 * createTestPostcard returns a fake success in development.
 * createLivePostcard is explicitly blocked.
 */
export const lobProvider: LobProvider = {
  async createTestPostcard(args: CreateLobPostcardArgs): Promise<LobProviderResult> {
    assertLobTestMode();

    console.log("[Lob Provider] createTestPostcard called (Foundation Stub)");

    // In a real implementation, this would call the Lob API.
    // For now, we return a mock result to allow the foundation to be tested.
    return {
      id: `psc_test_${Math.random().toString(36).substring(7)}`,
      status: "test_submitted",
      expected_delivery_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      raw_response: {
        message: "This is a mock response from the Lob Provider foundation stub.",
        args,
      },
    };
  },

  async createLivePostcard(_args: CreateLobPostcardArgs): Promise<LobProviderResult> {
    throw new Error("Live Lob mailing is not implemented.");
  },
};
