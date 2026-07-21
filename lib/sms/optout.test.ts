import { describe, expect, it } from "vitest";
import { isOptOutPhrase } from "./optout";

describe("isOptOutPhrase (the 'Remove us from your list' fix)", () => {
  it("catches the exact reply that slipped through on 2026-07-20", () => {
    expect(isOptOutPhrase("Don G. from NxTGen:\n\nRemove us from your list")).toBe(true);
  });

  it.each([
    "Remove me from your list",
    "please take us off your list",
    "Take me off this list",
    "don't text me",
    "Do not text this number",
    "dont message us again",
    "do not contact us",
    "No more texts please",
    "no more messages",
    "lose my number",
    "Wrong number",
  ])("catches: %s", (body) => {
    expect(isOptOutPhrase(body)).toBe(true);
  });

  it.each([
    "Yes",
    "Yes, send it over",
    "Can you remove the old estimate from the sheet?",
    "We're not interested in commercial right now",
    "Who is this?",
    "What's your number?",
    "Send more info",
  ])("leaves normal conversation alone: %s", (body) => {
    expect(isOptOutPhrase(body)).toBe(false);
  });
});
