-- ============================================================
-- Roteiro de conferência da migração 066 (F2-G — taxas comprometidas)
--
-- Roda no Postgres descartável via:
--   node tools/replica-local/rodar-066-pglite.mjs
-- Antes da 066, a primeira asserção falha: a taxa com saldo positivo
-- está livre. O runner valida esse motivo.
--
-- Depende do stub sintético:
--   tools/replica-local/sintetico/stub-066.sql
--
-- Identidade usada: a1 = admin ('Victor').
-- ============================================================
\set ON_ERROR_STOP on

create or replace function pg_temp.ok066(p boolean, p_motivo text) returns void language plpgsql as $$
begin
  if p is distinct from true then
    raise exception '066 FALHOU: %', p_motivo;
  end if;
end $$;

create or replace function pg_temp.num066(p numeric) returns numeric language sql immutable as $$
  select round(coalesce(p, 0), 2)
$$;

create or replace function pg_temp.rubrica066(p_sl jsonb, p_code text) returns jsonb
language sql immutable as $$
  select value
    from jsonb_array_elements(coalesce(p_sl -> 'rubricas', '[]'::jsonb))
   where value ->> 'rubrica_code' = p_code
   limit 1
$$;

create or replace function pg_temp.grupo066(p_sl jsonb, p_code text) returns jsonb
language sql immutable as $$
  select value
    from jsonb_array_elements(coalesce(p_sl -> 'grupos', '[]'::jsonb))
   where value ->> 'grupo_code' = p_code
   limit 1
$$;

create or replace function pg_temp.no066(p_no jsonb, p_chave text) returns jsonb
language plpgsql immutable as $$
declare
  v_filho jsonb;
  v_achado jsonb;
begin
  if p_no is null or jsonb_typeof(p_no) <> 'object' then
    return null;
  end if;
  if p_no ->> 'chave' = p_chave then
    return p_no;
  end if;
  for v_filho in select value from jsonb_array_elements(coalesce(p_no -> 'partes', '[]'::jsonb)) loop
    v_achado := pg_temp.no066(v_filho, p_chave);
    if v_achado is not null then
      return v_achado;
    end if;
  end loop;
  return null;
end $$;

create or replace function pg_temp.arvore066(p_no jsonb, p_raiz boolean default true) returns void
language plpgsql immutable as $$
declare
  v_tipo  text := p_no ->> 'tipo';
  v_chave text := coalesce(p_no ->> 'chave', '<sem-chave>');
  v_valor numeric;
  v_soma  numeric;
  v_filho jsonb;
begin
  if p_no is null or jsonb_typeof(p_no) <> 'object' then
    raise exception '066 FALHOU: nó inválido na árvore: %', p_no;
  end if;

  -- Raiz sem valor é o retorno dos centros sem plano/sem balancete.
  if jsonb_typeof(p_no -> 'valor') <> 'number' then
    if p_raiz and jsonb_array_length(coalesce(p_no -> 'partes', '[]'::jsonb)) = 0 then
      return;
    end if;
    raise exception '066 FALHOU: nó % com valor não numérico', v_chave;
  end if;
  v_valor := (p_no ->> 'valor')::numeric;

  if v_tipo not in ('calculo', 'documento', 'legado', 'digitado') then
    raise exception '066 FALHOU: tipo inválido % no nó %', v_tipo, v_chave;
  end if;
  if (p_no ->> 'sinal')::integer not in (1, -1) then
    raise exception '066 FALHOU: sinal inválido % no nó %', p_no ->> 'sinal', v_chave;
  end if;

  if v_tipo = 'calculo' then
    if jsonb_typeof(p_no -> 'partes') <> 'array' or jsonb_array_length(p_no -> 'partes') = 0 then
      raise exception '066 FALHOU: nó de cálculo % sem partes', v_chave;
    end if;

    select coalesce(sum((f ->> 'sinal')::numeric * (f ->> 'valor')::numeric), 0)
      into v_soma
      from jsonb_array_elements(p_no -> 'partes') as f;

    if pg_temp.num066(v_soma) is distinct from pg_temp.num066(v_valor) then
      raise exception '066 FALHOU: nó % não fecha (valor %, soma dos filhos %)', v_chave, v_valor, v_soma;
    end if;

    for v_filho in select value from jsonb_array_elements(p_no -> 'partes') loop
      perform pg_temp.arvore066(v_filho, false);
    end loop;
  else
    if jsonb_array_length(coalesce(p_no -> 'partes', '[]'::jsonb)) <> 0 then
      raise exception '066 FALHOU: folha % deve ter partes vazio', v_chave;
    end if;
  end if;
end $$;

begin;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);

do $$
begin
  if not exists (select 1 from public.projects where code = '66.TAXA') then
    raise exception '066 FALHOU: stub ausente; carregue tools/replica-local/sintetico/stub-066.sql antes do roteiro.';
  end if;
end $$;

-- ------------------------------------------------------------
-- BLOCO 1 — get_saldo_livre: taxa positiva vira compromisso,
-- estourada continua negativa, rubrica comum não muda.
-- ------------------------------------------------------------
do $$
declare
  v_id   uuid := (select id from public.projects where code = '66.TAXA');
  r      jsonb := public.get_saldo_livre(v_id);
  rub    jsonb;
  g      jsonb;
  v_soma numeric;
begin
  perform pg_temp.ok066(coalesce((r ->> 'has_plano')::boolean, false), '66.TAXA deveria ter plano');
  perform pg_temp.ok066(coalesce((r ->> 'has_balancete')::boolean, false), '66.TAXA deveria ter balancete');

  rub := pg_temp.rubrica066(r, 'cip_ufg');
  perform pg_temp.ok066(
    pg_temp.num066((rub ->> 'compromissos')::numeric) = 15000,
    format('taxa com saldo positivo deveria virar comprometido (esperado 15000, veio %s)', rub ->> 'compromissos')
  );
  perform pg_temp.ok066(pg_temp.num066((rub ->> 'saldo_livre')::numeric) = 0,
    format('cip_ufg deveria ter livre 0, veio %s', rub ->> 'saldo_livre'));
  perform pg_temp.ok066(rub ->> 'compromisso_tipo' = 'taxa', 'cip_ufg deveria ser compromisso_tipo=taxa');

  rub := pg_temp.rubrica066(r, 'cip_ua');
  perform pg_temp.ok066(pg_temp.num066((rub ->> 'compromissos')::numeric) = 0,
    format('taxa estourada não deveria ter compromisso, veio %s', rub ->> 'compromissos'));
  perform pg_temp.ok066(pg_temp.num066((rub ->> 'saldo_livre')::numeric) = -2000,
    format('taxa estourada deveria ter livre -2000, veio %s', rub ->> 'saldo_livre'));
  perform pg_temp.ok066(rub ->> 'compromisso_tipo' = 'taxa', 'cip_ua deveria ser compromisso_tipo=taxa');

  rub := pg_temp.rubrica066(r, 'dao');
  perform pg_temp.ok066(pg_temp.num066((rub ->> 'compromissos')::numeric) = 20000,
    format('dao sem realizado deveria comprometer o previsto inteiro, veio %s', rub ->> 'compromissos'));
  perform pg_temp.ok066(pg_temp.num066((rub ->> 'saldo_livre')::numeric) = 0,
    format('dao deveria ter livre 0, veio %s', rub ->> 'saldo_livre'));

  rub := pg_temp.rubrica066(r, 'b');
  perform pg_temp.ok066(pg_temp.num066((rub ->> 'compromissos')::numeric) = 0, 'rubrica comum não deve ter compromisso');
  perform pg_temp.ok066(pg_temp.num066((rub ->> 'saldo_livre')::numeric) = 40000, 'rubrica comum deve manter previsto − realizado');
  perform pg_temp.ok066(rub -> 'compromisso_tipo' = 'null'::jsonb, 'rubrica comum deve ter compromisso_tipo null');

  g := pg_temp.grupo066(r, 'cip_ufg');
  perform pg_temp.ok066(g ->> 'compromissos_cobertura' = 'taxas', 'grupo só de taxa deveria ser cobertura=taxas');
  perform pg_temp.ok066(pg_temp.num066((g ->> 'compromissos')::numeric) = 15000, 'grupo cip_ufg deveria comprometer 15000');
  perform pg_temp.ok066(pg_temp.num066((g ->> 'saldo_livre')::numeric) = 0, 'grupo cip_ufg deveria ter livre 0');

  g := pg_temp.grupo066(r, 'cip_ua');
  perform pg_temp.ok066(g ->> 'compromissos_cobertura' = 'taxas', 'grupo estourado continua sendo de taxa');
  perform pg_temp.ok066(pg_temp.num066((g ->> 'saldo_livre')::numeric) = -2000, 'grupo cip_ua deveria ter livre -2000');

  g := pg_temp.grupo066(r, 'b');
  perform pg_temp.ok066(g ->> 'compromissos_cobertura' = 'nenhuma', 'grupo comum deveria ser cobertura=nenhuma');

  select sum((x ->> 'saldo_livre')::numeric)
    into v_soma
    from jsonb_array_elements(r -> 'grupos') x;
  perform pg_temp.ok066(pg_temp.num066(v_soma) = 38000,
    format('soma dos grupos deveria ser 38000, veio %s', v_soma));
end $$;

-- ------------------------------------------------------------
-- BLOCO 2 — explicar_livre_v2: fecha e mostra o comprometido da taxa
-- ------------------------------------------------------------
do $$
declare
  v_id uuid := (select id from public.projects where code = '66.TAXA');
  ex   jsonb := public.explicar_livre_v2(v_id);
  g    jsonb;
  no   jsonb;
  v_soma numeric;
begin
  perform pg_temp.arvore066(ex);
  perform pg_temp.ok066(pg_temp.num066((ex ->> 'valor')::numeric) = 38000,
    format('raiz deveria ser 38000, veio %s', ex ->> 'valor'));

  g := pg_temp.no066(ex, 'grupo:cip_ufg');
  perform pg_temp.ok066(g is not null, 'árvore deveria ter grupo:cip_ufg');
  perform pg_temp.ok066(pg_temp.num066((g ->> 'valor')::numeric) = 0, 'grupo cip_ufg deveria valer 0');
  perform pg_temp.ok066(g ->> 'conta' = 'previsto − realizado − comprometido', 'conta do grupo de taxa deveria incluir comprometido');
  perform pg_temp.ok066(g ->> 'nota' = 'taxa a reter pela fundação/universidade: não é livre',
    format('nota do grupo de taxa inesperada: %s', g ->> 'nota'));

  no := pg_temp.no066(g, 'rubrica:cip_ufg:comprometido');
  perform pg_temp.ok066(no is not null, 'cip_ufg deveria ter nó comprometido');
  perform pg_temp.ok066(pg_temp.num066((no ->> 'valor')::numeric) = 15000, 'nó comprometido de cip_ufg deveria valer 15000');
  perform pg_temp.ok066((no ->> 'sinal')::integer = -1, 'comprometido da taxa deveria ter sinal -1');
  perform pg_temp.ok066(no ->> 'conta' = 'taxa a reter (previsto − realizado)', 'conta do comprometido da taxa inesperada');
  perform pg_temp.ok066(jsonb_array_length(no -> 'partes') = 2, 'comprometido com realizado > 0 deveria reusar previsto e realizado');

  g := pg_temp.no066(ex, 'grupo:dao');
  no := pg_temp.no066(g, 'rubrica:dao:comprometido');
  perform pg_temp.ok066(no is not null, 'dao deveria ter nó comprometido');
  perform pg_temp.ok066(pg_temp.num066((no ->> 'valor')::numeric) = 20000, 'comprometido de dao deveria valer 20000');
  perform pg_temp.ok066(jsonb_array_length(no -> 'partes') = 1, 'sem realizado, o comprometido deveria ter só o nó de previsto');

  g := pg_temp.no066(ex, 'grupo:cip_ua');
  perform pg_temp.ok066(g is not null, 'árvore deveria ter grupo:cip_ua');
  perform pg_temp.ok066(pg_temp.no066(g, 'rubrica:cip_ua:comprometido') is null,
    'taxa estourada não deveria ter nó comprometido');
  perform pg_temp.ok066(pg_temp.num066((g ->> 'valor')::numeric) = -2000, 'grupo cip_ua deveria valer -2000');

  g := pg_temp.no066(ex, 'grupo:b');
  perform pg_temp.ok066(g ->> 'nota' = 'compromissos fora de bolsas não são rastreados',
    'nota do grupo sem taxa não deveria mudar');
end $$;

-- ------------------------------------------------------------
-- BLOCO 3 — grupo misto: bolsas + taxa no mesmo grupo
-- O dao é reparentado para 'a' só nesta transação; o rollback desfaz.
-- ------------------------------------------------------------
update public.rubricas set parent_code = 'a' where code = 'dao';

do $$
declare
  v_id uuid := (select id from public.projects where code = '66.MISTO');
  r    jsonb := public.get_saldo_livre(v_id);
  ex   jsonb := public.explicar_livre_v2(v_id);
  g    jsonb;
  rub  jsonb;
  v_bolsas numeric := (r ->> 'compromissos_bolsas')::numeric;
  v_comp   numeric;
  v_livre  numeric;
begin
  perform pg_temp.ok066(v_bolsas > 0, 'o centro misto deveria ter compromisso de bolsa');

  rub := pg_temp.rubrica066(r, 'a.bolsas');
  perform pg_temp.ok066(pg_temp.num066((rub ->> 'compromissos')::numeric) = pg_temp.num066(v_bolsas),
    'a.bolsas deveria manter o compromisso da janela');
  perform pg_temp.ok066(rub ->> 'compromisso_tipo' = 'bolsas', 'a.bolsas deveria ser compromisso_tipo=bolsas');

  rub := pg_temp.rubrica066(r, 'dao');
  perform pg_temp.ok066(pg_temp.num066((rub ->> 'compromissos')::numeric) = 5000,
    format('dao no grupo misto deveria comprometer 5000, veio %s', rub ->> 'compromissos'));
  perform pg_temp.ok066(rub ->> 'compromisso_tipo' = 'taxa', 'dao deveria ser compromisso_tipo=taxa');

  g := pg_temp.grupo066(r, 'a');
  v_comp := pg_temp.num066((g ->> 'compromissos')::numeric);
  v_livre := pg_temp.num066((g ->> 'saldo_livre')::numeric);
  perform pg_temp.ok066(g ->> 'compromissos_cobertura' = 'bolsas e taxas',
    format('grupo misto deveria ser cobertura=bolsas e taxas, veio %s', g ->> 'compromissos_cobertura'));
  perform pg_temp.ok066(v_comp = pg_temp.num066(v_bolsas + 5000), 'compromissos do grupo misto deveriam somar bolsas + taxa');
  perform pg_temp.ok066(v_livre = pg_temp.num066(120000 - 55000 - v_bolsas - 5000),
    format('livre do grupo misto inesperado: %s', v_livre));

  perform pg_temp.arvore066(ex);
  perform pg_temp.ok066(pg_temp.num066((ex ->> 'valor')::numeric) = pg_temp.num066(v_livre + 20000),
    'raiz do misto deveria ser o grupo a + o grupo b');

  g := pg_temp.no066(ex, 'grupo:a');
  perform pg_temp.ok066(g ->> 'nota' = 'taxa a reter pela fundação/universidade: não é livre; bolsas contratadas também entram',
    format('nota do grupo misto inesperada: %s', g ->> 'nota'));
  perform pg_temp.ok066(pg_temp.no066(g, 'rubrica:a.bolsas:comprometido') is not null,
    'grupo misto deveria manter o comprometido das bolsas');
  perform pg_temp.ok066(pg_temp.no066(g, 'rubrica:dao:comprometido') is not null,
    'grupo misto deveria ter o comprometido da taxa');
end $$;

update public.rubricas set parent_code = null where code = 'dao';

-- ------------------------------------------------------------
-- BLOCO 4 — sem plano e sem balancete: contrato de hoje intacto
-- ------------------------------------------------------------
do $$
declare
  v_semplano uuid := (select id from public.projects where code = '66.SEMPLANO');
  v_sembal   uuid := (select id from public.projects where code = '66.SEMBAL');
  r     jsonb;
  ex    jsonb;
  g     jsonb;
  v_qtd integer;
begin
  r := public.get_saldo_livre(v_semplano);
  perform pg_temp.ok066(r ->> 'has_plano' = 'false', 'sem plano deveria devolver has_plano=false');
  perform pg_temp.ok066(r ->> 'has_balancete' = 'true', '66.SEMPLANO tem balancete');
  perform pg_temp.ok066(position('Sem plano de trabalho ativo' in coalesce(r ->> 'message', '')) = 1,
    'mensagem do sem plano deveria ser a da 048');
  select count(*) into v_qtd from jsonb_object_keys(r);
  perform pg_temp.ok066(v_qtd = 5, format('retorno do sem plano deveria manter as 5 chaves de hoje, veio %s', v_qtd));

  ex := public.explicar_livre_v2(v_semplano);
  perform pg_temp.arvore066(ex);
  perform pg_temp.ok066(ex ->> 'motivo' = 'sem plano', 'árvore do sem plano deveria ter motivo=sem plano');
  perform pg_temp.ok066(ex -> 'valor' = 'null'::jsonb, 'árvore do sem plano deveria ter valor nulo');

  r := public.get_saldo_livre(v_sembal);
  perform pg_temp.ok066(r ->> 'has_plano' = 'true', '66.SEMBAL tem plano');
  perform pg_temp.ok066(r ->> 'has_balancete' = 'false', 'sem balancete deveria devolver has_balancete=false');
  perform pg_temp.ok066(exists (
    select 1 from jsonb_array_elements_text(r -> 'avisos') a
     where a like 'Sem balancete importado%'
  ), 'aviso de sem balancete deveria continuar');
  g := pg_temp.grupo066(r, 'b');
  perform pg_temp.ok066(g ->> 'compromissos_cobertura' = 'nenhuma', 'sem balancete não inventa cobertura');
  perform pg_temp.ok066(pg_temp.num066((g ->> 'compromissos')::numeric) = 0, 'sem balancete não inventa compromisso');
  perform pg_temp.ok066(pg_temp.num066((g ->> 'saldo_livre')::numeric) = 50000, 'sem balancete mantém previsto − realizado');

  ex := public.explicar_livre_v2(v_sembal);
  perform pg_temp.arvore066(ex);
  perform pg_temp.ok066(ex ->> 'motivo' = 'sem balancete', 'árvore do sem balancete deveria ter motivo=sem balancete');
  perform pg_temp.ok066(ex -> 'valor' = 'null'::jsonb, 'árvore do sem balancete deveria ter valor nulo');
end $$;

-- ------------------------------------------------------------
-- BLOCO 5 — resumo_projetos_v2 enxerga o livre novo
-- ------------------------------------------------------------
do $$
declare
  v_res jsonb := public.resumo_projetos_v2();
  v_taxa jsonb;
  v_misto jsonb;
begin
  select c into v_taxa
    from jsonb_array_elements(v_res -> 'centros') c
   where c ->> 'code' = '66.TAXA';
  select c into v_misto
    from jsonb_array_elements(v_res -> 'centros') c
   where c ->> 'code' = '66.MISTO';

  perform pg_temp.ok066(v_taxa is not null and v_misto is not null, 'resumo deveria listar os centros 66.*');
  perform pg_temp.ok066(pg_temp.num066((v_taxa ->> 'livre')::numeric) = 38000,
    format('resumo de 66.TAXA deveria ser 38000, veio %s', v_taxa ->> 'livre'));
  perform pg_temp.ok066(pg_temp.num066((v_misto ->> 'livre')::numeric) = 25000,
    format('resumo de 66.MISTO deveria ser 25000 (grupo a 5000 + b 20000), veio %s', v_misto ->> 'livre'));
end $$;

reset role;
rollback;
