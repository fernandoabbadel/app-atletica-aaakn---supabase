
export type AchievementCategory = "Geral" | "Gym" | "Games" | "Social" | "Loja" | "Eventos";

export interface Achievement {
    id: string;
    titulo: string;
    desc: string;
    cat: AchievementCategory;
    xp: number;
    target: number; 
    statKey: string; 
    iconName: string; 
}

export const ACHIEVEMENTS_CATALOG: Achievement[] = [
    // =================================================================
    // 1. GERAL (ACESSO & FIDELIDADE)
    // =================================================================
    { id: "acc_1", titulo: "Recruta", desc: "Logou 5 vezes no aplicativo.", cat: "Geral", xp: 50, target: 5, statKey: "loginCount", iconName: "Fish" },
    { id: "soc_1", titulo: "Primeiro Mergulho", desc: "Criou sua conta no cardume.", cat: "Geral", xp: 50, target: 1, statKey: "accountCreated", iconName: "UserPlus" },
    { id: "acc_2", titulo: "Veterano", desc: "Logou 100 vezes no aplicativo.", cat: "Geral", xp: 1000, target: 100, statKey: "loginCount", iconName: "Medal" },
    { id: "acc_3", titulo: "Ritmo Firme", desc: "Manteve 5 dias de login seguidos.", cat: "Geral", xp: 200, target: 5, statKey: "loginStreak", iconName: "Zap" },
    { id: "acc_4", titulo: "Viciado em Resenha", desc: "Manteve 30 dias de login seguidos.", cat: "Geral", xp: 2000, target: 30, statKey: "loginStreak", iconName: "Zap" },
    { id: "acc_5", titulo: "Inabalável", desc: "Manteve 100 dias de login seguidos.", cat: "Geral", xp: 10000, target: 100, statKey: "loginStreak", iconName: "Crown" },
    { id: "acc_6", titulo: "Perfil Completo", desc: "Preencheu todos os dados do cadastro.", cat: "Geral", xp: 300, target: 1, statKey: "profileComplete", iconName: "CheckCircle2" },

    // =================================================================
    // 2. GAMES (ARENA)
    // =================================================================
    { id: "game_3", titulo: "Primeiro GG", desc: "Venceu sua primeira partida.", cat: "Games", xp: 100, target: 1, statKey: "arenaWins", iconName: "Trophy" },
    { id: "game_1", titulo: "Player 1", desc: "Participou de 1 partida na Arena.", cat: "Games", xp: 50, target: 1, statKey: "arenaMatches", iconName: "Gamepad2" },
    { id: "game_2", titulo: "Competitivo", desc: "Participou de 20 partidas na Arena.", cat: "Games", xp: 500, target: 20, statKey: "arenaMatches", iconName: "Swords" },
    { id: "game_4", titulo: "Carrasco", desc: "Venceu 15 partidas na Arena.", cat: "Games", xp: 1500, target: 15, statKey: "arenaWins", iconName: "Skull" },
    { id: "game_5", titulo: "Lenda da Arena", desc: "Venceu 50 partidas na Arena.", cat: "Games", xp: 8000, target: 50, statKey: "arenaWins", iconName: "Crown" },
    { id: "game_6", titulo: "Saco de Pancada", desc: "Perdeu 5 partidas seguidas.", cat: "Games", xp: 50, target: 5, statKey: "arenaLossStreak", iconName: "Ghost" },
    { id: "game_7", titulo: "MVP AAAKN", desc: "Ganhou um torneio oficial da Arena.", cat: "Games", xp: 5000, target: 1, statKey: "arenaTournamentsWon", iconName: "Star" },

    // =================================================================
    // 3. GYM RATS (TREINOS)
    // =================================================================
    { id: "gym_1", titulo: "Primeiro Treino", desc: "Confirmou presença em 1 treino.", cat: "Gym", xp: 100, target: 1, statKey: "gymCheckins", iconName: "Activity" },
    { id: "gym_2", titulo: "Em Evolução", desc: "Confirmou presença em 10 treinos.", cat: "Gym", xp: 400, target: 10, statKey: "gymCheckins", iconName: "Dumbbell" },
    { id: "gym_3", titulo: "Rato de Academia", desc: "Confirmou presença em 50 treinos.", cat: "Gym", xp: 2000, target: 50, statKey: "gymCheckins", iconName: "Dumbbell" },
    { id: "gym_4", titulo: "Monstro da Jaula", desc: "Confirmou presença em 150 treinos.", cat: "Gym", xp: 7000, target: 150, statKey: "gymCheckins", iconName: "Beiceps" }, // Nota: Icone Biceps não existe no lucide padrão, trocado para Dumbbell ou similar se der erro, mantendo visual
    { id: "gym_5", titulo: "Madrugador", desc: "Treino confirmado antes das 06:30.", cat: "Gym", xp: 500, target: 1, statKey: "gymEarlyBird", iconName: "Timer" },
    { id: "gym_6", titulo: "Foco Total", desc: "Manteve 10 dias seguidos de treino.", cat: "Gym", xp: 1500, target: 10, statKey: "gymStreak", iconName: "Target" },
    { id: "gym_7", titulo: "Shape Inexplicável", desc: "Alcançou o nível máximo de treinos no semestre.", cat: "Gym", xp: 5000, target: 80, statKey: "gymSemesterTotal", iconName: "Trophy" },

    // =================================================================
    // 4. EVENTOS & ATLÉTICA
    // =================================================================
    { id: "evt_1", titulo: "Rolezeiro", desc: "Fez check-in em 1 evento oficial.", cat: "Eventos", xp: 100, target: 1, statKey: "eventsAttended", iconName: "Ticket" },
    { id: "evt_2", titulo: "Inimigo do Fim", desc: "Fez check-in em 5 eventos oficiais.", cat: "Eventos", xp: 800, target: 5, statKey: "eventsAttended", iconName: "PartyPopper" },
    { id: "evt_3", titulo: "Tubarão de Elite", desc: "Fez check-in em 20 eventos oficiais.", cat: "Eventos", xp: 5000, target: 20, statKey: "eventsAttended", iconName: "Crown" },
    { id: "evt_4", titulo: "Comissário", desc: "Vendeu 10 ingressos via código.", cat: "Eventos", xp: 2000, target: 10, statKey: "ticketSales", iconName: "Briefcase" },
    { id: "evt_5", titulo: "VIP", desc: "Comprou 3 ingressos de Lote Promocional.", cat: "Eventos", xp: 500, target: 3, statKey: "promoTicketsBought", iconName: "Gem" },
    { id: "evt_6", titulo: "Nerd da Turma", desc: "Participou de 2 eventos acadêmicos.", cat: "Eventos", xp: 400, target: 2, statKey: "academicEvents", iconName: "GraduationCap" },
    { id: "evt_7", titulo: "Coração de Ouro", desc: "Participou de uma ação social da Atlética.", cat: "Eventos", xp: 2000, target: 1, statKey: "socialActions", iconName: "HeartHandshake" },

    // =================================================================
    // 5. LOJA (FINANCEIRO)
    // =================================================================
    { id: "shop_1", titulo: "Apoiador", desc: "Realizou sua primeira compra na loja.", cat: "Loja", xp: 500, target: 1, statKey: "storeOrders", iconName: "ShoppingBag" },
    { id: "shop_2", titulo: "Investidor I", desc: "Gastou R$ 200,00 totais na loja.", cat: "Loja", xp: 500, target: 200, statKey: "moneySpent", iconName: "DollarSign" },
    { id: "shop_3", titulo: "Investidor II", desc: "Gastou R$ 1.000,00 totais na loja.", cat: "Loja", xp: 3000, target: 1000, statKey: "moneySpent", iconName: "Wallet" },
    { id: "shop_4", titulo: "Baleia Branca", desc: "Gastou R$ 5.000,00 totais na loja.", cat: "Loja", xp: 16000, target: 5000, statKey: "moneySpent", iconName: "Diamond" }, // Diamond não importado, usar Gem
    { id: "shop_5", titulo: "Colecionador", desc: "Comprou 10 produtos diferentes.", cat: "Loja", xp: 1000, target: 10, statKey: "uniqueProductsBought", iconName: "LayoutGrid" },
    { id: "shop_6", titulo: "Sócio Elite", desc: "Assinou o plano semestral.", cat: "Loja", xp: 5000, target: 1, statKey: "semesterPlanActive", iconName: "ShieldAlert" },

    // =================================================================
    // 6. SOCIAL (COMUNIDADE)
    // =================================================================
    { id: "soc_2", titulo: "Tubarão Social", desc: "Fez 5 posts na comunidade.", cat: "Social", xp: 100, target: 5, statKey: "postsCount", iconName: "Megaphone" },
    { id: "soc_3", titulo: "A Voz do Oceano", desc: "Fez 50 posts na comunidade.", cat: "Social", xp: 1000, target: 50, statKey: "postsCount", iconName: "Megaphone" },
    { id: "soc_4", titulo: "Tagarela", desc: "Comentou em 20 publicações.", cat: "Social", xp: 150, target: 20, statKey: "commentsCount", iconName: "MessageCircle" },
    { id: "soc_5", titulo: "Debatedor Sênior", desc: "Comentou em 100 publicações.", cat: "Social", xp: 800, target: 100, statKey: "commentsCount", iconName: "MessageCircle" },
    { id: "soc_6", titulo: "Influencer I", desc: "Recebeu 10 curtidas em seus posts.", cat: "Social", xp: 100, target: 10, statKey: "likesReceived", iconName: "Heart" },
    { id: "soc_7", titulo: "Influencer II", desc: "Recebeu 100 curtidas em seus posts.", cat: "Social", xp: 1000, target: 100, statKey: "likesReceived", iconName: "Star" },
    { id: "soc_8", titulo: "Viralizou!", desc: "Recebeu 500 curtidas totais.", cat: "Social", xp: 5000, target: 500, statKey: "likesReceived", iconName: "Flame" },
    { id: "soc_9", titulo: "Sentinela do Mar", desc: "Fez uma denúncia que foi aceita.", cat: "Social", xp: 200, target: 1, statKey: "validReports", iconName: "ShieldAlert" },
];