import { createStart } from "@tanstack/react-start";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { requireSameOrigin } from "@/integrations/supabase/csrf-middleware";

export const startInstance = createStart(() => ({
  // requireSameOrigin runs on every server function and rejects mutating
  // requests whose Origin/Referer does not match the request host.
  functionMiddleware: [attachSupabaseAuth, requireSameOrigin],
}));
