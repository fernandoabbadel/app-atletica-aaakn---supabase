export const MASTER_CONTACT_PENDING_EVENT = "usc:master-contact-pending-changed";
const MASTER_CONTACT_READ_STORAGE_KEY = "usc_master_contact_read_ids";

type ContactLikeRecord = {
  id: string;
  status?: string;
};

export const dispatchMasterContactPendingChanged = (): void => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(MASTER_CONTACT_PENDING_EVENT));
};

export const getReadMasterContactIds = (): Set<string> => {
  if (typeof window === "undefined") return new Set();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(MASTER_CONTACT_READ_STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0));
  } catch {
    return new Set();
  }
};

export const countUnreadMasterContactReports = <T extends ContactLikeRecord>(reports: T[]): number => {
  const readIds = getReadMasterContactIds();
  return reports.filter((report) => {
    const status = typeof report.status === "string" ? report.status.trim().toLowerCase() : "";
    return report.id && status !== "resolvida" && !readIds.has(report.id);
  }).length;
};

export const markMasterContactReportsRead = <T extends ContactLikeRecord>(reports: T[]): void => {
  if (typeof window === "undefined") return;
  const readIds = getReadMasterContactIds();
  reports.forEach((report) => {
    if (report.id) readIds.add(report.id);
  });
  window.localStorage.setItem(MASTER_CONTACT_READ_STORAGE_KEY, JSON.stringify(Array.from(readIds).slice(-500)));
  dispatchMasterContactPendingChanged();
};
