import type { ReactNode } from "react";

import { LigasAdminPageContent } from "./page";

interface LigasLayoutProps {
  children: ReactNode;
}

export default function LigasLayout({ children }: LigasLayoutProps) {
  return (
    <>
      {children}
      <LigasAdminPageContent />
    </>
  );
}
