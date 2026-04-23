export function hasGoogleRoleLogin(input: {
  google_account_email?: string | null;
  google_account_logged_in?: boolean | null;
}) {
  return Boolean(
    input.google_account_logged_in && input.google_account_email?.trim()
  );
}

export function hasCaregiverGoogleLogin(input?: {
  is_active?: boolean | null;
  google_account_email?: string | null;
  google_account_logged_in?: boolean | null;
} | null) {
  return Boolean(
    input?.is_active &&
      input.google_account_logged_in &&
      input.google_account_email?.trim()
  );
}
