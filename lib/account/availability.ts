/** Server-only switch. Unset means deletion stays off, including in production. */
export function accountDeletionEnabled(): boolean {
  return process.env.ACCOUNT_DELETION_ENABLED === "true";
}
