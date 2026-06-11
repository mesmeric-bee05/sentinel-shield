import { ShieldAlert } from "lucide-react";

export function PermissionDeniedCard({
  title = "Insufficient permissions",
  reason = "This area is restricted to administrators. Ask an admin to grant you the role.",
}: { title?: string; reason?: string }) {
  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-8 max-w-xl mx-auto text-center">
      <ShieldAlert className="w-8 h-8 text-amber-600 mx-auto mb-3" />
      <h2 className="font-medium text-base mb-2">{title}</h2>
      <p className="text-sm text-muted-foreground">{reason}</p>
    </div>
  );
}
