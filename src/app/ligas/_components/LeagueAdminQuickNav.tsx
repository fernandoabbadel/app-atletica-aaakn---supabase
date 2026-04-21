"use client";

import Link from "next/link";
import { Calendar, Home, Info, LayoutGrid, ShoppingBag, Users, Wallet } from "lucide-react";

export type LeagueAdminQuickNavKey =
  | "home"
  | "visual"
  | "members"
  | "events"
  | "store"
  | "finance"
  | "board";

interface LeagueAdminQuickNavProps {
  active?: LeagueAdminQuickNavKey;
  homeHref: string;
  informationHref: string;
  membersHref: string;
  eventsHref: string;
  storeHref: string;
  financeHref: string;
  boardHref: string;
  className?: string;
}

const navItems = [
  { key: "home", label: "Início", icon: Home },
  { key: "visual", label: "Informações", icon: Info },
  { key: "members", label: "Membros", icon: Users },
  { key: "events", label: "Agenda", icon: Calendar },
  { key: "store", label: "Loja", icon: ShoppingBag },
  { key: "finance", label: "Gestão", icon: Wallet },
  { key: "board", label: "Board Round", icon: LayoutGrid },
] as const;

export function LeagueAdminQuickNav({
  active,
  homeHref,
  informationHref,
  membersHref,
  eventsHref,
  storeHref,
  financeHref,
  boardHref,
  className = "",
}: LeagueAdminQuickNavProps) {
  const hrefByKey: Record<LeagueAdminQuickNavKey, string> = {
    home: homeHref,
    visual: informationHref,
    members: membersHref,
    events: eventsHref,
    store: storeHref,
    finance: financeHref,
    board: boardHref,
  };

  return (
    <nav
      aria-label="Navegação da liga"
      className={`flex flex-wrap gap-2 rounded-xl border border-zinc-800 bg-zinc-950/70 p-2 ${className}`}
    >
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = active === item.key;
        return (
          <Link
            key={item.key}
            href={hrefByKey[item.key]}
            aria-current={isActive ? "page" : undefined}
            className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border px-3 text-[10px] font-black uppercase tracking-wide transition sm:text-[11px] ${
              isActive
                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200"
                : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-600 hover:text-white"
            }`}
          >
            <Icon size={14} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
