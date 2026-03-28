import { DashboardPageContent } from "./DashboardPageContent";

export const revalidate = 60;

export default async function DashboardPage() {
  return <DashboardPageContent />;
}
