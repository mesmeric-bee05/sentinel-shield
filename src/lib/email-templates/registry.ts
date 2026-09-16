import * as React from "react";

export interface TemplateEntry {
  component: React.ComponentType<Record<string, unknown>>;
  subject: string | ((data: Record<string, unknown>) => string);
  to?: string;
  displayName?: string;
  previewData?: Record<string, unknown>;
}

import { template as bookingConfirmation } from "./booking-confirmation";
import { template as exportJobStatus } from "./export-job-status";

export const TEMPLATES: Record<string, TemplateEntry> = {
  "booking-confirmation": bookingConfirmation,
  "export-job-status": exportJobStatus,
};
