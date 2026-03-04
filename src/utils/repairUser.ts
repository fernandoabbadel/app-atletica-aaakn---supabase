import { getSupabaseClient } from "@/lib/supabase";

// Definicao dos valores padrao para referencia (hardcoded para seguranca do script).
const DEFAULT_VALUES = {
  // Gamificacao
  xp: 0,
  xpMultiplier: 1.0,
  level: 1,
  sharkCoins: 0,
  selos: 0,
  patente: "Plancton", // Valor inicial correto
  tier: "bicho",

  // Plano
  plano: "Bicho Solto",
  plano_status: "ativo",
  plano_badge: "Bicho Solto",
  plano_cor: "zinc",
  plano_icon: "ghost",
  desconto_loja: 0,
  nivel_prioridade: 1,

  // Stats completos
  stats: {
    accountCreated: 1,
    loginCount: 1,
    postsCount: 0,
    commentsCount: 0,
    likesGiven: 0,
    hypesGiven: 0,
    arenaWins: 0,
    arenaLosses: 0,
    scansT8: 0, // Importante para o Album
  },
};

export const repairUserProfile = async (uid: string) => {
  const cleanUid = uid.trim();
  if (!cleanUid) return false;

  try {
    const supabase = getSupabaseClient();
    const { data: currentData, error: selectError } = await supabase
      .from("users")
      .select(
        "uid,email,xp,xpMultiplier,level,sharkCoins,selos,patente,tier,plano,plano_status,plano_badge,plano_cor,plano_icon,desconto_loja,nivel_prioridade,data_adesao,stats"
      )
      .eq("uid", cleanUid)
      .maybeSingle();

    if (selectError) {
      throw selectError;
    }

    if (!currentData) {
      console.log(`Perfil ${cleanUid} nao encontrado.`);
      return false;
    }

    const updates: Record<string, unknown> = {};

    console.log(`Diagnosticando paciente: ${String(currentData.email || cleanUid)}...`);

    // 1. Verificacao de gamificacao e nivel
    if (currentData.xp === undefined) updates.xp = DEFAULT_VALUES.xp;
    if (currentData.level === undefined) updates.level = DEFAULT_VALUES.level;
    if (currentData.sharkCoins === undefined) updates.sharkCoins = DEFAULT_VALUES.sharkCoins;
    if (currentData.selos === undefined) updates.selos = DEFAULT_VALUES.selos;
    if (currentData.xpMultiplier === undefined) updates.xpMultiplier = DEFAULT_VALUES.xpMultiplier;

    // Importante: patente e tier
    if (!currentData.patente) updates.patente = DEFAULT_VALUES.patente;
    if (!currentData.tier) updates.tier = DEFAULT_VALUES.tier;

    // 2. Verificacao de plano e visual
    if (!currentData.plano) updates.plano = DEFAULT_VALUES.plano;
    if (!currentData.plano_status) updates.plano_status = DEFAULT_VALUES.plano_status;
    if (!currentData.plano_badge) updates.plano_badge = DEFAULT_VALUES.plano_badge;
    if (!currentData.plano_cor) updates.plano_cor = DEFAULT_VALUES.plano_cor;
    if (!currentData.plano_icon) updates.plano_icon = DEFAULT_VALUES.plano_icon;
    if (currentData.desconto_loja === undefined) updates.desconto_loja = DEFAULT_VALUES.desconto_loja;
    if (currentData.nivel_prioridade === undefined) {
      updates.nivel_prioridade = DEFAULT_VALUES.nivel_prioridade;
    }

    // Data de adesao (se faltar, assume agora)
    if (!currentData.data_adesao) updates.data_adesao = new Date().toISOString();

    // 3. Verificacao profunda de stats (deep merge)
    const currentStats =
      typeof currentData.stats === "object" && currentData.stats !== null
        ? (currentData.stats as Record<string, unknown>)
        : {};
    const newStats = {
      ...DEFAULT_VALUES.stats, // Comeca com todos os defaults
      ...currentStats, // Sobrescreve com o que o usuario ja tem
    };

    // Compara se o objeto de stats mudou (stringify e rapido para objetos pequenos).
    if (JSON.stringify(newStats) !== JSON.stringify(currentStats)) {
      updates.stats = newStats;
    }

    // 4. Aplicacao do patch
    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await supabase
        .from("users")
        .update({ ...updates, updatedAt: new Date().toISOString() })
        .eq("uid", cleanUid);
      if (updateError) throw updateError;

      console.log(`Perfil ${cleanUid} reparado. Campos corrigidos:`, Object.keys(updates));
      return true;
    }

    console.log(`Perfil ${cleanUid} ja esta 100% saudavel.`);
    return false;
  } catch (error: unknown) {
    console.error("Erro critico ao reparar perfil:", error);
    return false;
  }
};
