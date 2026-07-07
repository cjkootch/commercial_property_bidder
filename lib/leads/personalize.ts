// Fill the intro-letter placeholders from a buyer's live profile. The dossier
// stores the letter with [YOUR COMPANY]/[NAME]/[PHONE]/[EMAIL]/[LICENSE]
// brackets; substitution happens at render time so editing the profile updates
// every letter the buyer holds. Missing fields keep a friendly placeholder.

export type LetterProfile = {
  company_name?: string | null;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  license_number?: string | null;
};

export function personalizeLetter(letter: string, p: LetterProfile): string {
  const sub = (re: RegExp, val: string | null | undefined, fallback: string) =>
    (letter = letter.replace(re, (val && val.trim()) || fallback));
  sub(/\[YOUR COMPANY\]/g, p.company_name, "[your company]");
  sub(/\[NAME\]/g, p.contact_name, "[your name]");
  sub(/\[PHONE\]/g, p.phone, "[your phone]");
  sub(/\[EMAIL\]/g, p.email, "[your email]");
  sub(/\[LICENSE\]/g, p.license_number, "");
  return letter;
}

/** True when the profile has everything the letter needs (drives the nudge). */
export function profileComplete(p: LetterProfile): boolean {
  return Boolean(p.company_name?.trim() && p.contact_name?.trim() && p.phone?.trim() && p.email?.trim());
}
