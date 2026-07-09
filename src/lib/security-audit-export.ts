// Shared export column contract for `security_finding_audit` — reused by
// the admin page and the parity test so a rename in one place breaks
// the other via byte-for-byte equality assertions.
import type { ExportColumn } from "@/lib/exports";
import type { SecurityFindingAuditRow } from "@/lib/security.functions";

export const securityAuditExportCols: ExportColumn<SecurityFindingAuditRow>[] = [
  { key: "created_at", label: "Recorded at", value: (r) => r.created_at },
  { key: "resolution", label: "Resolution", value: (r) => r.resolution },
  { key: "internal_id", label: "Internal ID", value: (r) => r.internal_id },
  { key: "scanner_name", label: "Scanner", value: (r) => r.scanner_name },
  { key: "resolved_by", label: "Resolved by", value: (r) => r.resolved_by ?? "" },
  { key: "affected_endpoints", label: "Affected endpoints", value: (r) => (r.affected_endpoints ?? []).join("; ") },
  { key: "affected_queries", label: "Affected queries", value: (r) => (r.affected_queries ?? []).join("; ") },
  { key: "notes", label: "Notes", value: (r) => r.notes ?? "" },
];
