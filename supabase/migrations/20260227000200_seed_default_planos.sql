-- Planos: restauracao do catalogo base (idempotente)
-- Nao remove planos existentes; apenas garante os 4 planos padrao por id.

insert into public.planos (
  id,
  nome,
  preco,
  "precoVal",
  parcelamento,
  descricao,
  cor,
  icon,
  destaque,
  beneficios,
  "xpMultiplier",
  "nivelPrioridade",
  "descontoLoja",
  "updatedAt"
)
values
  (
    'bicho_solto',
    'Bicho Solto',
    '0,00',
    0,
    'Acesso gratuito',
    'Entrada no ecossistema AAAKN',
    'zinc',
    'ghost',
    false,
    array[
      'Acesso ao app e carteira digital',
      'Participacao em eventos abertos',
      'Ranking e funcionalidades basicas'
    ]::text[],
    1,
    1,
    0,
    now()
  ),
  (
    'cardume_livre',
    'Cardume Livre',
    '14,90',
    14.9,
    'ou 12x de R$ 1,49',
    'Primeiro nivel premium',
    'blue',
    'fish',
    false,
    array[
      'Desconto em parceiros selecionados',
      'Prioridade moderada em lotes',
      'Acesso a conteudos exclusivos'
    ]::text[],
    1.1,
    2,
    5,
    now()
  ),
  (
    'atleta',
    'Atleta',
    '29,90',
    29.9,
    'ou 12x de R$ 2,99',
    'Plano oficial do atleta',
    'emerald',
    'star',
    true,
    array[
      'Prioridade em eventos e inscricoes',
      'Desconto ampliado na loja',
      'Multiplicador de XP turbinado'
    ]::text[],
    1.25,
    3,
    10,
    now()
  ),
  (
    'lenda',
    'Lenda',
    '59,90',
    59.9,
    'ou 12x de R$ 5,99',
    'Maximo nivel de beneficios',
    'yellow',
    'crown',
    true,
    array[
      'Prioridade maxima no ecossistema',
      'Maior desconto na loja',
      'Beneficios VIP em acoes especiais'
    ]::text[],
    1.5,
    4,
    20,
    now()
  )
on conflict (id)
do update set
  nome = excluded.nome,
  preco = excluded.preco,
  "precoVal" = excluded."precoVal",
  parcelamento = excluded.parcelamento,
  descricao = excluded.descricao,
  cor = excluded.cor,
  icon = excluded.icon,
  destaque = excluded.destaque,
  beneficios = excluded.beneficios,
  "xpMultiplier" = excluded."xpMultiplier",
  "nivelPrioridade" = excluded."nivelPrioridade",
  "descontoLoja" = excluded."descontoLoja",
  "updatedAt" = now();