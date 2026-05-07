import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const updatePatientContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    phoneE164: z.string().regex(/^\+[1-9]\d{6,14}$/).nullable(),
    smsOptIn: z.boolean(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({ phone_e164: data.phoneE164, sms_opt_in: data.smsOptIn })
      .eq("id", context.userId);
    if (error) return { ok: false, error: error.message };
    return { ok: true, error: null as string | null };
  });

export const getPatientContact = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("profiles")
      .select("phone_e164, sms_opt_in, email, full_name")
      .eq("id", context.userId)
      .maybeSingle();
    return {
      phoneE164: data?.phone_e164 ?? null,
      smsOptIn: !!data?.sms_opt_in,
      email: data?.email ?? null,
      fullName: data?.full_name ?? null,
    };
  });
