export type FirebaseServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

type NotificationEnvironment = Record<string, string | undefined>;

export function resolveFirebaseServiceAccount(
  env: NotificationEnvironment = process.env,
): FirebaseServiceAccount | null {
  const raw = env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<FirebaseServiceAccount>;
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      return null;
    }
    return parsed as FirebaseServiceAccount;
  } catch {
    return null;
  }
}
