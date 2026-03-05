import { redirect } from "next/navigation";

export default function AdminEventosEnveLegacyRedirectPage() {
  redirect("/admin/eventos/encerrados");
}
