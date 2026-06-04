import { createServerFn } from "@tanstack/react-start";

// Tiny public server fn for reading the GSC verification meta token.
// Lives in src/lib/ (not src/server/) so the root route loader can import it
// without tripping the import-protection plugin.
export const getSeoMeta = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("seo_settings")
    .select("gsc_meta_token")
    .eq("id", 1)
    .maybeSingle();
  return { gscToken: data?.gsc_meta_token ?? null };
});
