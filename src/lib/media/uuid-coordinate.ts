import { z } from "zod";

declare const canonicalUuidCoordinateBrand: unique symbol;

export type CanonicalUuidCoordinate = string & {
  readonly [canonicalUuidCoordinateBrand]: true;
};

export const canonicalUuidCoordinateSchema = z.uuid().transform((value) => value.toLowerCase());

export function canonicalizeUuidCoordinate(value: string): CanonicalUuidCoordinate {
  return canonicalUuidCoordinateSchema.parse(value) as CanonicalUuidCoordinate;
}

export function canonicalizeNullableUuidCoordinate(
  value: string | null,
): CanonicalUuidCoordinate | null {
  return value === null ? null : canonicalizeUuidCoordinate(value);
}

export function uuidCoordinatesEqual(left: string, right: string): boolean {
  const canonicalLeft = canonicalUuidCoordinateSchema.safeParse(left);
  const canonicalRight = canonicalUuidCoordinateSchema.safeParse(right);
  return canonicalLeft.success
    && canonicalRight.success
    && canonicalLeft.data === canonicalRight.data;
}

export function nullableUuidCoordinatesEqual(
  left: string | null,
  right: string | null,
): boolean {
  if (left === null || right === null) return left === right;
  return uuidCoordinatesEqual(left, right);
}
