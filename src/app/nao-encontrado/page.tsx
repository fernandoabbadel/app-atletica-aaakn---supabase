import Link from "next/link";

export default function TenantNotFoundPage() {
  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center px-6">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-zinc-950/80 p-8 text-center">
        <p className="text-xs font-black tracking-[0.2em] text-zinc-400 uppercase">Tenant</p>
        <h1 className="mt-3 text-3xl font-black uppercase">Nao encontrado</h1>
        <p className="mt-4 text-sm text-zinc-300">
          Nao foi possivel validar o tenant dessa URL. Confira o link ou volte para o dashboard.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex items-center justify-center rounded-xl bg-emerald-500 px-5 py-2 text-sm font-black uppercase text-black transition hover:bg-emerald-400"
        >
          Voltar ao dashboard
        </Link>
      </section>
    </main>
  );
}
