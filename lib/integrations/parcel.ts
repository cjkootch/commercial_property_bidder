// Integration seam (build spec section 12). Future owner-of-record resolution
// (county parcel / assessor data) to help confirm the grounds-controlling
// entity. This NEVER auto-fills property.owner_org — owner_org stays
// operator-supplied truth (build spec section 9). Not built in the MVP.

export interface ParcelOwnerRecord {
  owner_name: string;
  mailing_address?: string;
  parcel_id?: string;
}

export async function resolveOwnerOfRecord(
  _address: string
): Promise<ParcelOwnerRecord> {
  throw new Error("NotImplemented: parcel owner-of-record resolution is a future seam.");
}
