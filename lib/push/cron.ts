import { timingSafeEqual } from "node:crypto";

export function cronAuthorized(header: string | null, secret: string | undefined): boolean {
  const expected = secret?.trim() ?? "";
  if (expected.length < 16 || !header?.startsWith("Bearer ")) return false;
  const presented = header.slice("Bearer ".length);
  const left = Buffer.from(presented);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
