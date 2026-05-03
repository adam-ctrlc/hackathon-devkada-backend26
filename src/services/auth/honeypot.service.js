const HONEYPOT_FIELDS = [
  "website",
  "company",
  "url",
  "fax",
  "phone2",
  "referrer",
  "honeypot",
];

const safeTrim = (value) => (typeof value === "string" ? value.trim() : "");

export const hasHoneypotHit = (payload = {}) =>
  HONEYPOT_FIELDS.some((field) => Boolean(safeTrim(payload?.[field])));

export const rejectIfHoneypotHit = (payload = {}) => {
  if (!hasHoneypotHit(payload)) {
    return null;
  }

  const error = new Error("Invalid request");
  error.status = 400;
  return error;
};
