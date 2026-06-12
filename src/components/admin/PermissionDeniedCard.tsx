import { ShieldAlert, RefreshCw } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import type { ForbiddenInfo } from "@/lib/permission";

type Props = {
  title?: string;
  reason?: string;
  info?: ForbiddenInfo | null;
  onRetry?: () => void;
};

export function PermissionDeniedCard({ title, reason, info, onRetry }: Props) {
  const headline = title ?? info?.message ?? "Insufficient permissions";
  const detail = reason ?? info?.recovery ?? "This area is restricted to administrators. Ask an admin to grant you the role.";

  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-8 max-w-xl mx-auto text-center">
      <ShieldAlert className="w-8 h-8 text-amber-600 mx-auto mb-3" />
      <h2 className="font-medium text-base mb-2">{headline}</h2>
      <p className="text-sm text-muted-foreground mb-4">{detail}</p>

      <ul className="text-xs text-left text-muted-foreground space-y-1 mb-4 max-w-sm mx-auto">
        <li>• Verify you are signed in with an admin account.</li>
        <li>• Ask an existing admin to assign the admin role from <span className="font-mono">/app/admin/roles</span>.</li>
        <li>• Reload after the role change — tokens cache for a few minutes.</li>
      </ul>

      <div className="flex items-center justify-center gap-2">
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RefreshCw className="w-3 h-3 mr-1" /> Retry
          </Button>
        )}
        <Button size="sm" variant="ghost" asChild>
          <Link to="/app">Back to overview</Link>
        </Button>
      </div>
    </div>
  );
}
