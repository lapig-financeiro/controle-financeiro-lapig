-- ============================================================
-- Roteiro de conferência da migração 065 (F2-E — ajustes da 064)
--
-- Roda no Postgres descartável via:
--   node tools/replica-local/rodar-065-pglite.mjs
-- Antes da 065, o BLOCO 1 falha no item 1 (a 064 não pega CPF
-- separado por 5 vírgulas) — o runner valida esse motivo.
--
-- Identidades dos stubs:
--   a1 = admin ('Victor')
--   b1 = professor A, escopo 51.X + 63.INAT
--   b2 = professor B, escopo 51.Y
--   c1 = agente (Buriti), escopo 51.X
--   d1 = automação (Vigia), sem centros
-- ============================================================
\set ON_ERROR_STOP on

create or replace function pg_temp.ok065(p boolean, p_motivo text) returns void language plpgsql as $$
begin
  if p is distinct from true then
    raise exception '065 FALHOU: %', p_motivo;
  end if;
end $$;

create or replace function pg_temp.falha065(p_sql text, p_code text, p_msg_like text default null) returns void
language plpgsql as $$
declare
  v_state text;
  v_msg   text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if p_code is not null and v_state <> p_code then
      raise exception '065 FALHOU: esperado SQLSTATE %, veio % (%): %', p_code, v_state, v_msg, p_sql;
    end if;
    if p_msg_like is not null and v_msg not like p_msg_like then
      raise exception '065 FALHOU: mensagem "%" não casa com "%": %', v_msg, p_msg_like, p_sql;
    end if;
    return;
  end;
  raise exception '065 FALHOU: operação deveria falhar mas passou: %', p_sql;
end $$;

create or replace function pg_temp.arvore065(
  p_no jsonb,
  p_raiz boolean default true,
  p_pai_chave text default null
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tipo      text := p_no ->> 'tipo';
  v_chave     text := coalesce(p_no ->> 'chave', '<sem-chave>');
  v_valor     numeric;
  v_soma      numeric;
  v_filho     jsonb;
  v_ref       jsonb;
  v_alvo_tab  text;
  v_alvo_id   uuid;
  v_ref_keys  text[];
begin
  if p_no is null or jsonb_typeof(p_no) <> 'object' then
    raise exception '065 FALHOU: nó inválido na árvore: %', p_no;
  end if;

  if not p_raiz and jsonb_typeof(p_no -> 'valor') <> 'number' then
    raise exception '065 FALHOU: nó % abaixo da raiz tem valor não numérico: %', v_chave, p_no -> 'valor';
  end if;

  if jsonb_typeof(p_no -> 'valor') <> 'number' then
    return;
  end if;
  v_valor := (p_no ->> 'valor')::numeric;

  if v_tipo not in ('calculo', 'documento', 'legado', 'digitado') then
    raise exception '065 FALHOU: tipo inválido % no nó %', v_tipo, v_chave;
  end if;

  if (p_no ->> 'sinal')::integer not in (1, -1) then
    raise exception '065 FALHOU: sinal inválido % no nó %', p_no ->> 'sinal', v_chave;
  end if;

  if v_tipo = 'calculo' then
    if p_no -> 'ref' <> 'null'::jsonb then
      raise exception '065 FALHOU: nó de cálculo % não pode ter ref', v_chave;
    end if;
    if coalesce(btrim(p_no ->> 'conta', E' \t\n\r'), '') = '' then
      raise exception '065 FALHOU: nó de cálculo % sem conta', v_chave;
    end if;
    if jsonb_typeof(p_no -> 'partes') <> 'array' or jsonb_array_length(p_no -> 'partes') = 0 then
      raise exception '065 FALHOU: nó de cálculo % sem partes', v_chave;
    end if;

    select coalesce(sum((f ->> 'sinal')::numeric * (f ->> 'valor')::numeric), 0)
      into v_soma
      from jsonb_array_elements(p_no -> 'partes') as f;

    if round(v_soma, 2) is distinct from round(v_valor, 2) then
      raise exception '065 FALHOU: nó % não fecha (valor %, soma dos filhos %)', v_chave, v_valor, v_soma;
    end if;

    for v_filho in select value from jsonb_array_elements(p_no -> 'partes') loop
      perform pg_temp.arvore065(v_filho, false, v_chave);
    end loop;
  else
    if jsonb_typeof(p_no -> 'partes') <> 'array' or jsonb_array_length(p_no -> 'partes') <> 0 then
      raise exception '065 FALHOU: folha % deve ter partes vazio', v_chave;
    end if;
    if p_no -> 'conta' <> 'null'::jsonb then
      raise exception '065 FALHOU: folha % não deve ter conta', v_chave;
    end if;
    v_ref := p_no -> 'ref';
    if jsonb_typeof(v_ref) <> 'object' then
      raise exception '065 FALHOU: folha % sem ref válida: %', v_chave, v_ref;
    end if;
    select array_agg(k order by k) into v_ref_keys from jsonb_object_keys(v_ref) as k;
    if v_ref_keys is distinct from array['alvo_id', 'alvo_tabela', 'campo']::text[] then
      raise exception '065 FALHOU: folha % com chaves de ref inesperadas: %', v_chave, v_ref;
    end if;
    v_alvo_tab := v_ref ->> 'alvo_tabela';
    v_alvo_id  := (v_ref ->> 'alvo_id')::uuid;
    if v_alvo_tab = 'plano_rubricas' then
      if not exists (select 1 from public.plano_rubricas where id = v_alvo_id) then
        raise exception '065 FALHOU: folha % aponta plano_rubricas inexistente', v_chave;
      end if;
    elsif v_alvo_tab = 'balancete_lancamentos' then
      if not exists (select 1 from public.balancete_lancamentos where id = v_alvo_id) then
        raise exception '065 FALHOU: folha % aponta balancete_lancamentos inexistente', v_chave;
      end if;
    elsif v_alvo_tab = 'scholarships' then
      if not exists (select 1 from public.scholarships where id = v_alvo_id) then
        raise exception '065 FALHOU: folha % aponta scholarships inexistente', v_chave;
      end if;
    else
      raise exception '065 FALHOU: folha % com alvo_tabela inesperada: %', v_chave, v_alvo_tab;
    end if;
  end if;
end $$;

begin;

select set_config('test065.x',    (select id::text from public.projects where code = '51.X'), true);
select set_config('test065.y',    (select id::text from public.projects where code = '51.Y'), true);
select set_config('test065.inat', (select id::text from public.projects where code = '63.INAT'), true);
select set_config('test065.bal_x', (select id::text from public.balancetes
                                     where project_id = current_setting('test065.x')::uuid
                                     order by data_referencia desc limit 1), true);
select set_config('test065.bal_y', (select id::text from public.balancetes
                                     where project_id = current_setting('test065.y')::uuid
                                     order by data_referencia desc limit 1), true);
select set_config('test065.bl_leg', (select id::text from public.balancete_lancamentos
                                      where balancete_id = current_setting('test065.bal_x')::uuid
                                        and conta_codigo = '7.1.3.05.01.00014'), true);
select set_config('test065.bl_doc', (select id::text from public.balancete_lancamentos
                                      where balancete_id = current_setting('test065.bal_x')::uuid
                                        and conta_codigo = '7.1.3.04.01.09142'), true);

-- ------------------------------------------------------------
-- BLOCO 1 — itens 1 e 2: gramática única e máscara só com DV
-- ------------------------------------------------------------
do $$
declare
  v text;
  v_true text[] := array[
    '529.982.247-25',
    '52998224725',
    '529 982 247 25',
    '529/982/247/25',
    '529,,,,,982,,,,,247,,,,,25',
    '529' || chr(160) || '982' || chr(160) || '247' || chr(160) || '25',
    '529' || chr(8211) || '982' || chr(8211) || '247' || chr(8211) || '25',
    '1.234,56 NOME 529.982.247-25',
    '100 529.982.247-25',
    '529' || repeat(',', 6) || '982,,,,,247,,,,,25',
    '529     ' || E'\n' || '982     247     25',
    'ref 529-982-247-25 fim'
  ];
  v_false text[] := array[
    '123.456.789-00',
    '111.111.111-11',
    '529982247250',
    '7.1.3.05.01.00042 2506042',
    '7.1.3.04.01.09142 09142 BOLSA DOACAO PESQUISA 380.000,00 0,00 380.000,00',
    'rubrica 529 e 982 com valor 247,25',
    '{"saldo": 1107372.93, "conta": "7.1.3.05.01.00042", "red": "71199553"}',
    '529' || repeat(',', 7) || '982,,,,,247,,,,,25',
    '529e982 247 25',
    '5299 8224 725'
  ];
begin
  perform pg_temp.ok065(public._tem_cpf('529,,,,,982,,,,,247,,,,,25'),
    'item 1: CPF com 5 vírgulas tem de ser detectado (a 064 não detecta)');

  foreach v in array v_true loop
    perform pg_temp.ok065(public._tem_cpf(v), 'item 1: _tem_cpf deveria ser true para ' || v);
    perform pg_temp.ok065(not public._tem_cpf(public._mascarar_cpf(v)),
      'item 2: _tem_cpf(_mascarar_cpf(x)) deveria ser false para ' || v);
    perform pg_temp.ok065(public._cpfs(v) @> array['52998224725']::text[],
      'item 1: _cpfs deveria devolver 52998224725 para ' || v);
  end loop;

  foreach v in array v_false loop
    perform pg_temp.ok065(not public._tem_cpf(v), 'item 1: _tem_cpf deveria ser false para ' || v);
    perform pg_temp.ok065(public._mascarar_cpf(v) is not distinct from v,
      'item 2: _mascarar_cpf não deveria alterar texto sem CPF: ' || v);
    perform pg_temp.ok065(public._cpfs(v) = '{}'::text[],
      'item 1: _cpfs deveria ser vazio para ' || v);
  end loop;
end $$;

do $$
begin
  perform pg_temp.ok065(public._mascarar_cpf('CPF 529 982 247 25 ok') = 'CPF ***.***.***-** ok',
    'item 1: máscara do CPF espaçado');
  perform pg_temp.ok065(public._mascarar_cpf('1.234,56 NOME 529.982.247-25') = '1.234,56 NOME ***.***.***-**',
    'item 1: máscara não come o número vizinho');
  perform pg_temp.ok065(public._mascarar_cpf('100 529.982.247-25') = '100 ***.***.***-**',
    'item 1: número vizinho não rouba dígitos do CPF');
  perform pg_temp.ok065(public._mascarar_cpf('ref 123.456.789-00') = 'ref 123.456.789-00',
    'item 2: 11 dígitos com DV inválido não são mascarados');
  perform pg_temp.ok065(public._mascarar_cpf('5299 8224 725') = '5299 8224 725',
    'item 2: 4-4-3 não é candidato 3-3-3-2');
  perform pg_temp.ok065(public._cpfs('x 529.982.247-25 y 111.444.777-35') = array['52998224725','11144477735']::text[],
    'item 1: _cpfs devolve os dois CPFs na ordem');
  perform pg_temp.ok065(public._cpfs('x 529.982.247-25 y 529.982.247-25') = array['52998224725']::text[],
    'item 1: _cpfs não duplica CPF repetido');
end $$;

do $$ begin raise notice 'BLOCO 1 ok: gramática única de CPF (item 1) e máscara com DV (item 2)'; end $$;

-- ------------------------------------------------------------
-- BLOCO 2 — item 3: caminho legado com CPF
-- ------------------------------------------------------------
update public.balancetes
   set arquivo_storage_path = current_setting('test065.x') || '/rel_52998224725.pdf',
       arquivo_nome = 'bal_529/982/247/25.pdf'
 where id = (select id from public.balancetes
              where project_id = current_setting('test065.x')::uuid
              order by data_referencia desc limit 1);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
set local role authenticated;
do $$
declare
  x      uuid := current_setting('test065.x')::uuid;
  bal_x  uuid := current_setting('test065.bal_x')::uuid;
  bl_leg uuid := current_setting('test065.bl_leg')::uuid;
  o      jsonb := public.get_origem_v2('balancete_lancamentos', bl_leg, 'saldo_atual');
begin
  perform pg_temp.ok065(
    o ->> 'tipo' = 'legado'
    and o -> 'documento' ->> 'arquivo_nome' = 'bal_***.***.***-**.pdf'
    and o -> 'documento' -> 'caminho' = 'null'::jsonb
    and o -> 'documento' ->> 'nota' = 'arquivo com nome que parece CPF: peça ao admin'
    and o -> 'nota' = 'null'::jsonb,
    'item 3: b1 recebe arquivo_nome mascarado, caminho nulo e nota dentro de documento'
  );
end $$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
set local role authenticated;
do $$
declare
  x      uuid := current_setting('test065.x')::uuid;
  bal_x  uuid := current_setting('test065.bal_x')::uuid;
  bl_leg uuid := current_setting('test065.bl_leg')::uuid;
  o      jsonb := public.get_origem_v2('balancete_lancamentos', bl_leg, 'saldo_atual');
begin
  perform pg_temp.ok065(
    o ->> 'tipo' = 'legado'
    and o -> 'documento' ->> 'arquivo_nome' = 'bal_***.***.***-**.pdf'
    and o -> 'documento' -> 'caminho' = 'null'::jsonb
    and o -> 'documento' ->> 'nota' = 'arquivo com nome que parece CPF: peça ao admin',
    'item 3: agente recebe arquivo_nome mascarado, caminho nulo e nota dentro de documento'
  );
end $$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set local role authenticated;
do $$
declare
  x      uuid := current_setting('test065.x')::uuid;
  bal_x  uuid := current_setting('test065.bal_x')::uuid;
  bl_leg uuid := current_setting('test065.bl_leg')::uuid;
  o      jsonb := public.get_origem_v2('balancete_lancamentos', bl_leg, 'saldo_atual');
begin
  perform pg_temp.ok065(
    o -> 'documento' ->> 'arquivo_nome' = 'bal_529/982/247/25.pdf'
    and o -> 'documento' ->> 'caminho' = x::text || '/rel_52998224725.pdf'
    and not (o -> 'documento' ? 'nota'),
    'item 3: admin continua vendo arquivo_nome e caminho crus, sem nota'
  );
end $$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
set local role authenticated;
do $$
declare
  x      uuid := current_setting('test065.x')::uuid;
  bal_x  uuid := current_setting('test065.bal_x')::uuid;
  bl_leg uuid := current_setting('test065.bl_leg')::uuid;
  ex     jsonb := public.explicar_livre_v2(x);
  v_folha jsonb;
begin
  select l into v_folha
    from jsonb_array_elements(ex -> 'partes') g,
         jsonb_array_elements(g -> 'partes') r,
         jsonb_array_elements(r -> 'partes') l
   where l ->> 'chave' = 'linha:' || bl_leg::text;
  perform pg_temp.ok065(
    v_folha ->> 'tipo' = 'legado' and v_folha -> 'nota' = 'null'::jsonb,
    'item 3: a nota do caminho fica em documento e não muda a nota da árvore'
  );
end $$;
reset role;

update public.balancetes
   set arquivo_storage_path = current_setting('test065.x') || '/balancete_atual.pdf',
       arquivo_nome = 'balancete_atual.pdf'
 where id = (select id from public.balancetes
              where project_id = current_setting('test065.x')::uuid
              order by data_referencia desc limit 1);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
set local role authenticated;
do $$
declare
  x      uuid := current_setting('test065.x')::uuid;
  bal_x  uuid := current_setting('test065.bal_x')::uuid;
  bl_leg uuid := current_setting('test065.bl_leg')::uuid;
  o      jsonb := public.get_origem_v2('balancete_lancamentos', bl_leg, 'saldo_atual');
begin
  perform pg_temp.ok065(
    o -> 'documento' ->> 'caminho' = x::text || '/balancete_atual.pdf'
    and not (o -> 'documento' ? 'nota'),
    'item 3: sem CPF no caminho nada muda'
  );
end $$;
reset role;

-- Item 2 da 2ª rodada: o caminho do ramo documento (fato conferido) também
-- anula para não-admin/agente quando tem CPF, com a nota dentro de documento.
update public.documento_versoes dv
   set caminho = current_setting('test065.x') || '/doc_52998224725.pdf'
  from public.documentos d
 where d.id = dv.documento_id
   and d.project_id = current_setting('test065.x')::uuid
   and d.tipo = 'balancete';

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
set local role authenticated;
do $$
declare
  x      uuid := current_setting('test065.x')::uuid;
  bl_doc uuid := current_setting('test065.bl_doc')::uuid;
  o      jsonb := public.get_origem_v2('balancete_lancamentos', bl_doc, 'saldo_atual');
  ex     jsonb;
  v_folha jsonb;
begin
  perform pg_temp.ok065(
    o ->> 'tipo' = 'documento'
    and o -> 'documento' -> 'caminho' = 'null'::jsonb
    and o -> 'documento' ->> 'nota' = 'arquivo com nome que parece CPF: peça ao admin'
    and o -> 'nota' = 'null'::jsonb,
    'item 2b: b1 recebe caminho nulo e nota no ramo documento'
  );

  ex := public.explicar_livre_v2(x);
  perform pg_temp.arvore065(ex, true);
  select l into v_folha
    from jsonb_array_elements(ex -> 'partes') g,
         jsonb_array_elements(g -> 'partes') r,
         jsonb_array_elements(r -> 'partes') l
   where l ->> 'chave' = 'linha:' || bl_doc::text;
  perform pg_temp.ok065(
    v_folha ->> 'tipo' = 'documento' and v_folha -> 'nota' = 'null'::jsonb,
    'item 2b: a nota do caminho no ramo documento não muda a folha da árvore'
  );
end $$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
set local role authenticated;
do $$
declare
  bl_doc uuid := current_setting('test065.bl_doc')::uuid;
  o      jsonb := public.get_origem_v2('balancete_lancamentos', bl_doc, 'saldo_atual');
begin
  perform pg_temp.ok065(
    o ->> 'tipo' = 'documento'
    and o -> 'documento' -> 'caminho' = 'null'::jsonb
    and o -> 'documento' ->> 'nota' = 'arquivo com nome que parece CPF: peça ao admin',
    'item 2b: agente recebe caminho nulo e nota no ramo documento'
  );
end $$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set local role authenticated;
do $$
declare
  x      uuid := current_setting('test065.x')::uuid;
  bl_doc uuid := current_setting('test065.bl_doc')::uuid;
  o      jsonb := public.get_origem_v2('balancete_lancamentos', bl_doc, 'saldo_atual');
begin
  perform pg_temp.ok065(
    o ->> 'tipo' = 'documento'
    and o -> 'documento' ->> 'caminho' = x::text || '/doc_52998224725.pdf'
    and not (o -> 'documento' ? 'nota'),
    'item 2b: admin continua vendo o caminho cru no ramo documento'
  );
end $$;
reset role;

update public.documento_versoes dv
   set caminho = current_setting('test065.x') || '/balancete_atual.pdf'
  from public.documentos d
 where d.id = dv.documento_id
   and d.project_id = current_setting('test065.x')::uuid
   and d.tipo = 'balancete';

do $$ begin raise notice 'BLOCO 2 ok: caminho legado e documento com CPF (itens 3 e 2b)'; end $$;

-- ------------------------------------------------------------
-- BLOCO 3 — item 4: pendência nova recusa CPF; existente deixa o gatilho decidir
-- ------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);

reset role;
alter table public.pendencias disable trigger trg_pendencias_sem_cpf;
do $$
declare
  v_id uuid;
begin
  insert into public.pendencias (chave, project_id, tipo, titulo, detalhe)
  values ('outro:65:legado', current_setting('test065.x')::uuid, 'outro',
          'Legado com 529.982.247-25', '{"obs":"529.982.247-25"}'::jsonb)
  returning id into v_id;
  perform set_config('test065.pend_id', v_id::text, true);
end $$;
alter table public.pendencias enable trigger trg_pendencias_sem_cpf;

set local role authenticated;
do $$
declare
  x    uuid := current_setting('test065.x')::uuid;
  v_id uuid := current_setting('test065.pend_id')::uuid;
  r    jsonb;
begin
  perform pg_temp.falha065(
    format($q$select public.criar_pendencia_v2(%L::jsonb)$q$,
      jsonb_build_object('chave', 'outro:65:nova-cpf', 'project_id', x, 'tipo', 'outro',
                         'titulo', 'Nova com 529.982.247-25')::text),
    '22023', 'Pendência contém sequência no formato de CPF%');

  begin
    r := public.criar_pendencia_v2(jsonb_build_object(
      'chave', 'outro:65:legado', 'project_id', x, 'tipo', 'outro',
      'titulo', 'Legado com 529.982.247-25', 'detalhe', '{}'::jsonb));
  exception when others then
    raise exception '065 FALHOU: item 4: pendência existente deveria aceitar a limpeza do detalhe (%)', sqlerrm;
  end;
  perform pg_temp.ok065(
    (r ->> 'criada')::boolean = false and (r ->> 'id') = v_id::text,
    'item 4: pendência existente pode limpar o detalhe mantendo o CPF antigo no título');
  perform pg_temp.ok065(
    (select detalhe = '{}'::jsonb from public.pendencias where id = v_id),
    'item 4: detalhe legado foi limpo');

  perform pg_temp.falha065(
    format($q$select public.criar_pendencia_v2(%L::jsonb)$q$,
      jsonb_build_object('chave', 'outro:65:legado', 'project_id', x, 'tipo', 'outro',
                         'titulo', 'Legado com 529.982.247-25',
                         'detalhe', jsonb_build_object('novo', '111.444.777-35'))::text),
    '23514', 'Pendência com CPF%');

  begin
    r := public.criar_pendencia_v2(jsonb_build_object(
      'chave', 'outro:65:legado', 'project_id', x, 'tipo', 'outro',
      'titulo', 'Limpo', 'detalhe', '{}'::jsonb));
  exception when others then
    raise exception '065 FALHOU: item 4: pendência existente deveria aceitar a remoção do CPF do título (%)', sqlerrm;
  end;
  perform pg_temp.ok065(
    (r ->> 'criada')::boolean = false
    and (select titulo = 'Limpo' and detalhe = '{}'::jsonb from public.pendencias where id = v_id),
    'item 4: pendência existente pode remover o CPF antigo do título');

  perform pg_temp.falha065(
    format($q$select public.criar_pendencia_v2(%L::jsonb)$q$,
      jsonb_build_object('chave', 'outro:65:reintroduz', 'project_id', x, 'tipo', 'outro',
                         'titulo', 'Reintroduz 529.982.247-25')::text),
    '22023', 'Pendência contém sequência no formato de CPF%');

  r := public.criar_pendencia_v2(jsonb_build_object(
    'chave', 'outro:65:limpa', 'project_id', x, 'tipo', 'outro', 'titulo', 'Sem CPF'));
  perform pg_temp.ok065((r ->> 'criada')::boolean = true,
    'item 4: pendência nova sem CPF continua sendo criada');
end $$;
reset role;

do $$
begin
  perform pg_temp.falha065(
    $q$insert into public.pendencias (chave, project_id, tipo, titulo, detalhe)
       values ('outro:65:gatilho', null, 'outro', 'Ok', '{"a":"529.982","b":"247-25"}'::jsonb)$q$,
    '23514', 'Pendência com CPF%');
end $$;

do $$ begin raise notice 'BLOCO 3 ok: criar_pendencia_v2 só recusa CPF novo (item 4)'; end $$;

-- Helpers de teste que chamam funções internas (security definer): criados só aqui,
-- depois do BLOCO 1, para o roteiro falhar no item 1 antes da 065.
create or replace function pg_temp.lote065(p_alvos jsonb, p_mascarar boolean)
returns table (alvo_tabela text, alvo_id uuid, campo text, origem jsonb)
language sql security definer set search_path = public, pg_temp as $$
  select * from public._resolver_origens_v2(p_alvos, p_mascarar);
$$;

create or replace function pg_temp.um065(p_alvo_tabela text, p_alvo_id uuid, p_campo text, p_mascarar boolean)
returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  select public._resolver_origem_alvo(p_alvo_tabela, p_alvo_id, p_campo, p_mascarar);
$$;

-- ------------------------------------------------------------
-- BLOCO 4 — item 5: origem em lote igual à regra única e árvore intacta
-- ------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set local role authenticated;
do $$
declare
  x       uuid := current_setting('test065.x')::uuid;
  ex      jsonb := public.explicar_livre_v2(x);
  v_n     int;
  v_dif   int;
  v_lote_n int;
  v_livre numeric;
  v_pr    uuid;
  v_bol   uuid;
  v_g     jsonb;
begin
  perform pg_temp.arvore065(ex, true);

  select (c ->> 'livre')::numeric
    into v_livre
    from jsonb_array_elements(public.resumo_projetos_v2() -> 'centros') c
   where c ->> 'id' = x::text;
  perform pg_temp.ok065(
    round((ex ->> 'valor')::numeric, 2) = round(v_livre, 2),
    'item 5: raiz de explicar_livre_v2 continua batendo com resumo_projetos_v2');

  with folhas as (
    select distinct
           l -> 'ref' ->> 'alvo_tabela' as t,
           (l -> 'ref' ->> 'alvo_id')::uuid as id,
           l -> 'ref' ->> 'campo' as c,
           l ->> 'tipo' as tipo,
           coalesce(l ->> 'nota', '') as nota
      from jsonb_array_elements(ex -> 'partes') g,
           jsonb_array_elements(g -> 'partes') r,
           jsonb_array_elements(r -> 'partes') l
     where l -> 'ref' is not null and l -> 'ref' <> 'null'::jsonb
  ),
  lote as (
    select * from pg_temp.lote065(
      (select jsonb_agg(jsonb_build_object('alvo_tabela', f.t, 'alvo_id', f.id, 'campo', f.c)) from folhas f),
      false)
  )
  select count(*), count(*) filter (
    where coalesce(o.origem ->> 'tipo', 'legado') is distinct from f.tipo
       or coalesce(o.origem ->> 'nota', '') is distinct from f.nota
       or pg_temp.um065(f.t, f.id, f.c, false) is distinct from o.origem)
    into v_n, v_dif
    from folhas f
    left join lote o on o.alvo_tabela = f.t and o.alvo_id = f.id and o.campo = f.c;
  perform pg_temp.ok065(v_n > 0 and v_dif = 0,
    format('item 5: lote e _resolver_origem_alvo divergem em %s de %s folhas', v_dif, v_n));

  select (l -> 'ref' ->> 'alvo_id')::uuid into v_pr
    from jsonb_array_elements(ex -> 'partes') g,
         jsonb_array_elements(g -> 'partes') r,
         jsonb_array_elements(r -> 'partes') l
   where r ->> 'chave' = 'rubrica:a.bolsas:previsto' and l ->> 'tipo' = 'documento'
   limit 1;
  select (l -> 'ref' ->> 'alvo_id')::uuid into v_bol
    from jsonb_array_elements(ex -> 'partes') g,
         jsonb_array_elements(g -> 'partes') r,
         jsonb_array_elements(r -> 'partes') l
   where r ->> 'chave' = 'rubrica:a.bolsas:comprometido' and l ->> 'tipo' = 'digitado'
   limit 1;
  select count(*) into v_lote_n
    from pg_temp.lote065(jsonb_build_array(
      jsonb_build_object('alvo_tabela', 'plano_rubricas', 'alvo_id', v_pr, 'campo', 'valor_previsto'),
      jsonb_build_object('alvo_tabela', 'scholarships', 'alvo_id', v_bol, 'campo', 'amount')), false);
  perform pg_temp.ok065(v_lote_n = 2,
    'item 5: _resolver_origens_v2 devolve uma linha por alvo pedido');

  perform pg_temp.ok065(
    exists (
      select 1 from jsonb_array_elements(ex -> 'partes') g,
                    jsonb_array_elements(g -> 'partes') r,
                    jsonb_array_elements(r -> 'partes') l
       where r ->> 'chave' = 'rubrica:a.bolsas:previsto' and l ->> 'tipo' = 'documento'
    )
    and exists (
      select 1 from jsonb_array_elements(ex -> 'partes') g,
                    jsonb_array_elements(g -> 'partes') r,
                    jsonb_array_elements(r -> 'partes') l
       where r ->> 'chave' = 'rubrica:b:previsto' and l ->> 'tipo' = 'legado'
    )
    and exists (
      select 1 from jsonb_array_elements(ex -> 'partes') g,
                    jsonb_array_elements(g -> 'partes') r,
                    jsonb_array_elements(r -> 'partes') l
       where r ->> 'chave' = 'rubrica:a.bolsas:comprometido' and l ->> 'tipo' = 'digitado'
    ),
    'item 5: a árvore continua com folhas documento, legado e digitado');

  perform pg_temp.ok065(
    not has_function_privilege('anon', 'public._resolver_origens_v2(jsonb, boolean)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public._resolver_origens_v2(jsonb, boolean)', 'EXECUTE'),
    'item 5: _resolver_origens_v2 fechada para anon/authenticated');
  perform pg_temp.ok065(
    (select prosecdef and proconfig = array['search_path=public, pg_temp']::text[]
       from pg_proc where oid = 'public._resolver_origens_v2(jsonb, boolean)'::regprocedure),
    'item 5: _resolver_origens_v2 é security definer com search_path exato');
end $$;
reset role;

do $$ begin raise notice 'BLOCO 4 ok: origem em lote (item 5)'; end $$;

-- ------------------------------------------------------------
-- BLOCO 5 — item 6: conflito de versão vira 40001 com mensagem clara
-- ------------------------------------------------------------
reset role;
create or replace function pg_temp.colide065() returns trigger
language plpgsql as $$
begin
  if new.sha256 = repeat('7', 64) then
    insert into public.documento_versoes
      (documento_id, versao, sha256, bucket, caminho, formato, paginas, parser, parser_versao, origem)
    values
      (new.documento_id, new.versao, repeat('8', 64), new.bucket, new.caminho,
       new.formato, new.paginas, new.parser, new.parser_versao, new.origem);
  end if;
  return new;
end $$;
create trigger trg_colide065 before insert on public.documento_versoes
  for each row execute function pg_temp.colide065();

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set local role authenticated;
do $$
declare
  x     uuid := current_setting('test065.x')::uuid;
  bal_x uuid := (select id from public.balancetes where project_id = x order by data_referencia desc limit 1);
  ref_x date := (select data_referencia from public.balancetes where id = bal_x);
  v_chave text := 'balancete:' || x::text || ':' || to_char(ref_x, 'YYYY-MM-DD');
  r     jsonb;
begin
  perform pg_temp.falha065(
    format($q$select public.registrar_documento_v2(%L::jsonb)$q$,
      jsonb_build_object(
        'project_id', x, 'tipo', 'balancete', 'chave', v_chave,
        'titulo', 'Teste conflito 065', 'sha256', repeat('7', 64), 'bucket', 'balancete-pdfs',
        'caminho', x::text || '/conflito_065.pdf', 'formato', 'pdf', 'paginas', 1,
        'parser', 'p', 'parser_versao', '1', 'origem', 'site', 'fatos', '[]'::jsonb)::text),
    '40001', 'Conflito ao gravar a versão%');
  perform pg_temp.ok065(
    not exists (
      select 1 from public.documento_versoes dv
       join public.documentos d on d.id = dv.documento_id
      where d.chave = v_chave and dv.sha256 in (repeat('7', 64), repeat('8', 64))
    ),
    'item 6: conflito não deixa versão parcial gravada');

  r := public.registrar_documento_v2(jsonb_build_object(
    'project_id', x, 'tipo', 'balancete', 'chave', v_chave,
    'titulo', 'Teste 065 versão nova', 'sha256', repeat('9', 64), 'bucket', 'balancete-pdfs',
    'caminho', x::text || '/normal_065.pdf', 'formato', 'pdf', 'paginas', 1,
    'parser', 'p', 'parser_versao', '1', 'origem', 'site', 'fatos', '[]'::jsonb));
  perform pg_temp.ok065(
    (r ->> 'criada')::boolean = true and (r ->> 'versao')::int = 2,
    'item 6: registro normal continua criando a próxima versão');
end $$;
reset role;

drop trigger trg_colide065 on public.documento_versoes;
drop function pg_temp.colide065();

do $$ begin raise notice 'BLOCO 5 ok: conflito de versão (item 6)'; end $$;

-- ------------------------------------------------------------
-- BLOCO 6 — item 7: alvo nulo de não-admin é o mesmo 42501
-- ------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
set local role authenticated;
do $$
declare
  x     uuid := current_setting('test065.x')::uuid;
  bal_x uuid := current_setting('test065.bal_x')::uuid;
  bal_y uuid := current_setting('test065.bal_y')::uuid;
begin
  perform pg_temp.falha065('select public.get_origem_v2(null, null::uuid, null)',
    '42501', 'Acesso negado ao alvo.');
  perform pg_temp.falha065(format('select public.get_origem_v2(%L, null::uuid, %L)', 'balancetes', 'saldo_disponivel'),
    '42501', 'Acesso negado ao alvo.');
  perform pg_temp.falha065(format('select public.get_origem_v2(%L, %L::uuid, null)', 'balancetes', bal_x),
    '42501', 'Acesso negado ao alvo.');
  perform pg_temp.falha065(format('select public.get_origem_v2(%L, %L::uuid, %L)', 'balancetes', bal_y, 'saldo_disponivel'),
    '42501', 'Acesso negado ao alvo.');
  perform pg_temp.falha065(format('select public.get_origem_v2(%L, %L::uuid, %L)', 'balancetes', gen_random_uuid(), 'saldo_disponivel'),
    '42501', 'Acesso negado ao alvo.');
end $$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set local role authenticated;
do $$
begin
  perform pg_temp.falha065('select public.get_origem_v2(null, null::uuid, null)',
    '22023', 'alvo_tabela, alvo_id e campo são obrigatórios.%');
  perform pg_temp.falha065(format('select public.get_origem_v2(%L, %L::uuid, %L)', 'balancetes', gen_random_uuid(), 'saldo_disponivel'),
    'P0002', 'Alvo não encontrado.');
end $$;
reset role;

do $$ begin raise notice 'BLOCO 6 ok: mensagem de alvo nulo unificada (item 7)'; end $$;

select set_config('request.jwt.claim.sub', '', false);
rollback;

