export type LeagueQuizQuestionKey =
  | "scenario"
  | "audience"
  | "system"
  | "style"
  | "impact";

export interface LeagueQuizProfile {
  nome: string;
  sigla?: string;
  aliases?: string[];
  keywords: string[];
  quizAnswers: Record<LeagueQuizQuestionKey, string[]>;
}

export const LEAGUE_QUIZ_PROFILES: LeagueQuizProfile[] = [
  {
    nome: "Liga Academica de Emergencia",
    sigla: "LAMEI",
    aliases: ["LAME", "emergencia", "urgencia"],
    keywords: ["emergencia", "urgencia", "trauma", "intensiva", "choque", "resgate"],
    quizAnswers: {
      scenario: ["Emergencia", "Centro Cirurgico"],
      audience: ["Graves", "Adultos"],
      system: [],
      style: ["Manual", "Raciocinio"],
      impact: ["Salvar vidas"],
    },
  },
  {
    nome: "Liga Academica de Cirurgia Geral",
    sigla: "LIAC",
    aliases: ["cirurgia geral"],
    keywords: ["cirurgia", "centro cirurgico", "manual", "trauma", "procedimento"],
    quizAnswers: {
      scenario: ["Centro Cirurgico"],
      audience: ["Adultos", "Graves"],
      system: [],
      style: ["Manual"],
      impact: ["Salvar vidas", "Detalhe"],
    },
  },
  {
    nome: "Liga Academica de Endocrinologia e Metabologia",
    sigla: "LAEM",
    aliases: ["endocrinologia", "metabologia"],
    keywords: ["endocrino", "hormonios", "metabolismo", "clinica", "consultorio"],
    quizAnswers: {
      scenario: ["Consultorio"],
      audience: ["Adultos"],
      system: ["Hormonios"],
      style: ["Raciocinio"],
      impact: ["Paciencia"],
    },
  },
  {
    nome: "Liga Academica de Ginecologia e Obstetricia",
    sigla: "LIAGO",
    aliases: ["ginecologia", "obstetricia", "saude da mulher"],
    keywords: ["gineco", "obstetricia", "mulheres", "familia", "prenatal"],
    quizAnswers: {
      scenario: ["Consultorio", "Comunidade"],
      audience: ["Mulheres"],
      system: ["Hormonios"],
      style: ["Raciocinio", "Prevencao"],
      impact: ["Vinculo", "Salvar vidas"],
    },
  },
  {
    nome: "Liga Academica de Medicina Legal de Caraguatatuba",
    sigla: "LAMELC",
    aliases: ["medicina legal", "forense"],
    keywords: ["legal", "forense", "pericia", "etica", "laudo"],
    quizAnswers: {
      scenario: ["Laboratorio"],
      audience: ["Adultos"],
      system: [],
      style: ["Gestao", "Raciocinio"],
      impact: ["Curiosidade"],
    },
  },
  {
    nome: "Liga Academica de Anatomia e Saude",
    sigla: "LAAS",
    aliases: ["anatomia"],
    keywords: ["anatomia", "disseccao", "morfologia", "saude", "estudo"],
    quizAnswers: {
      scenario: ["Laboratorio"],
      audience: ["Adultos"],
      system: ["Ossos"],
      style: ["Raciocinio"],
      impact: ["Curiosidade"],
    },
  },
  {
    nome: "Liga Academica de Clinica Medica",
    sigla: "LACM",
    aliases: ["clinica medica"],
    keywords: ["clinica", "raciocinio", "diagnostico", "consultorio", "enfermaria"],
    quizAnswers: {
      scenario: ["Consultorio"],
      audience: ["Adultos"],
      system: [],
      style: ["Raciocinio"],
      impact: ["Paciencia"],
    },
  },
  {
    nome: "Liga Academica de Psiquiatria",
    sigla: "LIAPS",
    aliases: ["psiquiatria", "saude mental"],
    keywords: ["psiquiatria", "saude mental", "escuta", "cerebro", "acolhimento"],
    quizAnswers: {
      scenario: ["Consultorio", "Comunidade"],
      audience: ["Adultos"],
      system: ["Cerebro"],
      style: ["Raciocinio"],
      impact: ["Paciencia", "Vinculo"],
    },
  },
  {
    nome: "Liga Academica de Ortopedia e Medicina Esportiva",
    sigla: "LAOME",
    aliases: ["ortopedia", "medicina esportiva"],
    keywords: ["ortopedia", "atletas", "esportiva", "ossos", "trauma"],
    quizAnswers: {
      scenario: ["Centro Cirurgico"],
      audience: ["Atletas", "Adultos"],
      system: ["Ossos"],
      style: ["Manual"],
      impact: ["Salvar vidas", "Detalhe"],
    },
  },
  {
    nome: "Liga Academica de Oncologia",
    sigla: "LAONC",
    aliases: ["oncologia"],
    keywords: ["oncologia", "cancer", "cuidado", "adultos", "seguimento"],
    quizAnswers: {
      scenario: ["Consultorio"],
      audience: ["Adultos"],
      system: [],
      style: ["Raciocinio"],
      impact: ["Paciencia", "Vinculo"],
    },
  },
  {
    nome: "Liga Academica de Humanidades e Saude",
    sigla: "LAHS",
    aliases: ["humanidades", "saude coletiva"],
    keywords: ["humanidades", "comunidade", "escuta", "prevencao", "social"],
    quizAnswers: {
      scenario: ["Comunidade"],
      audience: ["Adultos"],
      system: [],
      style: ["Prevencao", "Gestao"],
      impact: ["Vinculo"],
    },
  },
  {
    nome: "Liga Academica de Dermatologia",
    sigla: "LADERM",
    aliases: ["dermatologia", "pele"],
    keywords: ["dermatologia", "pele", "consultorio", "detalhe", "lesao"],
    quizAnswers: {
      scenario: ["Consultorio"],
      audience: ["Adultos"],
      system: [],
      style: ["Raciocinio"],
      impact: ["Detalhe"],
    },
  },
  {
    nome: "Liga Academica de Neonatologia e Pediatria",
    sigla: "LANPED",
    aliases: ["neonatologia", "pediatria"],
    keywords: ["neonatologia", "pediatria", "criancas", "familia", "acolhimento"],
    quizAnswers: {
      scenario: ["Comunidade", "Consultorio"],
      audience: ["Criancas"],
      system: [],
      style: ["Prevencao", "Raciocinio"],
      impact: ["Vinculo", "Salvar vidas"],
    },
  },
  {
    nome: "Liga Academica de Urologia",
    sigla: "LIU",
    aliases: ["urologia"],
    keywords: ["urologia", "nefro", "rins", "consultorio", "cirurgia"],
    quizAnswers: {
      scenario: ["Consultorio"],
      audience: ["Adultos"],
      system: ["Rins"],
      style: ["Raciocinio", "Manual"],
      impact: ["Detalhe"],
    },
  },
  {
    nome: "Liga de Neurologia e Neurocirurgia",
    sigla: "LANN",
    aliases: ["neurologia", "neurocirurgia"],
    keywords: ["neurologia", "neurocirurgia", "cerebro", "neuro", "cirurgia"],
    quizAnswers: {
      scenario: ["Centro Cirurgico", "Consultorio"],
      audience: ["Adultos", "Graves"],
      system: ["Cerebro"],
      style: ["Raciocinio", "Manual"],
      impact: ["Detalhe", "Salvar vidas"],
    },
  },
  {
    nome: "Liga Academica de Oftalmologia",
    sigla: "LAOFT",
    aliases: ["oftalmologia", "oftalmo"],
    keywords: ["oftalmologia", "oftalmo", "visao", "detalhe", "cirurgia"],
    quizAnswers: {
      scenario: ["Consultorio", "Centro Cirurgico"],
      audience: ["Adultos"],
      system: [],
      style: ["Raciocinio", "Manual"],
      impact: ["Detalhe"],
    },
  },
  {
    nome: "Liga Academica de Cardiologia",
    sigla: "LACARDIO",
    aliases: ["cardiologia"],
    keywords: ["cardiologia", "cardio", "coracao", "ecg", "hemodinamica"],
    quizAnswers: {
      scenario: ["Consultorio"],
      audience: ["Adultos"],
      system: ["Coracao"],
      style: ["Raciocinio", "Tecnologia"],
      impact: ["Salvar vidas"],
    },
  },
  {
    nome: "Liga da Saude da Familia",
    aliases: ["saude da familia", "medicina de familia", "familia"],
    keywords: ["familia", "comunidade", "prevencao", "territorio", "vinculo"],
    quizAnswers: {
      scenario: ["Comunidade"],
      audience: ["Criancas", "Adultos", "Mulheres"],
      system: [],
      style: ["Prevencao"],
      impact: ["Vinculo"],
    },
  },
  {
    nome: "Liga Academica de Otorrinolaringologia",
    sigla: "LAORL",
    aliases: ["otorrinolaringologia", "otorrino"],
    keywords: ["otorrino", "vias aereas", "ouvido", "garganta", "cirurgia"],
    quizAnswers: {
      scenario: ["Consultorio", "Centro Cirurgico"],
      audience: ["Adultos"],
      system: [],
      style: ["Raciocinio", "Manual"],
      impact: ["Detalhe"],
    },
  },
  {
    nome: "Liga Academica de Gastroenterologia e Cirurgia Digestiva",
    sigla: "LAGAC",
    aliases: ["gastroenterologia", "cirurgia digestiva", "gastro"],
    keywords: ["gastro", "digestiva", "aparelho digestivo", "endoscopia", "cirurgia"],
    quizAnswers: {
      scenario: ["Consultorio", "Centro Cirurgico"],
      audience: ["Adultos"],
      system: ["Hormonios"],
      style: ["Raciocinio", "Manual"],
      impact: ["Detalhe"],
    },
  },
  {
    nome: "Liga Academica de Cardiologia e Cirurgia Cardiovascular",
    sigla: "LAC",
    aliases: ["cirurgia cardiovascular", "cardiovascular"],
    keywords: ["cardiovascular", "coracao", "cirurgia", "tecnologia", "manual"],
    quizAnswers: {
      scenario: ["Centro Cirurgico"],
      audience: ["Adultos", "Graves"],
      system: ["Coracao"],
      style: ["Manual", "Tecnologia"],
      impact: ["Salvar vidas", "Detalhe"],
    },
  },
  {
    nome: "Liga Academica de Medicina Militar",
    sigla: "LAMM",
    aliases: ["medicina militar"],
    keywords: ["militar", "urgencia", "estrategia", "trauma", "resgate"],
    quizAnswers: {
      scenario: ["Emergencia"],
      audience: ["Graves", "Adultos"],
      system: [],
      style: ["Gestao", "Manual"],
      impact: ["Salvar vidas"],
    },
  },
  {
    nome: "Liga de Simulacao Realistica",
    sigla: "LASIR",
    aliases: ["simulacao realistica", "simulacao"],
    keywords: ["simulacao", "realistica", "treinamento", "cenario", "procedimento"],
    quizAnswers: {
      scenario: ["Laboratorio", "Emergencia"],
      audience: ["Graves", "Adultos"],
      system: [],
      style: ["Tecnologia", "Manual"],
      impact: ["Curiosidade", "Salvar vidas"],
    },
  },
  {
    nome: "Liga Academica de Laparoscopia e Robotica",
    sigla: "LALR",
    aliases: ["laparoscopia", "robotica"],
    keywords: ["laparoscopia", "robotica", "cirurgia", "tecnologia", "minimamente invasiva"],
    quizAnswers: {
      scenario: ["Centro Cirurgico"],
      audience: ["Adultos"],
      system: [],
      style: ["Manual", "Tecnologia"],
      impact: ["Detalhe"],
    },
  },
];
