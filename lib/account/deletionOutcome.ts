export type DeletionOutcome = {
  serverDeleted: boolean;
  deviceCleaned: boolean;
  signedOut: boolean;
  /** The deletion POST may be sent again. This stays false once Auth deletion has succeeded. */
  allowServerRetry: boolean;
  /** A password prompt may be shown. This stays false once Auth deletion has succeeded. */
  allowPassword: boolean;
  title: string;
  detail: string;
};

const DELETED_TITLE = "Your account has been deleted.";

/**
 * Copy shown after the deletion request returns. Server success and device
 * cleanup are separate: a local failure must not say the TapAct account remains.
 */
export function deletionOutcome(input: {
  serverDeleted: boolean;
  deviceCleaned: boolean;
  signedOut: boolean;
  serverMessage: string | null;
}): DeletionOutcome {
  if (!input.serverDeleted) {
    return {
      serverDeleted: false,
      deviceCleaned: false,
      signedOut: false,
      allowServerRetry: true,
      allowPassword: false,
      title: "",
      detail: input.serverMessage ?? "Couldn't delete the account. Check your connection and try again.",
    };
  }

  if (!input.deviceCleaned) {
    return {
      serverDeleted: true,
      deviceCleaned: false,
      signedOut: input.signedOut,
      allowServerRetry: false,
      allowPassword: false,
      title: DELETED_TITLE,
      detail: input.signedOut
        ? "TapAct has removed the sign-in. This browser still has a local copy of that account. Clear it on this device. That does not sign the account in again, and other accounts on this device stay in place."
        : "TapAct has removed the sign-in. This browser still has a local copy, and signing out on this device did not finish. Clear the local copy and finish signing out here. That does not sign the account in again.",
    };
  }

  if (!input.signedOut) {
    return {
      serverDeleted: true,
      deviceCleaned: true,
      signedOut: false,
      allowServerRetry: false,
      allowPassword: false,
      title: DELETED_TITLE,
      detail:
        "TapAct has removed the sign-in, and this device's copy of that account's tracking was cleared. Signing out on this device did not finish. Finish signing out here. That does not create a new sign-in.",
    };
  }

  return {
    serverDeleted: true,
    deviceCleaned: true,
    signedOut: true,
    allowServerRetry: false,
    allowPassword: false,
    title: DELETED_TITLE,
    detail: "This device's copy of that account's tracking was cleared. Other accounts stored on this device were left in place.",
  };
}
