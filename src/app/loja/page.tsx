import { LojaPageContent } from "./LojaPageContent";

export const revalidate = 60;

export default async function LojaPage() {
  return <LojaPageContent />;
}
