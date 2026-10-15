import { createClient } from "@supabase/supabase-js";
import { accountDeletionEnabled } from "@/lib/account/availability";
import { performAccountDeletion } from "@/lib/account/deletion";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ enabled: accountDeletionEnabled() });
}

export async function POST(request: Request) {
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
      if (error || !data.user) return null;
      return {
        id: data.user.id,
        email: data.user.email ?? null,
        lastSignInAt: data.user.last_sign_in_at ?? null,
      };
    },
    prepare: async (email) => {
      if (!supabase) throw new Error("unavailable");
      const { error } = await supabase.rpc("tapact_prepare_account_deletion", { p_confirm: email });
      if (error) throw error;
    },
    deleteAuthUser: async (userId) => {
      const config = getSupabaseConfig();
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
      if (!config || !serviceKey) throw new Error("unavailable");
      const admin = createClient(config.url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw error;
    },
  });

  if (result.ok) return Response.json({ ok: true });
  return Response.json({ ok: false, code: result.code, error: result.message }, { status: result.status });
}
