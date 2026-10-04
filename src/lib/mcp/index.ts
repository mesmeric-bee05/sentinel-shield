import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listAppointments from "./tools/list-appointments";
import searchProviders from "./tools/search-providers";

const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";

export default defineMcp({
  name: "sentinel-shield",
  title: "Sentinel Shield",
  version: "0.1.0",
  instructions:
    "Tools for the ApexCare AI healthcare workspace. Use `search_providers` to find clinicians and `list_my_appointments` to see the signed-in user's visits.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [searchProviders, listAppointments],
});
