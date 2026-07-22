export type AuthProfile = {
  role: string;
  isActive: boolean;
};

/** Returns a profile only when it exists and is active. Missing profiles fail closed. */
export function activeProfile<T extends AuthProfile>(profile: T | undefined): T | null {
  return profile?.isActive ? profile : null;
}
