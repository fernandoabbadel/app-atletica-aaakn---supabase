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
    iconEmoji?: string;
}

export const ACHIEVEMENTS_CATALOG: Achievement[] = [
    // =================================================================
    // 1. GERAL (ACESSO & FIDELIDADE)
    // =================================================================
    { id: "acc_1", titulo: "Recruta", desc: "Logou 5 vezes no aplicativo.", cat: "Geral", xp: 50, target: 5, statKey: "loginCount", iconName: "Fish", iconEmoji: "🐟" },
    { id: "soc_1", titulo: "Primeiro Mergulho", desc: "Criou sua conta no cardume.", cat: "Geral", xp: 50, target: 1, statKey: "accountCreated", iconName: "UserPlus", iconEmoji: "🌊" },
    { id: "acc_2", titulo: "Veterano", desc: "Logou 100 vezes no aplicativo.", cat: "Geral", xp: 1000, target: 100, statKey: "loginCount", iconName: "Medal", iconEmoji: "🏅" },
    { id: "acc_3", titulo: "Ritmo Firme", desc: "Manteve 5 dias de login seguidos.", cat: "Geral", xp: 200, target: 5, statKey: "loginStreak", iconName: "Zap", iconEmoji: "⚡" },
    { id: "acc_4", titulo: "Viciado em Resenha", desc: "Manteve 30 dias de login seguidos.", cat: "Geral", xp: 2000, target: 30, statKey: "loginStreak", iconName: "Zap", iconEmoji: "🔥" },
    { id: "acc_5", titulo: "Inabalavel", desc: "Manteve 100 dias de login seguidos.", cat: "Geral", xp: 10000, target: 100, statKey: "loginStreak", iconName: "Crown", iconEmoji: "👑" },
    { id: "acc_6", titulo: "Perfil Completo", desc: "Preencheu todos os dados do cadastro.", cat: "Geral", xp: 300, target: 1, statKey: "profileComplete", iconName: "CheckCircle2", iconEmoji: "✅" },

    // =================================================================
    // 2. GAMES (ARENA)
    // =================================================================
    { id: "game_3", titulo: "Primeiro GG", desc: "Venceu sua primeira partida.", cat: "Games", xp: 100, target: 1, statKey: "arenaWins", iconName: "Trophy", iconEmoji: "🏆" },
    { id: "game_1", titulo: "Player 1", desc: "Participou de 1 partida na Arena.", cat: "Games", xp: 50, target: 1, statKey: "arenaMatches", iconName: "Gamepad2", iconEmoji: "🎮" },
    { id: "game_2", titulo: "Competitivo", desc: "Participou de 20 partidas na Arena.", cat: "Games", xp: 500, target: 20, statKey: "arenaMatches", iconName: "Swords", iconEmoji: "⚔️" },
    { id: "game_4", titulo: "Carrasco", desc: "Venceu 15 partidas na Arena.", cat: "Games", xp: 1500, target: 15, statKey: "arenaWins", iconName: "Skull", iconEmoji: "💀" },
    { id: "game_5", titulo: "Lenda da Arena", desc: "Venceu 50 partidas na Arena.", cat: "Games", xp: 8000, target: 50, statKey: "arenaWins", iconName: "Crown", iconEmoji: "👑" },
    { id: "game_6", titulo: "Saco de Pancada", desc: "Perdeu 5 partidas seguidas.", cat: "Games", xp: 50, target: 5, statKey: "arenaLossStreak", iconName: "Ghost", iconEmoji: "👻" },
    { id: "game_7", titulo: "MVP AAAKN", desc: "Ganhou um torneio oficial da Arena.", cat: "Games", xp: 5000, target: 1, statKey: "arenaTournamentsWon", iconName: "Star", iconEmoji: "⭐" },

    // =================================================================
    // 3. GYM RATS (TREINOS)
    // =================================================================
    { id: "gym_1", titulo: "Primeiro Treino", desc: "Confirmou presenca em 1 treino.", cat: "Gym", xp: 100, target: 1, statKey: "gymCheckins", iconName: "Activity", iconEmoji: "🏋️" },
    { id: "gym_2", titulo: "Em Evolucao", desc: "Confirmou presenca em 10 treinos.", cat: "Gym", xp: 400, target: 10, statKey: "gymCheckins", iconName: "Dumbbell", iconEmoji: "💪" },
    { id: "gym_3", titulo: "Rato de Academia", desc: "Confirmou presenca em 50 treinos.", cat: "Gym", xp: 2000, target: 50, statKey: "gymCheckins", iconName: "Dumbbell", iconEmoji: "🏋️‍♂️" },
    { id: "gym_4", titulo: "Monstro da Jaula", desc: "Confirmou presenca em 150 treinos.", cat: "Gym", xp: 7000, target: 150, statKey: "gymCheckins", iconName: "Beiceps", iconEmoji: "🦾" },
    { id: "gym_5", titulo: "Madrugador", desc: "Treino confirmado antes das 06:30.", cat: "Gym", xp: 500, target: 1, statKey: "gymEarlyBird", iconName: "Timer", iconEmoji: "⏰" },
    { id: "gym_6", titulo: "Foco Total", desc: "Manteve 10 dias seguidos de treino.", cat: "Gym", xp: 1500, target: 10, statKey: "gymStreak", iconName: "Target", iconEmoji: "🎯" },
    { id: "gym_7", titulo: "Shape Inexplicavel", desc: "Alcancou o nivel maximo de treinos no semestre.", cat: "Gym", xp: 5000, target: 80, statKey: "gymSemesterTotal", iconName: "Trophy", iconEmoji: "🏆" },

    // =================================================================
    // 4. EVENTOS & LIGAS
    // =================================================================
    { id: "evt_1", titulo: "Primeiro Role", desc: "Teve o primeiro ingresso de evento aprovado.", cat: "Eventos", xp: 100, target: 1, statKey: "eventsBought", iconName: "Ticket", iconEmoji: "🎟️" },
    { id: "evt_2", titulo: "Rolezeiro", desc: "Teve 5 ingressos de eventos aprovados.", cat: "Eventos", xp: 500, target: 5, statKey: "eventsBought", iconName: "PartyPopper", iconEmoji: "🪩" },
    { id: "evt_3", titulo: "Inimigo do Fim", desc: "Teve 10 ingressos de eventos aprovados.", cat: "Eventos", xp: 1200, target: 10, statKey: "eventsBought", iconName: "Flame", iconEmoji: "🔥" },
    { id: "evt_4", titulo: "Tubarao de Elite", desc: "Teve 20 ingressos de eventos aprovados.", cat: "Eventos", xp: 5000, target: 20, statKey: "eventsBought", iconName: "Crown", iconEmoji: "👑" },
    { id: "evt_5", titulo: "Comissario", desc: "Vendeu 10 ingressos via codigo.", cat: "Eventos", xp: 2000, target: 10, statKey: "ticketSales", iconName: "Briefcase", iconEmoji: "💼" },
    { id: "evt_6", titulo: "VIP", desc: "Comprou 3 ingressos de lote promocional.", cat: "Eventos", xp: 500, target: 3, statKey: "promoTicketsBought", iconName: "Gem", iconEmoji: "💎" },
    { id: "evt_7", titulo: "Nerd da Turma", desc: "Participou de 2 eventos academicos.", cat: "Eventos", xp: 400, target: 2, statKey: "academicEvents", iconName: "GraduationCap", iconEmoji: "🧠" },
    { id: "evt_8", titulo: "Coracao de Ouro", desc: "Participou de uma acao social da Atletica.", cat: "Eventos", xp: 2000, target: 1, statKey: "socialActions", iconName: "HeartHandshake", iconEmoji: "🤝" },
    { id: "evt_9", titulo: "Calouro das Ligas", desc: "Completou 1 quiz de compatibilidade das ligas.", cat: "Eventos", xp: 250, target: 1, statKey: "leagueQuizRuns", iconName: "BookOpen", iconEmoji: "🎓" },
    { id: "evt_10", titulo: "Oraculo das Ligas", desc: "Completou 5 quizzes de compatibilidade das ligas.", cat: "Eventos", xp: 1200, target: 5, statKey: "leagueQuizRuns", iconName: "Trophy", iconEmoji: "🔮" },
    { id: "evt_11", titulo: "Fa da Diretoria", desc: "Curtiu 5 ligas oficiais.", cat: "Eventos", xp: 400, target: 5, statKey: "leagueLikesGiven", iconName: "Heart", iconEmoji: "🏛️" },

    // =================================================================
    // 5. LOJA (FINANCEIRO)
    // =================================================================
    { id: "shop_1", titulo: "Apoiador", desc: "Realizou sua primeira compra na loja.", cat: "Loja", xp: 500, target: 1, statKey: "storeOrders", iconName: "ShoppingBag", iconEmoji: "🛍️" },
    { id: "shop_2", titulo: "Investidor I", desc: "Gastou R$ 200,00 totais na loja.", cat: "Loja", xp: 500, target: 200, statKey: "moneySpent", iconName: "DollarSign", iconEmoji: "💸" },
    { id: "shop_3", titulo: "Investidor II", desc: "Gastou R$ 1.000,00 totais na loja.", cat: "Loja", xp: 3000, target: 1000, statKey: "moneySpent", iconName: "Wallet", iconEmoji: "💰" },
    { id: "shop_4", titulo: "Baleia Branca", desc: "Gastou R$ 5.000,00 totais na loja.", cat: "Loja", xp: 16000, target: 5000, statKey: "moneySpent", iconName: "Diamond", iconEmoji: "🐋" },
    { id: "shop_5", titulo: "Colecionador", desc: "Comprou 10 produtos diferentes.", cat: "Loja", xp: 1000, target: 10, statKey: "uniqueProductsBought", iconName: "LayoutGrid", iconEmoji: "🧩" },
    { id: "shop_6", titulo: "Socio Elite", desc: "Assinou o plano semestral.", cat: "Loja", xp: 5000, target: 1, statKey: "semesterPlanActive", iconName: "ShieldAlert", iconEmoji: "🦈" },

    // =================================================================
    // 6. SOCIAL (COMUNIDADE)
    // =================================================================
    { id: "soc_10", titulo: "Convocador", desc: "Teve 5 convites ativados na atlética.", cat: "Social", xp: 250, target: 5, statKey: "inviteActivations", iconName: "UserPlus", iconEmoji: "📨" },
    { id: "soc_11", titulo: "Puxador de Cardume", desc: "Teve 10 convites ativados na atlética.", cat: "Social", xp: 600, target: 10, statKey: "inviteActivations", iconName: "UserPlus", iconEmoji: "🦈" },
    { id: "soc_12", titulo: "Embaixador", desc: "Teve 50 convites ativados na atlética.", cat: "Social", xp: 3000, target: 50, statKey: "inviteActivations", iconName: "Crown", iconEmoji: "🏛️" },
    { id: "soc_13", titulo: "Lenda do Recrutamento", desc: "Teve 100 convites ativados na atlética.", cat: "Social", xp: 8000, target: 100, statKey: "inviteActivations", iconName: "Star", iconEmoji: "🚀" },
    { id: "soc_2", titulo: "Tubarao Social", desc: "Fez 5 posts na comunidade.", cat: "Social", xp: 100, target: 5, statKey: "postsCount", iconName: "Megaphone", iconEmoji: "📣" },
    { id: "soc_3", titulo: "A Voz do Oceano", desc: "Fez 50 posts na comunidade.", cat: "Social", xp: 1000, target: 50, statKey: "postsCount", iconName: "Megaphone", iconEmoji: "🌊" },
    { id: "soc_4", titulo: "Tagarela", desc: "Comentou em 20 publicacoes.", cat: "Social", xp: 150, target: 20, statKey: "commentsCount", iconName: "MessageCircle", iconEmoji: "💬" },
    { id: "soc_5", titulo: "Debatedor Senior", desc: "Comentou em 100 publicacoes.", cat: "Social", xp: 800, target: 100, statKey: "commentsCount", iconName: "MessageCircle", iconEmoji: "🗣️" },
    { id: "soc_6", titulo: "Influencer I", desc: "Recebeu 10 curtidas em seus posts.", cat: "Social", xp: 100, target: 10, statKey: "likesReceived", iconName: "Heart", iconEmoji: "❤️" },
    { id: "soc_7", titulo: "Influencer II", desc: "Recebeu 100 curtidas em seus posts.", cat: "Social", xp: 1000, target: 100, statKey: "likesReceived", iconName: "Star", iconEmoji: "⭐" },
    { id: "soc_8", titulo: "Viralizou!", desc: "Recebeu 500 curtidas totais.", cat: "Social", xp: 5000, target: 500, statKey: "likesReceived", iconName: "Flame", iconEmoji: "🚀" },
    { id: "soc_9", titulo: "Sentinela do Mar", desc: "Fez uma denuncia que foi aceita.", cat: "Social", xp: 200, target: 1, statKey: "validReports", iconName: "ShieldAlert", iconEmoji: "🛡️" },
];
