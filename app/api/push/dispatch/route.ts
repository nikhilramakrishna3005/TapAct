import { createClient } from "@supabase/supabase-js";
import * as webpush from "web-push";
import { cronAuthorized } from "@/lib/push/cron";
import {
  pushPayload,
  PUSH_BATCH_LIMIT,
  runPushDispatch,
  safeDeliveryError,
  type ClaimedPushDelivery,
  type PushOutcome,
} from "@/lib/push/delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

function asClaimed(raw: unknown): ClaimedPushDelivery[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.endpoint !== "string" || typeof row.duelId !== "string") return [];
    if (typeof row.title !== "string" || typeof row.body !== "string") return [];
    if (typeof row.p256dh !== "string" || typeof row.authKey !== "string" || typeof row.notificationId !== "string") return [];
    return [{
      id: row.id,
      notificationId: row.notificationId,
      title: row.title,
      body: row.body,
      duelId: row.duelId,
      endpoint: row.endpoint,
      p256dh: row.p256dh,
      authKey: row.authKey,
    }];
  });
}

async function dispatch(request: Request): Promise<Response> {
  if (!cronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!publicKey || !privateKey || !subject || !supabaseUrl || !serviceKey) {
    return Response.json({ error: "Delivery setup incomplete" }, { status: 503 });
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const summary = await runPushDispatch({
      reconcile: async () => {
        const { error } = await admin.rpc("tapact_reconcile_due_duel_notifications");
        if (error) throw error;
      },
      claim: async () => {
        const { data, error } = await admin.rpc("tapact_claim_push_deliveries", {
          p_batch: PUSH_BATCH_LIMIT,
          p_worker: "vercel-cron",
        });
        if (error) throw error;
        return asClaimed(data);
      },
      send: async (item) => {
        try {
          const result = await webpush.sendNotification(
            { endpoint: item.endpoint, keys: { p256dh: item.p256dh, auth: item.authKey } },
            pushPayload({
              notificationId: item.notificationId,
              title: item.title,
              body: item.body,
              duelId: item.duelId,
            }),
            { TTL: 60 * 60 },
          );
          return { status: result.statusCode };
        } catch (error) {
          const status = error && typeof error === "object" && "statusCode" in error
            ? Number((error as { statusCode: unknown }).statusCode)
            : 0;
          return { status: Number.isFinite(status) ? status : 0 };
        }
      },
      finish: async (id, outcome: PushOutcome) => {
        const { error } = await admin.rpc("tapact_finish_push_delivery", {
          p_id: id,
          p_outcome: outcome,
          p_error: outcome === "sent" ? null : safeDeliveryError(outcome),
        });
        if (error) throw error;
      },
    });
    return Response.json(summary);
  } catch {
    return Response.json({ error: "Delivery could not finish." }, { status: 500 });
  }
}

export function GET(request: Request): Promise<Response> {
  return dispatch(request);
}

export function POST(request: Request): Promise<Response> {
  return dispatch(request);
}
