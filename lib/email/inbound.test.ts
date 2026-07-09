import { describe, expect, it } from "vitest";
import { parseInboundEmail } from "./inbound";

describe("email/inbound parseInboundEmail", () => {
  it("parses a simple plain-text reply", () => {
    const raw = [
      "Return-Path: <mike@acmepest.com>",
      "From: Mike Nutt <mike@acmepest.com>",
      "Subject: Re: Commercial pest control lead",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Yes, we want this one. Call me at 281-555-0100.",
    ].join("\r\n");
    const p = parseInboundEmail(raw);
    expect(p.fromEmail).toBe("mike@acmepest.com");
    expect(p.from).toContain("Mike Nutt");
    expect(p.subject).toBe("Re: Commercial pest control lead");
    expect(p.text).toContain("we want this one");
  });

  it("pulls the text/plain part from multipart and decodes quoted-printable", () => {
    const raw = [
      "From: owner@dallaslandcare.com",
      "Subject: =?utf-8?Q?Re=3A_Grounds_lead?=",
      'Content-Type: multipart/alternative; boundary="XYZ"',
      "",
      "--XYZ",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "We=E2=80=99re interested =E2=80=94 send details.",
      "--XYZ",
      "Content-Type: text/html",
      "",
      "<p>ignored</p>",
      "--XYZ--",
    ].join("\r\n");
    const p = parseInboundEmail(raw);
    expect(p.fromEmail).toBe("owner@dallaslandcare.com");
    expect(p.subject).toBe("Re: Grounds lead");
    expect(p.text).toContain("We’re interested — send details.");
    expect(p.text).not.toContain("ignored");
  });

  it("falls back to de-tagged html and survives header folding", () => {
    const raw = [
      "From: A Very Long Display Name",
      " <folded@example-company.com>",
      "Subject: hello",
      "Content-Type: text/html",
      "",
      "<div><b>Please</b> call us back.</div>",
    ].join("\r\n");
    const p = parseInboundEmail(raw);
    expect(p.fromEmail).toBe("folded@example-company.com");
    expect(p.text).toContain("Please");
    expect(p.text).not.toContain("<b>");
  });
});
