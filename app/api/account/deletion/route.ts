import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { accountDeletionEnabled } from "@/lib/account/availability";
import { authDeletionAlreadyDone, deletionOriginAllowed, performAccountDeletion } from "@/lib/account/deletion";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

function adminClient(): SupabaseClient | null {
  const config = getSupabaseConfig();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!config || !serviceKey) return null;
  return createClient(config.url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function GET() {
  return json({ enabled: accountDeletionEnabled() });
}

export async function POST(request: Request) {
  if (!deletionOriginAllowed(request.url, request.headers.get("origin"), request.headers.get("host"))) {
    return json({ ok: false, code: "unauthorized", error: "Sign in to delete your account." }, 403);
  }

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const supabase = await getSupabaseServerClient();
  const result = await performAccountDeletion(body, {
    enabled: accountDeletionEnabled(),
    now: () => Date.now(),
    getUser: async () => {
      if (!supabase) return null;
      // getUser() checks the token with Auth. A stored cookie session is not enough.
      const { data, error } = await supabase.auth.getUser();
      if (data.user) {
        return {
          id: data.user.id,
          email: data.user.email ?? null,
          lastSignInAt: data.user.last_sign_in_at ?? null,
        };
      }
      if (!error) return null;
      const { data: sessionData } = await supabase.auth.getSession();
      const staleId = sessionData.session?.user?.id;
      if (!staleId) return null;
      const admin = adminClient();
      if (!admin) return null;
      const lookedUp = await admin.auth.admin.getUserById(staleId);
      if (lookedUp.data.user) return null;
      if (authDeletionAlreadyDone(lookedUp.error)) throw new Error("already-deleted");
      return null;
    },
    prepare: async (email) => {
      if (!supabase) throw new Error("unavailable");
      const { error } = await supabase.rpc("tapact_prepare_account_deletion", { p_confirm: email });
      if (error) throw error;
    },
    deleteAuthUser: async (userId) => {
      const admin = adminClient();
      if (!admin) throw new Error("unavailable");
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error && !authDeletionAlreadyDone(error)) throw error;
    },
  });

  if (result.ok) return json({ ok: true });
  return json({ ok: false, code: result.code, error: result.message }, result.status);
}
