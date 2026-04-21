export const MASTER_CONTACT_PENDING_EVENT = "usc:master-contact-pending-changed";

export const dispatchMasterContactPendingChanged = (): void => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(MASTER_CONTACT_PENDING_EVENT));
};
