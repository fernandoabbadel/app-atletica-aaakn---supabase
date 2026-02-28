export interface LeagueQuizProfile {
  nome: string;
  sigla?: string;
  aliases?: string[];
  keywords: string[];
}

export const LEAGUE_QUIZ_PROFILES: LeagueQuizProfile[] = [
  {
    nome: "Liga Acadêmica de Endocrinologia e Metabologia",
    sigla: "LAEM",
    aliases: ["endocrinologia", "metabologia"],
    keywords: ["endocrino", "hormonios", "metabolismo", "clinica", "consultorio"],
  },
  {
    nome: "Liga Acadêmica de Ginecologia e Obstetrícia",
    sigla: "LIAGO",
    aliases: ["ginecologia", "obstetricia", "saude da mulher"],
    keywords: ["gineco", "obstetricia", "mulheres", "familia", "consultorio"],
  },
  {
    nome: "Liga Acadêmica de Medicina Legal de Caraguatatuba",
    sigla: "LAMELC",
    aliases: ["medicina legal", "forense"],
    keywords: ["legal", "pericia", "etica", "gestao", "raciocinio"],
  },
  {
    nome: "Liga Acadêmica de Anatomia e Saúde",
    sigla: "LAAS",
    aliases: ["anatomia"],
    keywords: ["anatomia", "saude", "curiosidade", "laboratorio"],
  },
  {
    nome: "Liga Acadêmica de Clínica Médica",
    sigla: "LACM",
    aliases: ["clinica medica"],
    keywords: ["clinica", "adultos", "raciocinio", "diagnostico", "consultorio"],
  },
  {
    nome: "Liga Acadêmica de Cirurgia Geral",
    sigla: "LIAC",
    aliases: ["cirurgia geral"],
    keywords: ["cirurgia", "manual", "centro cirurgico", "trauma"],
  },
  {
    nome: "Liga Acadêmica de Psiquiatria",
    sigla: "LIAPS",
    aliases: ["psiquiatria", "saude mental"],
    keywords: ["psiquiatria", "cerebro", "paciencia", "vinculo"],
  },
  {
    nome: "Liga Acadêmica de Ortopedia e Medicina Esportiva",
    sigla: "LAOME",
    aliases: ["ortopedia", "medicina esportiva"],
    keywords: ["ortopedia", "atletas", "esportiva", "ossos", "trauma"],
  },
  {
    nome: "Liga Acadêmica de Oncologia",
    sigla: "LAONC",
    aliases: ["oncologia"],
    keywords: ["onco", "oncologia", "cancer", "vinculo", "adultos"],
  },
  {
    nome: "Liga Acadêmica de Humanidades e Saúde",
    sigla: "LAHS",
    aliases: ["humanidades"],
    keywords: ["humanidades", "comunidade", "familia", "prevencao", "vinculo"],
  },
  {
    nome: "Liga Acadêmica de Dermatologia",
    sigla: "LADERM",
    aliases: ["dermatologia", "pele"],
    keywords: ["dermato", "consultorio", "detalhe", "clinica"],
  },
  {
    nome: "Liga Acadêmica de Neonatologia e Pediatria",
    sigla: "LANPED",
    aliases: ["neonatologia", "pediatria"],
    keywords: ["neonatologia", "pediatria", "criancas", "familia"],
  },
  {
    nome: "Liga Acadêmica de Urologia",
    sigla: "LIU",
    aliases: ["urologia"],
    keywords: ["urologia", "rins", "nefro", "adultos", "consultorio"],
  },
  {
    nome: "Liga Acadêmica de Emergência",
    sigla: "LAME",
    aliases: ["emergencia", "urgencia"],
    keywords: ["emergencia", "urgencia", "intensiva", "trauma", "salvar vidas"],
  },
  {
    nome: "Liga de Neurologia e Neurocirurgia",
    sigla: "LANN",
    aliases: ["neurologia", "neurocirurgia"],
    keywords: ["neuro", "cerebro", "neurocirurgia", "cirurgia", "raciocinio"],
  },
  {
    nome: "Liga Acadêmica de Oftalmologia",
    sigla: "LAOFT",
    aliases: ["oftalmologia", "oftalmo"],
    keywords: ["oftalmo", "detalhe", "consultorio", "cirurgia"],
  },
  {
    nome: "Liga Acadêmica de Cardiologia",
    sigla: "LACARDIO",
    aliases: ["cardiologia"],
    keywords: ["cardio", "coracao", "clinica", "tecnologia", "adultos"],
  },
  {
    nome: "Liga da Saúde da Família",
    aliases: ["saude da familia", "medicina de familia"],
    keywords: ["familia", "comunidade", "prevencao", "vinculo", "pediatria"],
  },
  {
    nome: "Liga Acadêmica de Otorrinolaringologia",
    sigla: "LAORL",
    aliases: ["otorrinolaringologia", "otorrino"],
    keywords: ["otorrino", "consultorio", "cirurgia", "detalhe"],
  },
  {
    nome: "Liga Acadêmica de Medicina Militar",
    sigla: "LAMM",
    aliases: ["medicina militar"],
    keywords: ["militar", "emergencia", "trauma", "gestao", "urgencia"],
  },
  {
    nome: "Liga Acadêmica de Laparoscopia e Robótica",
    aliases: ["laparoscopia", "robotica"],
    keywords: ["laparoscopia", "robotica", "cirurgia", "tecnologia", "manual"],
  },
  {
    nome: "Liga Acadêmica de Cardiologia e Cirurgia Cardiovascular",
    sigla: "LAC",
    aliases: ["cirurgia cardiovascular", "cardiovascular"],
    keywords: ["cardio", "coracao", "cirurgia", "tecnologia", "manual"],
  },
];
