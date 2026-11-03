/**
 * The short reference a customer sees on a confirmation screen and in their
 * email (and Alex sees beside the record), made from the record's own random
 * id, so it is never invented and the same record always has the same one.
 * "RAENG-3F9A1C07": the first eight hex characters of the id, upper case.
 */
export function referenceFor(id: string): string {
  const hex = id.replace(/^[a-z-]*\//i, "").replace(/[^0-9a-f]/gi, "").toUpperCase();
  return `RAENG-${hex.slice(0, 8)}`;
}
