"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, LifeBuoy, Loader2, Mail, Phone, Send, ShieldAlert } from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { submitSupportRequest, type SupportCategory } from "@/lib/reportsService";

const MESSAGE_MAX_CHARS = 300;

const CONTACT_OPTIONS: Array<{
  value: "duvida" | "sugestao" | "denuncia";
  label: string;
  category: SupportCategory;
}> = [
  { value: "duvida", label: "Duvida", category: "geral" },
  { value: "sugestao", label: "Sugestao", category: "sugestorias" },
  { value: "denuncia", label: "Denuncia", category: "denuncia" },
];

export default function ContatoUscPage() {
  const { user, loginGoogle, loading: authLoading } = useAuth();
  const { addToast } = useToast();

  const [contactType, setContactType] = useState<(typeof CONTACT_OPTIONS)[number]["value"]>("duvida");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState(typeof user?.email === "string" ? user.email : "");
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);

  const selectedOption = useMemo(
    () => CONTACT_OPTIONS.find((option) => option.value === contactType) || CONTACT_OPTIONS[0],
    [contactType]
  );

  useEffect(() => {
    if (typeof user?.email === "string" && user.email.trim()) {
      setEmail((current) => current || user.email);
    }
  }, [user?.email]);

  const handleGoogleAccess = async () => {
    try {
      await loginGoogle({ returnTo: "/contato-usc" });
    } catch {
      addToast("Nao foi possivel abrir o login Google agora.", "error");
    }
  };

  const handleSubmit = async () => {
    if (!user || user.isAnonymous) {
      addToast("Entre com Google para mandar mensagem ao painel master.", "error");
      return;
    }

    const cleanEmail = email.trim();
    const cleanPhone = phone.trim();
    const cleanMessage = message.trim();

    if (!cleanEmail) {
      addToast("Informe um email para contato.", "error");
      return;
    }

    if (!cleanPhone) {
      addToast("Informe um telefone para contato.", "error");
      return;
    }

    if (!cleanMessage) {
      addToast("Escreva a sua mensagem.", "error");
      return;
    }

    try {
      setSending(true);
      await submitSupportRequest({
        userId: user.uid,
        userName: user.nome || "Usuario USC",
        userEmail: cleanEmail,
        category: selectedOption.category,
        subject: `USC - ${selectedOption.label}`,
        message: [`Email: ${cleanEmail}`, `Telefone: ${cleanPhone}`, cleanMessage].join("\n"),
      });
      setMessage("");
      setPhone("");
      addToast("Mensagem enviada para o painel master.", "success");
    } catch {
      addToast("Nao foi possivel enviar a mensagem agora.", "error");
    } finally {
      setSending(false);
    }
  };

  const requiresGoogleLogin = !user || user.isAnonymous;

  return (
    <div className="min-h-screen bg-[#050505] px-4 py-8 text-white">
      <main className="mx-auto max-w-2xl space-y-6">
        <header className="flex items-center gap-3">
          <Link
            href="/"
            className="rounded-full border border-zinc-800 bg-zinc-900 p-2 transition hover:bg-zinc-800"
          >
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="inline-flex items-center gap-2 text-2xl font-black uppercase tracking-tight">
              <LifeBuoy size={20} className="text-brand-accent" />
              Contato USC
            </h1>
            <p className="mt-1 text-sm text-zinc-400">
              Duvidas, sugestoes e denuncias enviadas direto para o painel master.
            </p>
          </div>
        </header>

        {requiresGoogleLogin ? (
          <section className="rounded-3xl border border-brand bg-brand-primary/10 p-6">
            <p className="inline-flex items-center gap-2 text-sm font-bold text-brand-accent">
              <ShieldAlert size={16} />
              Entre com Google para abrir esse canal.
            </p>
            <p className="mt-2 text-sm text-zinc-300">
              Esse formulario e global da USC, entao a identificacao do usuario precisa ser real.
            </p>
            <button
              onClick={() => void handleGoogleAccess()}
              disabled={authLoading}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-zinc-900 transition hover:bg-zinc-200 disabled:opacity-60"
            >
              {authLoading ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
              Entrar com Google
            </button>
          </section>
        ) : (
          <section className="space-y-4 rounded-3xl border border-zinc-800 bg-zinc-900/80 p-6">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1 md:col-span-2">
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                  Titulo
                </span>
                <select
                  value={contactType}
                  onChange={(event) => setContactType(event.target.value as (typeof CONTACT_OPTIONS)[number]["value"])}
                  className="w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-3 text-sm outline-none focus:border-brand"
                >
                  {CONTACT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                  Email
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-3 text-sm outline-none focus:border-brand"
                  placeholder="voce@exemplo.com"
                />
              </label>

              <label className="space-y-1">
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                  Telefone
                </span>
                <input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value.slice(0, 20))}
                  className="w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-3 text-sm outline-none focus:border-brand"
                  placeholder="(12) 99999-9999"
                />
              </label>

              <label className="space-y-1 md:col-span-2">
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
                  Mensagem
                </span>
                <textarea
                  rows={6}
                  maxLength={MESSAGE_MAX_CHARS}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  className="w-full resize-none rounded-xl border border-zinc-700 bg-black/40 px-3 py-3 text-sm outline-none focus:border-brand"
                  placeholder="Escreva aqui a sua duvida, sugestao ou denuncia."
                />
                <p className="text-right text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
                  {message.length}/{MESSAGE_MAX_CHARS}
                </p>
              </label>
            </div>

            <button
              onClick={() => void handleSubmit()}
              disabled={sending}
              className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-3 text-xs font-black uppercase tracking-[0.16em] text-black transition hover:brightness-110 disabled:opacity-60"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {sending ? "Enviando..." : "Enviar"}
            </button>

            <p className="inline-flex items-center gap-2 text-[11px] text-zinc-500">
              <Phone size={12} />
              A resposta vai aparecer no painel master e pode voltar para voce pelo contato informado.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
