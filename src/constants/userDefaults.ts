// src/constants/userDefaults.ts

// 1. Estatísticas Padrão (DNA do Tubarão)
export const DEFAULT_STATS = {
    accountCreated: 1,
    inviteActivations: 0,
    loginCount: 1,
    postsCount: 0,
    commentsCount: 0,
    likesReceived: 0,
    likesGiven: 0,
    hypesGiven: 0,
    validReports: 0,
    loginStreak: 0,
    gymCheckins: 0,
    gymEarlyBird: 0,
    gymNightOwl: 0,
    gymStreak: 0,
    arenaMatches: 0,
    arenaWins: 0,
    arenaLosses: 0,
    arenaLoseStreak: 0,
    storeSpent: 0,
    albumCollected: 0,
    storeItemsCount: 0,
    eventsAttended: 0,
    eventsPromo: 0,
    eventsAcademic: 0,
    solidarityCount: 0,
    scansT8: 0
};

// 2. Propriedades Padrão do Usuário (Pele do Tubarão)
export const DEFAULT_USER_PROPS = {
    // Gamificação Inicial
    xp: 50,
    xpMultiplier: 1.0,
    level: 1,
    patente: "Plâncton",
    tier: "bicho",
    sharkCoins: 0,
    selos: 0,

    // Plano Inicial (Free)
    plano: "Bicho Solto",
    plano_status: "ativo",
    plano_badge: "Bicho Solto",
    plano_cor: "zinc",
    plano_icon: "ghost",
    desconto_loja: 0,
    nivel_prioridade: 1,

    // Configurações do Sistema
    role: "guest",
    status: "ativo",
    isAnonymous: false,
    idadePublica: true,
    relacionamentoPublico: true,
    whatsappPublico: true,
};
