export const PUSH_RELEASE_STEP_MS = 1500;

export type PushReleaseResult = {
  hadSubscription: boolean;
  serverReleased: boolean;
  browserReleased: boolean;
};

/**
 * Removes this browser from the signed-in account, then unsubscribes locally.
 *
 * Each step has its own deadline so a hung request cannot hold sign-out open.
 * An RPC `{ error }` is a failed unregister, not success. Browser unsubscribe
 * still runs after a server failure, including a second attempt that rejects
 * because permission was revoked or the subscription was already gone.
 *
 * Offline limitation: if this device cannot reach TapAct, the account row can
 * stay active. Push already accepted by the push service cannot be recalled.
 * Later sends stop once the browser unsubscribes, the subscription returns
 * 404 or 410, or another account registers this same endpoint and takes it over.
 */
export async function releasePushSubscription(deps: {
  lookup: () => Promise<{ endpoint: string; unsubscribe: () => Promise<unknown> } | null>;
  unregister: (endpoint: string) => Promise<{ error: { message?: string } | null }>;
  timeoutMs?: number;
}): Promise<PushReleaseResult> {
  const timeoutMs = deps.timeoutMs ?? PUSH_RELEASE_STEP_MS;
  const result: PushReleaseResult = {
    hadSubscription: false,
    serverReleased: false,
    browserReleased: false,
  };
  let subscription: { endpoint: string; unsubscribe: () => Promise<unknown> } | null = null;
  try {
    subscription = await withDeadline(Promise.resolve().then(() => deps.lookup()), timeoutMs);
  } catch {
    return result;
  }
  if (!subscription?.endpoint) return result;
  result.hadSubscription = true;
  try {
    const response = await withDeadline(deps.unregister(subscription.endpoint), timeoutMs);
    result.serverReleased = !response?.error;
  } catch {
    result.serverReleased = false;
  }
  try {
    await withDeadline(Promise.resolve().then(() => subscription.unsubscribe()), timeoutMs);
    result.browserReleased = true;
  } catch {
    result.browserReleased = false;
  }
  return result;
}

export function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bounded = new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
    work.then(resolve, reject);
  });
  work.catch(() => undefined);
  return bounded.finally(() => {
    if (timer) clearTimeout(timer);
  });
}
