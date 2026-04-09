import type { ReactNode } from "react";

import { LigasAdminPageContent } from "../../ligas/page";

interface TenantLigasLayoutProps {
  children: ReactNode;
}

export default function TenantLigasLayout({ children }: TenantLigasLayoutProps) {
  return (
    <>
      {children}
      <LigasAdminPageContent />
    </>
  );
}
