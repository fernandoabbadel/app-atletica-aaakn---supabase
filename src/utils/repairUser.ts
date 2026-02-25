import { db } from "@/lib/firebase"; // Ajuste se seu path for diferente
import { doc, updateDoc, getDoc } from "firebase/firestore";

// Definição dos valores padrão para referência (Hardcoded para segurança do script)
const DEFAULT_VALUES = {
  // Gamificação
  xp: 0,
  xpMultiplier: 1.0,
  level: 1,
  sharkCoins: 0,
  selos: 0,
  patente: "Plâncton", // Valor inicial correto
  tier: "bicho",
  
  // Plano
  plano: "Bicho Solto",
  plano_status: "ativo",
  plano_badge: "Bicho Solto",
  plano_cor: "gray",
  plano_icon: "user",
  desconto_loja: 0,
  nivel_prioridade: 0,

  // Stats Completos
  stats: {
    accountCreated: 1,
    loginCount: 1,
    postsCount: 0,
    commentsCount: 0,
    likesGiven: 0,
    hypesGiven: 0,
    arenaWins: 0,
    arenaLosses: 0,
    scansT8: 0, // Importante para o Álbum
  }
};

export const repairUserProfile = async (uid: string) => {
  if (!uid) return false;

  try {
    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      console.log(`❌ Perfil ${uid} não encontrado.`);
      return false;
    }

    const currentData = userSnap.data();
    
    // 🦈 CORREÇÃO: Substituindo 'any' por 'Record<string, unknown>'
    const updates: Record<string, unknown> = {};

    console.log(`🔍 Diagnosticando paciente: ${currentData.email || uid}...`);

    // --- 1. Verificação de Gamificação e Nível ---
    if (currentData.xp === undefined) updates.xp = DEFAULT_VALUES.xp;
    if (currentData.level === undefined) updates.level = DEFAULT_VALUES.level;
    if (currentData.sharkCoins === undefined) updates.sharkCoins = DEFAULT_VALUES.sharkCoins;
    if (currentData.selos === undefined) updates.selos = DEFAULT_VALUES.selos;
    if (currentData.xpMultiplier === undefined) updates.xpMultiplier = DEFAULT_VALUES.xpMultiplier;
    
    // Importante: Patente e Tier
    if (!currentData.patente) updates.patente = DEFAULT_VALUES.patente;
    if (!currentData.tier) updates.tier = DEFAULT_VALUES.tier;

    // --- 2. Verificação de Plano e Visual ---
    if (!currentData.plano) updates.plano = DEFAULT_VALUES.plano;
    if (!currentData.plano_badge) updates.plano_badge = DEFAULT_VALUES.plano_badge;
    if (!currentData.plano_cor) updates.plano_cor = DEFAULT_VALUES.plano_cor;
    if (!currentData.plano_icon) updates.plano_icon = DEFAULT_VALUES.plano_icon;
    if (currentData.desconto_loja === undefined) updates.desconto_loja = DEFAULT_VALUES.desconto_loja;
    
    // Data de adesão (Se faltar, assume agora)
    if (!currentData.data_adesao) updates.data_adesao = new Date().toISOString();

    // --- 3. Verificação Profunda de Stats (Deep Merge) ---
    const currentStats = currentData.stats || {};
    const newStats = {
      ...DEFAULT_VALUES.stats, // Começa com todos os defaults
      ...currentStats          // Sobrescreve com o que o usuário JÁ tem
    };

    // Compara se o objeto de stats mudou (stringify é rápido para objetos pequenos)
    if (JSON.stringify(newStats) !== JSON.stringify(currentStats)) {
        updates.stats = newStats;
    }

    // --- 4. Aplicação do Patch ---
    if (Object.keys(updates).length > 0) {
      await updateDoc(userRef, updates);
      console.log(`✅ Perfil ${uid} reparado! Campos corrigidos:`, Object.keys(updates));
      return true;
    } else {
      console.log(`✨ Perfil ${uid} já está 100% saudável.`);
      return false;
    }

  } catch (error) {
    console.error("🚨 Erro crítico ao reparar perfil:", error);
    return false;
  }
};