-- CONTROLE FINANCEIRO DE PROJETOS — Migração 065 (F2-E: ajustes da 064 antes do backfill)
-- Só create or replace das funções da 064 e asserções; nenhuma tabela nova, nenhuma linha inserida.
-- Itens: regra de CPF única (contem_cpf OU candidato 3-3-3-2 com vão de 0 a 6 não dígito/não letra e DV);
-- máscara só com DV válido; caminho legado com CPF anulado e nota em documento; criar_pendencia_v2 só
-- recusa CPF novo; explicar_livre_v2 resolve origem em lote; versão com unique_violation vira 40001;
-- alvo nulo de não-admin em get_origem_v2 devolve 42501; asserção de policy lista as que sobram.
-- As funções antigas do site não mudam.

begin;

-- ------------------------------------------------------------
-- 1. Regra de CPF única (item 1): contem_cpf OU candidato 3-3-3-2
--    com vãos de 0 a 6 caracteres que não são dígito nem letra.
-- ------------------------------------------------------------

create or replace function public._cpf_candidato(t text, p_inicio integer)
returns integer
language plpgsql
immutable
security definer
set search_path = public, pg_temp
as $$
declare
  v_len   integer;
  v_i     integer;
  v_tam   integer;
  v_gap   integer;
  v_ch    text;
  v_passo integer;
begin
  if t is null or p_inicio is null then
    return null;
  end if;

  v_len := char_length(t);
  if p_inicio < 1 or p_inicio + 2 > v_len then
    return null;
  end if;

  -- Sem dígito colado antes do primeiro grupo.
  if p_inicio > 1 and substr(t, p_inicio - 1, 1) ~ '^[0-9]$' then
    return null;
  end if;

  v_i := p_inicio;
  for v_passo in 1..4 loop
    v_tam := case when v_passo = 4 then 2 else 3 end;
    if v_i + v_tam - 1 > v_len then
      return null;
    end if;
    if substr(t, v_i, v_tam) !~ ('^[0-9]{' || v_tam::text || '}$') then
      return null;
    end if;
    v_i := v_i + v_tam;

    if v_passo = 4 then
      exit;
    end if;

    -- Vão de 0 a 6 caracteres; letra (inclusive acentuada) quebra o candidato.
    v_gap := 0;
    loop
      exit when v_i > v_len;
      v_ch := substr(t, v_i, 1);
      exit when v_ch ~ '^[0-9]$'
                or v_ch ~ '^[[:alpha:]]$'
                or upper(v_ch) <> lower(v_ch);
      exit when v_gap = 6;
      v_i := v_i + 1;
      v_gap := v_gap + 1;
    end loop;

    if v_i > v_len or substr(t, v_i, 1) !~ '^[0-9]$' then
      return null;
    end if;
  end loop;

  -- Sem dígito colado depois do último grupo.
  if v_i <= v_len and substr(t, v_i, 1) ~ '^[0-9]$' then
    return null;
  end if;

  return v_i - 1;
end;
$$;

comment on function public._cpf_candidato(text, integer) is
  'Fim (1-based) do candidato a CPF 3-3-3-2 que começa em p_inicio, ou null; só a forma, o DV é contem_cpf (mig. 065).';

revoke all on function public._cpf_candidato(text, integer) from public, anon, authenticated;

create or replace function public._tem_cpf(t text)
returns boolean
language plpgsql
immutable
security definer
set search_path = public, pg_temp
as $$
declare
  v_len integer;
  v_pos integer;
  v_fim integer;
  v_dig text;
begin
  if t is null or t = '' then
    return false;
  end if;

  if public.contem_cpf(t) then
    return true;
  end if;

  v_len := char_length(t);
  v_pos := 1;
  while v_pos <= v_len - 10 loop
    if substr(t, v_pos, 1) ~ '^[0-9]$' then
      v_fim := public._cpf_candidato(t, v_pos);
      if v_fim is not null then
        v_dig := regexp_replace(substr(t, v_pos, v_fim - v_pos + 1), '[^0-9]', '', 'g');
        if public.contem_cpf(v_dig) then
          return true;
        end if;
      end if;
    end if;
    v_pos := v_pos + 1;
  end loop;

  return false;
end;
$$;

comment on function public._tem_cpf(text) is
  'true se contem_cpf (052) ou um candidato 3-3-3-2 com vão de 0 a 6 não dígito/não letra e DV válido; cada início é testado (mig. 065).';

revoke all on function public._tem_cpf(text) from public, anon, authenticated;

create or replace function public._mascarar_cpf(t text)
returns text
language plpgsql
immutable
security definer
set search_path = public, pg_temp
as $$
declare
  v_len integer;
  v_pos integer;
  v_fim integer;
  v_dig text;
  v_out text := '';
  v_ch  text;
begin
  if t is null then
    return null;
  end if;

  v_len := char_length(t);
  v_pos := 1;
  while v_pos <= v_len loop
    v_ch := substr(t, v_pos, 1);
    if v_ch ~ '^[0-9]$' then
      v_fim := public._cpf_candidato(t, v_pos);
      if v_fim is not null then
        v_dig := regexp_replace(substr(t, v_pos, v_fim - v_pos + 1), '[^0-9]', '', 'g');
        if public.contem_cpf(v_dig) then
          v_out := v_out || '***.***.***-**';
          v_pos := v_fim + 1;
          continue;
        end if;
      end if;
    end if;
    v_out := v_out || v_ch;
    v_pos := v_pos + 1;
  end loop;

  return v_out;
end;
$$;

comment on function public._mascarar_cpf(text) is
  'Troca exatamente os candidatos 3-3-3-2 com DV válido por ***.***.***-**; não mascara 11 dígitos qualquer nem DV inválido (mig. 065).';

revoke all on function public._mascarar_cpf(text) from public, anon, authenticated;

create or replace function public._cpfs(t text)
returns text[]
language plpgsql
immutable
security definer
set search_path = public, pg_temp
as $$
declare
  v_len integer;
  v_pos integer;
  v_fim integer;
  v_dig text;
  v     text[] := '{}'::text[];
begin
  if t is null then
    return v;
  end if;

  v_len := char_length(t);
  v_pos := 1;
  while v_pos <= v_len loop
    if substr(t, v_pos, 1) ~ '^[0-9]$' then
      v_fim := public._cpf_candidato(t, v_pos);
      if v_fim is not null then
        v_dig := regexp_replace(substr(t, v_pos, v_fim - v_pos + 1), '[^0-9]', '', 'g');
        if public.contem_cpf(v_dig) and not (v_dig = any(v)) then
          v := v || v_dig;
        end if;
      end if;
    end if;
    v_pos := v_pos + 1;
  end loop;

  return v;
end;
$$;

comment on function public._cpfs(text) is
  'Devolve os 11 dígitos de cada candidato 3-3-3-2 com DV válido, na ordem e sem repetir (mig. 065).';

revoke all on function public._cpfs(text) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 3. registrar_documento_v2: só o insert da versão ganha a mensagem de conflito.
-- ------------------------------------------------------------

create or replace function public.registrar_documento_v2(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_chaves_inv text; v_project_txt text; v_project_id uuid; v_tipo text;
  v_chave text; v_chave_data_txt text; v_chave_data date; v_chave_plano_id uuid;
  v_titulo text; v_sha256 text; v_bucket text; v_caminho text;
  v_cam_seg text; v_cam_rel text; v_arquivo_nome text; v_formato text;
  v_paginas_num numeric; v_paginas integer; v_parser text; v_parser_versao text;
  v_origem text; v_fatos_arr jsonb;
  v_doc_id uuid; v_doc_proj uuid; v_doc_tipo text; v_versao_id uuid; v_versao integer; v_trechos_cat text;
  v_f record; v_f_chaves_inv text; v_f_tabela text; v_f_id_txt text; v_f_id uuid;
  v_f_campo text; v_f_valor numeric(14,2); v_f_has_pag boolean; v_f_pag_num numeric;
  v_f_pagina integer; v_f_trecho text; v_f_bbox jsonb;
  v_alvo_proj uuid; v_alvo_pai_id uuid; v_alvo_chave text; v_alvo_data date;
  v_atual numeric(14,2); v_dup_cnt bigint; v_divergencias jsonb := '[]'::jsonb; v_qtd_fatos integer := 0;
begin
  if not public.is_admin() or public.is_agente() then
    raise exception 'Só admin humano registra documentos nesta fase.' using errcode = '42501';
  end if;

  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Payload deve ser um objeto JSON.' using errcode = '22023';
  end if;

  select string_agg(k, ', ' order by k)
    into v_chaves_inv
    from jsonb_object_keys(p) as k
   where k not in (
     'project_id', 'tipo', 'chave', 'titulo', 'sha256', 'bucket', 'caminho',
     'arquivo_nome', 'formato', 'paginas', 'parser', 'parser_versao', 'origem', 'fatos'
   );

  if v_chaves_inv is not null then
    raise exception 'Campos não permitidos em registrar_documento_v2: %', v_chaves_inv
      using errcode = '22023';
  end if;

  if jsonb_typeof(p -> 'project_id') is distinct from 'string' then
    raise exception 'Campo project_id é obrigatório.' using errcode = '22023';
  end if;
  v_project_txt := nullif(btrim(p ->> 'project_id', E' \t\n\r'), '');
  if v_project_txt is null
     or v_project_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Campo project_id inválido.' using errcode = '22023';
  end if;
  v_project_id := v_project_txt::uuid;

  if not exists (select 1 from public.projects pr where pr.id = v_project_id) then
    raise exception 'Projeto não encontrado.' using errcode = '22023';
  end if;

  if jsonb_typeof(p -> 'tipo') is distinct from 'string' then
    raise exception 'Campo tipo é obrigatório.' using errcode = '22023';
  end if;
  v_tipo := btrim(p ->> 'tipo', E' \t\n\r');
  if v_tipo not in ('balancete', 'plano') then
    raise exception 'Campo tipo inválido.' using errcode = '22023';
  end if;

  if jsonb_typeof(p -> 'chave') is distinct from 'string' then
    raise exception 'Campo chave é obrigatório.' using errcode = '22023';
  end if;
  v_chave := nullif(btrim(p ->> 'chave', E' \t\n\r'), '');
  if v_chave is null then
    raise exception 'Campo chave não pode ser vazio.' using errcode = '22023';
  end if;

  if v_tipo = 'balancete' then
    if v_chave !~ ('^balancete:' || v_project_id::text || ':[0-9]{4}-[0-9]{2}-[0-9]{2}$') then
      if public._tem_cpf(v_chave) then
        raise exception 'Chave do documento contém CPF e não pode ser gravada.' using errcode = '22023';
      end if;
      raise exception 'Chave de balancete deve ter o formato balancete:<project_id>:<AAAA-MM-DD>.'
        using errcode = '22023';
    end if;
    v_chave_data_txt := split_part(v_chave, ':', 3);
    begin
      v_chave_data := v_chave_data_txt::date;
    exception when datetime_field_overflow or invalid_datetime_format or invalid_text_representation then
      raise exception 'Data inválida na chave do balancete: %.', v_chave_data_txt using errcode = '22023';
    end;
    if to_char(v_chave_data, 'YYYY-MM-DD') <> v_chave_data_txt then
      raise exception 'Data inválida na chave do balancete: %.', v_chave_data_txt using errcode = '22023';
    end if;
  else
    if v_chave !~ ('^plano:' || v_project_id::text || ':[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
      if public._tem_cpf(v_chave) then
        raise exception 'Chave do documento contém CPF e não pode ser gravada.' using errcode = '22023';
      end if;
      raise exception 'Chave de plano deve ter o formato plano:<project_id>:<plano_id>.'
        using errcode = '22023';
    end if;
    v_chave_plano_id := split_part(v_chave, ':', 3)::uuid;
  end if;

  if v_tipo = 'balancete' then
    if not exists (
      select 1 from public.balancetes b
       where b.project_id = v_project_id and b.data_referencia = v_chave_data
    ) then
      raise exception 'Não existe balancete do projeto % na data % da chave.',
        v_project_id, v_chave_data_txt using errcode = '22023';
    end if;
  elsif not exists (
    select 1 from public.planos_trabalho pt
     where pt.id = v_chave_plano_id and pt.project_id = v_project_id
  ) then
    raise exception 'Plano % não encontrado no projeto %.', v_chave_plano_id, v_project_id
      using errcode = '22023';
  end if;

  if jsonb_typeof(p -> 'titulo') is distinct from 'string' then
    raise exception 'Campo titulo é obrigatório.' using errcode = '22023';
  end if;
  v_titulo := nullif(btrim(p ->> 'titulo', E' \t\n\r'), '');
  if v_titulo is null then
    raise exception 'Campo titulo não pode ser vazio.' using errcode = '22023';
  end if;

  if jsonb_typeof(p -> 'sha256') is distinct from 'string' then
    raise exception 'Campo sha256 é obrigatório.' using errcode = '22023';
  end if;
  v_sha256 := lower(btrim(p ->> 'sha256', E' \t\n\r'));
  if v_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Campo sha256 deve ter 64 dígitos hexadecimais.' using errcode = '22023';
  end if;

  if jsonb_typeof(p -> 'bucket') is distinct from 'string' then
    raise exception 'Campo bucket é obrigatório.' using errcode = '22023';
  end if;
  v_bucket := btrim(p ->> 'bucket', E' \t\n\r');
  if not (
    (v_tipo = 'balancete' and v_bucket = 'balancete-pdfs')
    or (v_tipo = 'plano' and v_bucket = 'plano-trabalho-docs')
  ) then
    raise exception 'Bucket incompatível com o tipo do documento.' using errcode = '22023';
  end if;

  if jsonb_typeof(p -> 'caminho') is distinct from 'string' then
    raise exception 'Campo caminho é obrigatório.' using errcode = '22023';
  end if;
  v_caminho := p ->> 'caminho';
  v_cam_seg := split_part(v_caminho, '/', 1);
  v_cam_rel := case
    when position('/' in v_caminho) > 0 then substr(v_caminho, position('/' in v_caminho) + 1)
    else ''
  end;
  if btrim(v_caminho, E' \t\n\r') <> v_caminho
     or position('/' in v_caminho) = 0
     or nullif(v_cam_rel, '') is null
     or position('\' in v_caminho) > 0
     or v_caminho ~ '(^|/)\.\.(/|$)'
     or v_cam_seg !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    if public._tem_cpf(v_caminho) then
      raise exception 'Caminho do documento contém CPF e não pode ser gravado.' using errcode = '22023';
    end if;
    raise exception 'Campo caminho deve começar com <project_id>/ e conter o nome do arquivo.'
      using errcode = '22023';
  end if;
  if v_cam_seg is distinct from v_project_id::text then
    raise exception 'Primeiro segmento do caminho deve ser o project_id em minúsculas: %.',
      v_project_id::text using errcode = '22023';
  end if;
  if public._tem_cpf(v_cam_rel) then
    raise exception 'Caminho do documento contém CPF e não pode ser gravado.' using errcode = '22023';
  end if;

  if p ? 'arquivo_nome' and jsonb_typeof(p -> 'arquivo_nome') not in ('string', 'null') then
    raise exception 'Campo arquivo_nome deve ser texto ou nulo.' using errcode = '22023';
  end if;
  v_arquivo_nome := case
    when jsonb_typeof(p -> 'arquivo_nome') = 'string' then nullif(btrim(p ->> 'arquivo_nome', E' \t\n\r'), '')
    else null
  end;

  if jsonb_typeof(p -> 'formato') is distinct from 'string' then
    raise exception 'Campo formato é obrigatório.' using errcode = '22023';
  end if;
  v_formato := lower(btrim(p ->> 'formato', E' \t\n\r'));
  if v_formato not in ('pdf', 'docx') then
    raise exception 'Campo formato inválido.' using errcode = '22023';
  end if;
  if v_tipo = 'balancete' and v_formato <> 'pdf' then
    raise exception 'Documento do tipo balancete exige formato pdf.' using errcode = '22023';
  end if;

  if v_formato = 'docx' then
    if p ? 'paginas' and jsonb_typeof(p -> 'paginas') <> 'null' then
      raise exception 'Documento docx deve ter paginas nulo.' using errcode = '22023';
    end if;
    v_paginas := null;
  else
    if jsonb_typeof(p -> 'paginas') is distinct from 'number' then
      raise exception 'Documento pdf exige paginas inteiro >= 1.' using errcode = '22023';
    end if;
    v_paginas_num := (p ->> 'paginas')::numeric;
    if v_paginas_num <> trunc(v_paginas_num) or v_paginas_num < 1 or v_paginas_num > 2147483647 then
      raise exception 'Campo paginas deve ser inteiro >= 1.' using errcode = '22023';
    end if;
    v_paginas := v_paginas_num::integer;
  end if;

  if jsonb_typeof(p -> 'parser') is distinct from 'string' then
    raise exception 'Campo parser é obrigatório.' using errcode = '22023';
  end if;
  v_parser := nullif(btrim(p ->> 'parser', E' \t\n\r'), '');
  if v_parser is null then
    raise exception 'Campo parser não pode ser vazio.' using errcode = '22023';
  end if;

  if jsonb_typeof(p -> 'parser_versao') is distinct from 'string' then
    raise exception 'Campo parser_versao é obrigatório.' using errcode = '22023';
  end if;
  v_parser_versao := nullif(btrim(p ->> 'parser_versao', E' \t\n\r'), '');
  if v_parser_versao is null then
    raise exception 'Campo parser_versao não pode ser vazio.' using errcode = '22023';
  end if;

  if jsonb_typeof(p -> 'origem') is distinct from 'string' then
    raise exception 'Campo origem é obrigatório.' using errcode = '22023';
  end if;
  v_origem := btrim(p ->> 'origem', E' \t\n\r');
  if v_origem not in ('backfill', 'site', 'ingestao') then
    raise exception 'Campo origem inválido.' using errcode = '22023';
  end if;

  if not (p ? 'fatos') or jsonb_typeof(p -> 'fatos') = 'null' then
    v_fatos_arr := '[]'::jsonb;
  elsif jsonb_typeof(p -> 'fatos') = 'array' then
    v_fatos_arr := p -> 'fatos';
  else
    raise exception 'Campo fatos deve ser um array JSON.' using errcode = '22023';
  end if;

  for v_f in
    select el.elem, el.ord
      from jsonb_array_elements(v_fatos_arr) with ordinality as el(elem, ord)
  loop
    if jsonb_typeof(v_f.elem) <> 'object' then
      raise exception 'Cada fato deve ser um objeto JSON.' using errcode = '22023';
    end if;

    select string_agg(k, ', ' order by k)
      into v_f_chaves_inv
      from jsonb_object_keys(v_f.elem) as k
     where k not in ('alvo_tabela', 'alvo_id', 'campo', 'valor', 'pagina', 'trecho', 'bbox');

    if v_f_chaves_inv is not null then
      raise exception 'Campos não permitidos em fato: %', v_f_chaves_inv using errcode = '22023';
    end if;

    if jsonb_typeof(v_f.elem -> 'alvo_tabela') is distinct from 'string'
       or jsonb_typeof(v_f.elem -> 'campo') is distinct from 'string' then
      raise exception 'Campos alvo_tabela e campo são obrigatórios em cada fato.' using errcode = '22023';
    end if;

    v_f_tabela := btrim(v_f.elem ->> 'alvo_tabela', E' \t\n\r');
    v_f_campo  := btrim(v_f.elem ->> 'campo', E' \t\n\r');

    if not (
      (v_tipo = 'balancete' and v_f_tabela in ('balancetes', 'balancete_lancamentos'))
      or (v_tipo = 'plano' and v_f_tabela in ('planos_trabalho', 'plano_rubricas', 'plano_desembolsos'))
    ) then
      raise exception 'Tabela alvo % incompatível com documento do tipo %.', v_f_tabela, v_tipo
        using errcode = '22023';
    end if;

    if not (
      (v_f_tabela = 'balancetes'            and v_f_campo in ('saldo_disponivel', 'rendimento_liquido', 'total_debitos', 'total_creditos'))
      or (v_f_tabela = 'balancete_lancamentos' and v_f_campo in ('saldo_atual', 'valor_debito', 'valor_credito'))
      or (v_f_tabela = 'planos_trabalho'       and v_f_campo in ('valor_total_plano'))
      or (v_f_tabela = 'plano_rubricas'        and v_f_campo in ('valor_previsto'))
      or (v_f_tabela = 'plano_desembolsos'     and v_f_campo in ('valor'))
    ) then
      raise exception 'Campo % não é aceito para a tabela %.', v_f_campo, v_f_tabela
        using errcode = '22023';
    end if;

    if jsonb_typeof(v_f.elem -> 'alvo_id') is distinct from 'string' then
      raise exception 'Campo alvo_id é obrigatório em cada fato.' using errcode = '22023';
    end if;
    v_f_id_txt := nullif(btrim(v_f.elem ->> 'alvo_id', E' \t\n\r'), '');
    if v_f_id_txt is null
       or v_f_id_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Campo alvo_id inválido em fato.' using errcode = '22023';
    end if;

    if jsonb_typeof(v_f.elem -> 'valor') is distinct from 'number' then
      raise exception 'Campo valor do fato deve ser numérico.' using errcode = '22023';
    end if;

    if jsonb_typeof(v_f.elem -> 'trecho') is distinct from 'string' then
      raise exception 'Campo trecho é obrigatório em cada fato.' using errcode = '22023';
    end if;
    v_f_trecho := v_f.elem ->> 'trecho';
    if char_length(v_f_trecho) < 1 or char_length(v_f_trecho) > 500
       or btrim(v_f_trecho, E' \t\n\r') = '' then
      raise exception 'Campo trecho do fato deve ter entre 1 e 500 caracteres não vazios.'
        using errcode = '22023';
    end if;

    if public._tem_cpf(v_f_trecho) then
      raise exception 'Trecho do fato contém CPF e não pode ser gravado.' using errcode = '22023';
    end if;

    if v_formato = 'docx' then
      if v_f.elem ? 'pagina' and jsonb_typeof(v_f.elem -> 'pagina') <> 'null' then
        raise exception 'Fato de documento docx exige pagina nula.' using errcode = '22023';
      end if;
      if v_f.elem ? 'bbox' and jsonb_typeof(v_f.elem -> 'bbox') <> 'null' then
        raise exception 'Fato de documento docx exige bbox nulo.' using errcode = '22023';
      end if;
    else
      v_f_has_pag := v_f.elem ? 'pagina' and jsonb_typeof(v_f.elem -> 'pagina') <> 'null';
      if v_f_has_pag then
        if jsonb_typeof(v_f.elem -> 'pagina') <> 'number' then
          raise exception 'Campo pagina do fato deve ser inteiro >= 1.' using errcode = '22023';
        end if;
        v_f_pag_num := (v_f.elem ->> 'pagina')::numeric;
        if v_f_pag_num <> trunc(v_f_pag_num) or v_f_pag_num < 1 or v_f_pag_num > 2147483647 then
          raise exception 'Campo pagina do fato deve ser inteiro >= 1.' using errcode = '22023';
        end if;
        if v_f_pag_num > v_paginas then
          raise exception 'Campo pagina do fato excede total de páginas do documento.' using errcode = '22023';
        end if;
      end if;

      if v_f.elem ? 'bbox' and jsonb_typeof(v_f.elem -> 'bbox') <> 'null' then
        if not v_f_has_pag then
          raise exception 'Fato com bbox exige pagina preenchida.' using errcode = '22023';
        end if;
        v_f_bbox := v_f.elem -> 'bbox';
        if jsonb_typeof(v_f_bbox) <> 'object'
           or not (v_f_bbox ?& array['x0', 'x1', 'yMin', 'yMax'])
           or (v_f_bbox - array['x0', 'x1', 'yMin', 'yMax']) <> '{}'::jsonb
           or jsonb_typeof(v_f_bbox -> 'x0') <> 'number'
           or jsonb_typeof(v_f_bbox -> 'x1') <> 'number'
           or jsonb_typeof(v_f_bbox -> 'yMin') <> 'number'
           or jsonb_typeof(v_f_bbox -> 'yMax') <> 'number' then
          raise exception 'Campo bbox inválido em fato.' using errcode = '22023';
        end if;
        if (v_f_bbox ->> 'x0')::numeric > (v_f_bbox ->> 'x1')::numeric
           or (v_f_bbox ->> 'yMin')::numeric > (v_f_bbox ->> 'yMax')::numeric then
          raise exception 'Campo bbox inválido em fato.' using errcode = '22023';
        end if;
      end if;
    end if;
  end loop;

  if public._tem_cpf(v_titulo)
     or (v_arquivo_nome is not null and public._tem_cpf(v_arquivo_nome))
     or public._tem_cpf(v_parser)
     or public._tem_cpf(v_parser_versao) then
    raise exception 'Metadados do documento contêm CPF e não podem ser gravados.' using errcode = '22023';
  end if;

  select string_agg(el.elem ->> 'trecho', ' ' order by el.ord)
    into v_trechos_cat
    from jsonb_array_elements(v_fatos_arr) with ordinality as el(elem, ord);

  if public._tem_cpf(concat_ws(' ', v_cam_rel, v_titulo, v_arquivo_nome, v_trechos_cat)) then
    raise exception 'Conteúdo do documento contém CPF e não pode ser gravado.' using errcode = '22023';
  end if;

  select d.id, d.project_id, d.tipo
    into v_doc_id, v_doc_proj, v_doc_tipo
    from public.documentos d
   where d.chave = v_chave
     for update;

  if not found then
    insert into public.documentos (project_id, tipo, chave, titulo)
    values (v_project_id, v_tipo, v_chave, v_titulo)
    on conflict (chave) do nothing
    returning id into v_doc_id;

    if v_doc_id is null then
      select d.id, d.project_id, d.tipo
        into v_doc_id, v_doc_proj, v_doc_tipo
        from public.documentos d
       where d.chave = v_chave
         for update;
    else
      v_doc_proj := v_project_id;
      v_doc_tipo := v_tipo;
    end if;
  end if;

  if v_doc_proj is distinct from v_project_id or v_doc_tipo is distinct from v_tipo then
    raise exception 'Conflito de chave: documento existente pertence a outro projeto ou tipo.'
      using errcode = '22023';
  end if;

  select dv.id, dv.versao
    into v_versao_id, v_versao
    from public.documento_versoes dv
   where dv.documento_id = v_doc_id
     and dv.sha256 = v_sha256;

  if found then
    return jsonb_build_object(
      'documento_id', v_doc_id,
      'versao_id',    v_versao_id,
      'versao',       v_versao,
      'criada',       false,
      'fatos',        0
    );
  end if;

  update public.documentos
     set titulo = v_titulo
   where id = v_doc_id
     and titulo is distinct from v_titulo;

  select coalesce(max(dv.versao), 0) + 1
    into v_versao
    from public.documento_versoes dv
   where dv.documento_id = v_doc_id;

  begin
    insert into public.documento_versoes (
      documento_id, versao, sha256, bucket, caminho, arquivo_nome,
      formato, paginas, parser, parser_versao, origem, registrado_por
    ) values (
      v_doc_id, v_versao, v_sha256, v_bucket, v_caminho, v_arquivo_nome,
      v_formato, v_paginas, v_parser, v_parser_versao, v_origem, auth.uid()
    )
    returning id into v_versao_id;
  exception when unique_violation then
    raise exception 'Conflito ao gravar a versão % do documento; tente novamente.', v_versao
      using errcode = '40001';
  end;

  for v_f in
    select el.elem, el.ord
      from jsonb_array_elements(v_fatos_arr) with ordinality as el(elem, ord)
  loop
    v_f_tabela := btrim(v_f.elem ->> 'alvo_tabela', E' \t\n\r');
    v_f_id     := btrim(v_f.elem ->> 'alvo_id', E' \t\n\r')::uuid;
    v_f_campo  := btrim(v_f.elem ->> 'campo', E' \t\n\r');
    v_f_valor  := round((v_f.elem ->> 'valor')::numeric, 2);
    v_f_pagina := case
                    when v_formato = 'docx' then null
                    when v_f.elem ? 'pagina' and jsonb_typeof(v_f.elem -> 'pagina') = 'number'
                      then (v_f.elem ->> 'pagina')::integer
                    else null
                  end;
    v_f_trecho := v_f.elem ->> 'trecho';
    v_f_bbox   := case
                    when v_formato = 'docx' then null
                    when v_f.elem ? 'bbox' and jsonb_typeof(v_f.elem -> 'bbox') = 'object'
                      then v_f.elem -> 'bbox'
                    else null
                  end;

    v_alvo_proj   := null;
    v_alvo_pai_id := null;
    v_alvo_chave  := null;
    v_alvo_data   := null;
    v_atual       := null;

    if v_f_tabela = 'balancetes' then
      select b.project_id,
             b.id,
             '',
             case v_f_campo
               when 'saldo_disponivel'   then b.saldo_disponivel
               when 'rendimento_liquido' then b.rendimento_liquido
               when 'total_debitos'      then b.total_debitos
               when 'total_creditos'     then b.total_creditos
             end,
             b.data_referencia
        into v_alvo_proj, v_alvo_pai_id, v_alvo_chave, v_atual, v_alvo_data
        from public.balancetes b
       where b.id = v_f_id;
    elsif v_f_tabela = 'balancete_lancamentos' then
      select b.project_id,
             bl.balancete_id,
             bl.conta_codigo,
             case v_f_campo
               when 'saldo_atual'   then bl.saldo_atual
               when 'valor_debito'  then bl.valor_debito
               when 'valor_credito' then bl.valor_credito
             end,
             b.data_referencia
        into v_alvo_proj, v_alvo_pai_id, v_alvo_chave, v_atual, v_alvo_data
        from public.balancete_lancamentos bl
        join public.balancetes b on b.id = bl.balancete_id
       where bl.id = v_f_id;
    elsif v_f_tabela = 'planos_trabalho' then
      select pt.project_id, pt.id, '', pt.valor_total_plano, null::date
        into v_alvo_proj, v_alvo_pai_id, v_alvo_chave, v_atual, v_alvo_data
        from public.planos_trabalho pt
       where pt.id = v_f_id;
    elsif v_f_tabela = 'plano_rubricas' then
      select pt.project_id,
             pr.plano_id,
             pr.rubrica_code || '|' || coalesce(pr.descricao_livre, ''),
             pr.valor_previsto,
             null::date
        into v_alvo_proj, v_alvo_pai_id, v_alvo_chave, v_atual, v_alvo_data
        from public.plano_rubricas pr
        join public.planos_trabalho pt on pt.id = pr.plano_id
       where pr.id = v_f_id;
    elsif v_f_tabela = 'plano_desembolsos' then
      select pt.project_id, pd.plano_id, pd.parcela::text, pd.valor, null::date
        into v_alvo_proj, v_alvo_pai_id, v_alvo_chave, v_atual, v_alvo_data
        from public.plano_desembolsos pd
        join public.planos_trabalho pt on pt.id = pd.plano_id
       where pd.id = v_f_id;
    end if;

    if not found then
      raise exception 'Alvo não encontrado: %.%', v_f_tabela, v_f_id using errcode = '22023';
    end if;

    if v_alvo_proj is distinct from v_project_id then
      raise exception 'Alvo %.% pertence a outro centro de custo.', v_f_tabela, v_f_id
        using errcode = '22023';
    end if;

    if v_tipo = 'balancete' and v_alvo_data is distinct from v_chave_data then
      raise exception 'Alvo %.% é de balancete (%) diferente da data da chave (%).',
        v_f_tabela, v_f_id, coalesce(to_char(v_alvo_data, 'YYYY-MM-DD'), 'null'), v_chave_data_txt
        using errcode = '22023';
    end if;

    if v_tipo = 'plano' and v_alvo_pai_id is distinct from v_chave_plano_id then
      raise exception 'Alvo %.% pertence ao plano % e não ao plano % da chave.',
        v_f_tabela, v_f_id, v_alvo_pai_id, v_chave_plano_id
        using errcode = '22023';
    end if;

    if v_f_tabela = 'plano_rubricas' then
      select count(*)
        into v_dup_cnt
        from public.plano_rubricas pr2
       where pr2.plano_id = v_alvo_pai_id
         and (pr2.rubrica_code || '|' || coalesce(pr2.descricao_livre, '')) = v_alvo_chave;
      if v_dup_cnt > 1 then
        raise exception 'Linha ambígua no plano (% linhas para %); não é possível identificar a origem com segurança.',
          v_dup_cnt, v_alvo_chave
          using errcode = '22023';
      end if;
    end if;

    if v_atual is null or v_atual is distinct from v_f_valor then
      v_divergencias := v_divergencias || jsonb_build_array(jsonb_build_object(
        'tabela',   v_f_tabela,
        'id',       v_f_id,
        'campo',    v_f_campo,
        'esperado', v_atual,
        'lido',     v_f_valor
      ));
      continue;
    end if;

    begin
      insert into public.fatos (
        versao_id, alvo_tabela, alvo_pai_id, alvo_chave, campo,
        valor, pagina, trecho, bbox
      ) values (
        v_versao_id, v_f_tabela, v_alvo_pai_id, v_alvo_chave, v_f_campo,
        v_f_valor, v_f_pagina, v_f_trecho, v_f_bbox
      );
    exception when unique_violation then
      raise exception 'Fato duplicado no payload para % (%) campo %.', v_f_tabela, v_f_id, v_f_campo
        using errcode = '22023';
    end;

    v_qtd_fatos := v_qtd_fatos + 1;
  end loop;

  if jsonb_array_length(v_divergencias) > 0 then
    raise exception 'Fatos divergem dos valores gravados no banco (% divergência(s)).',
      jsonb_array_length(v_divergencias)
      using errcode = '22023', detail = v_divergencias::text;
  end if;

  return jsonb_build_object(
    'documento_id', v_doc_id,
    'versao_id',    v_versao_id,
    'versao',       v_versao,
    'criada',       true,
    'fatos',        v_qtd_fatos
  );
end;
$$;

comment on function public.registrar_documento_v2(jsonb) is
  'Registra documento, versão (dedup por sha256) e fatos conferidos contra o banco, exigindo chave canônica e bloqueando CPF (só admin, migs. 064/065).';

revoke all on function public.registrar_documento_v2(jsonb) from public, anon;
grant execute on function public.registrar_documento_v2(jsonb) to authenticated;

-- get_origem_v2: alvo nulo de não-admin devolve o mesmo 42501 de alvo alheio/inexistente (item 7).

create or replace function public.get_origem_v2(
  p_alvo_tabela text,
  p_alvo_id     uuid,
  p_campo       text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tabela     text;
  v_campo      text;
  v_project_id uuid;
  v_mascarar   boolean;
  v_res        jsonb;
begin
  if p_alvo_tabela is null or p_alvo_id is null or p_campo is null then
    if public.is_admin() then
      raise exception 'alvo_tabela, alvo_id e campo são obrigatórios.' using errcode = '22023';
    else
      raise exception 'Acesso negado ao alvo.' using errcode = '42501';
    end if;
  end if;

  v_tabela := btrim(p_alvo_tabela, E' \t\n\r');
  v_campo  := btrim(p_campo, E' \t\n\r');

  if not (
    (v_tabela = 'balancetes'            and v_campo in ('saldo_disponivel', 'rendimento_liquido', 'total_debitos', 'total_creditos'))
    or (v_tabela = 'balancete_lancamentos' and v_campo in ('saldo_atual', 'valor_debito', 'valor_credito'))
    or (v_tabela = 'planos_trabalho'       and v_campo in ('valor_total_plano'))
    or (v_tabela = 'plano_rubricas'        and v_campo in ('valor_previsto'))
    or (v_tabela = 'plano_desembolsos'     and v_campo in ('valor'))
    or (v_tabela = 'scholarships'          and v_campo in ('amount'))
  ) then
    raise exception 'Alvo ou campo não suportado em get_origem_v2.' using errcode = '22023';
  end if;

  if v_tabela = 'balancetes' then
    select b.project_id into v_project_id from public.balancetes b where b.id = p_alvo_id;
  elsif v_tabela = 'balancete_lancamentos' then
    select b.project_id into v_project_id
      from public.balancete_lancamentos bl
      join public.balancetes b on b.id = bl.balancete_id
     where bl.id = p_alvo_id;
  elsif v_tabela = 'planos_trabalho' then
    select pt.project_id into v_project_id from public.planos_trabalho pt where pt.id = p_alvo_id;
  elsif v_tabela = 'plano_rubricas' then
    select pt.project_id into v_project_id
      from public.plano_rubricas pr
      join public.planos_trabalho pt on pt.id = pr.plano_id
     where pr.id = p_alvo_id;
  elsif v_tabela = 'plano_desembolsos' then
    select pt.project_id into v_project_id
      from public.plano_desembolsos pd
      join public.planos_trabalho pt on pt.id = pd.plano_id
     where pd.id = p_alvo_id;
  elsif v_tabela = 'scholarships' then
    select s.project_id into v_project_id from public.scholarships s where s.id = p_alvo_id;
  end if;

  if not public.is_admin() then
    if not found or v_project_id is null or not (v_project_id = any(public.allowed_project_ids())) then
      raise exception 'Acesso negado ao alvo.' using errcode = '42501';
    end if;
  elsif not found or v_project_id is null then
    raise exception 'Alvo não encontrado.' using errcode = 'P0002';
  end if;

  perform public.assert_project_allowed(v_project_id);

  v_mascarar := (not public.is_admin()) or public.is_agente();
  v_res := public._resolver_origem_alvo(v_tabela, p_alvo_id, v_campo, v_mascarar);
  if v_res is null then
    raise exception 'Alvo não encontrado.' using errcode = 'P0002';
  end if;

  return v_res;
end;
$$;

comment on function public.get_origem_v2(text, uuid, text) is
  'Devolve a origem de um valor (documento, legado ou digitado) sem oráculo de existência e com máscara de CPF para não-admin/agente (migs. 064/065).';

revoke all on function public.get_origem_v2(text, uuid, text) from public, anon;
grant execute on function public.get_origem_v2(text, uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 2. Origem em lote (item 5): uma consulta por tabela, mesma regra.
-- ------------------------------------------------------------

create or replace function public._resolver_origens_v2(p_alvos jsonb, p_mascarar boolean)
returns table (alvo_tabela text, alvo_id uuid, campo text, origem jsonb)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
with pedido as (
  select e.elem ->> 'alvo_tabela' as alvo_tabela,
         nullif(btrim(e.elem ->> 'alvo_id', E' \t\n\r'), '')::uuid as alvo_id,
         e.elem ->> 'campo' as campo
    from jsonb_array_elements(
      case when jsonb_typeof(coalesce(p_alvos, '[]'::jsonb)) = 'array'
           then coalesce(p_alvos, '[]'::jsonb) else '[]'::jsonb end
    ) as e(elem)
),
amb as (
  -- Chave estável da linha: mesma expressão da origem e do subselect antigo.
  select pr2.plano_id,
         pr2.rubrica_code,
         coalesce(pr2.descricao_livre, '') as desc_key,
         count(*) as n
    from public.plano_rubricas pr2
   group by pr2.plano_id, pr2.rubrica_code, coalesce(pr2.descricao_livre, '')
),
alvo as (
  select 'balancetes'::text as alvo_tabela, p.alvo_id, p.campo,
         b.project_id, b.id as pai, ''::text as chave,
         case p.campo
           when 'saldo_disponivel' then b.saldo_disponivel
           when 'rendimento_liquido' then b.rendimento_liquido
           when 'total_debitos' then b.total_debitos
           when 'total_creditos' then b.total_creditos
         end as valor,
         'balancete'::text as doc_tipo,
         'balancete-pdfs'::text as bucket,
         b.arquivo_storage_path as storage_path,
         b.arquivo_nome,
         b.data_referencia as data_ref,
         null::integer as plano_versao,
         jsonb_strip_nulls(jsonb_build_object(
           'texto', case p.campo
             when 'saldo_disponivel' then 'saldo disponivel'
             when 'rendimento_liquido' then 'rendimento liquido'
             when 'total_debitos' then 'total de debitos'
             when 'total_creditos' then 'total de creditos'
           end,
           'valor', case p.campo
             when 'saldo_disponivel' then b.saldo_disponivel
             when 'rendimento_liquido' then b.rendimento_liquido
             when 'total_debitos' then b.total_debitos
             when 'total_creditos' then b.total_creditos
           end
         )) as busca,
         false as ambigua,
         null::text as nota_fixa
    from pedido p
    join public.balancetes b on b.id = p.alvo_id
   where p.alvo_tabela = 'balancetes'

  union all

  select 'balancete_lancamentos', p.alvo_id, p.campo,
         b.project_id, bl.balancete_id, bl.conta_codigo,
         case p.campo
           when 'saldo_atual' then bl.saldo_atual
           when 'valor_debito' then bl.valor_debito
           when 'valor_credito' then bl.valor_credito
         end,
         'balancete', 'balancete-pdfs', b.arquivo_storage_path, b.arquivo_nome,
         b.data_referencia, null::integer,
         jsonb_strip_nulls(jsonb_build_object(
           'conta_codigo', bl.conta_codigo,
           'valor', case p.campo
             when 'saldo_atual' then bl.saldo_atual
             when 'valor_debito' then bl.valor_debito
             when 'valor_credito' then bl.valor_credito
           end
         )),
         false, null::text
    from pedido p
    join public.balancete_lancamentos bl on bl.id = p.alvo_id
    join public.balancetes b on b.id = bl.balancete_id
   where p.alvo_tabela = 'balancete_lancamentos'

  union all

  select 'planos_trabalho', p.alvo_id, p.campo,
         pt.project_id, pt.id, ''::text,
         pt.valor_total_plano,
         'plano', 'plano-trabalho-docs', pt.arquivo_storage_path, pt.arquivo_nome,
         null::date, pt.versao,
         jsonb_strip_nulls(jsonb_build_object('texto', 'valor total', 'valor', pt.valor_total_plano)),
         false, null::text
    from pedido p
    join public.planos_trabalho pt on pt.id = p.alvo_id
   where p.alvo_tabela = 'planos_trabalho'

  union all

  select 'plano_rubricas', p.alvo_id, p.campo,
         pt.project_id, pr.plano_id,
         pr.rubrica_code || '|' || coalesce(pr.descricao_livre, ''),
         pr.valor_previsto,
         'plano', 'plano-trabalho-docs', pt.arquivo_storage_path, pt.arquivo_nome,
         null::date, pt.versao,
         jsonb_strip_nulls(jsonb_build_object(
           'texto', case when p_mascarar
             then public._mascarar_cpf(coalesce(nullif(btrim(pr.descricao_livre, E' \t\n\r"'), ''), r.name))
             else coalesce(nullif(btrim(pr.descricao_livre, E' \t\n\r"'), ''), r.name) end,
           'valor', pr.valor_previsto
         )),
         (coalesce(amb.n, 0) > 1),
         null::text
    from pedido p
    join public.plano_rubricas pr on pr.id = p.alvo_id
    join public.planos_trabalho pt on pt.id = pr.plano_id
    join public.rubricas r on r.code = pr.rubrica_code
    left join amb
      on amb.plano_id = pr.plano_id
     and amb.rubrica_code = pr.rubrica_code
     and amb.desc_key = coalesce(pr.descricao_livre, '')
   where p.alvo_tabela = 'plano_rubricas'

  union all

  select 'plano_desembolsos', p.alvo_id, p.campo,
         pt.project_id, pd.plano_id, pd.parcela::text,
         pd.valor,
         'plano', 'plano-trabalho-docs', pt.arquivo_storage_path, pt.arquivo_nome,
         null::date, pt.versao,
         jsonb_strip_nulls(jsonb_build_object('texto', 'Parcela ' || pd.parcela::text, 'valor', pd.valor)),
         false, null::text
    from pedido p
    join public.plano_desembolsos pd on pd.id = p.alvo_id
    join public.planos_trabalho pt on pt.id = pd.plano_id
   where p.alvo_tabela = 'plano_desembolsos'

  union all

  select 'scholarships', p.alvo_id, p.campo,
         s.project_id, null::uuid, null::text,
         s.amount,
         null::text, null::text, null::text, null::text,
         null::date, null::integer, null::jsonb, false,
         'Valor mensal do cadastro de bolsas (planilha da FUNAPE), sem documento por linha até a F3; na árvore do livre aparece o total dos meses da janela.'
    from pedido p
    join public.scholarships s on s.id = p.alvo_id
   where p.alvo_tabela = 'scholarships'
),
fato as (
  select distinct on (a.alvo_tabela, a.pai, a.chave, a.campo)
         a.alvo_tabela, a.pai, a.chave, a.campo,
         f.valor as fato_valor, f.pagina, f.trecho, f.bbox,
         d.id as doc_id, d.tipo as doc_tipo_fato, d.titulo as doc_titulo,
         dv.arquivo_nome as doc_arquivo_nome, dv.formato as doc_formato,
         dv.bucket as doc_bucket, dv.caminho as doc_caminho,
         dv.versao as doc_versao, dv.registrado_em as doc_registrado_em,
         dv.parser, dv.parser_versao
    from alvo a
    join public.fatos f
      on f.alvo_tabela = a.alvo_tabela
     and f.alvo_pai_id = a.pai
     and f.alvo_chave = a.chave
     and f.campo = a.campo
    join public.documento_versoes dv on dv.id = f.versao_id
    join public.documentos d on d.id = dv.documento_id
   where a.nota_fixa is null
     and a.pai is not null
     and d.project_id = a.project_id
   order by a.alvo_tabela, a.pai, a.chave, a.campo,
            dv.registrado_em desc, dv.versao desc, dv.id desc
)
select p.alvo_tabela, p.alvo_id, p.campo,
       case
         when a.alvo_tabela is null then null
         when a.nota_fixa is not null then
           jsonb_build_object('tipo', 'digitado', 'valor', a.valor,
                              'documento', null, 'fato', null, 'busca', null, 'nota', a.nota_fixa)
         when a.ambigua then
           jsonb_build_object('tipo', 'legado', 'valor', a.valor, 'documento', ld.doc,
                              'fato', null, 'busca', a.busca, 'nota', 'linha ambígua no plano')
         when fa.alvo_tabela is not null then
           case when a.valor is not null and round(a.valor, 2) = round(fa.fato_valor, 2) then
             jsonb_build_object(
               'tipo', 'documento', 'valor', a.valor, 'documento', fd.doc,
               'fato', jsonb_build_object(
                 'pagina', fa.pagina,
                 'trecho', case when p_mascarar then public._mascarar_cpf(fa.trecho) else fa.trecho end,
                 'bbox', fa.bbox, 'parser', fa.parser, 'parser_versao', fa.parser_versao),
               'busca', null, 'nota', null)
           else
             jsonb_build_object(
               'tipo', 'legado', 'valor', a.valor, 'documento', fd.doc, 'fato', null,
               'busca', a.busca,
               'nota', 'o valor mudou depois da leitura do documento (lido R$ ' || public._fmt_brl_num(fa.fato_valor) || ')')
           end
         else
           jsonb_build_object('tipo', 'legado', 'valor', a.valor, 'documento', ld.doc,
                              'fato', null, 'busca', a.busca, 'nota', null)
       end
  from pedido p
  left join alvo a
    on a.alvo_tabela = p.alvo_tabela and a.alvo_id = p.alvo_id and a.campo = p.campo
  left join fato fa
    on fa.alvo_tabela = p.alvo_tabela and fa.pai = a.pai
   and fa.chave = a.chave and fa.campo = p.campo
  left join lateral (
    select jsonb_build_object(
      'id', fa.doc_id, 'tipo', fa.doc_tipo_fato,
      'titulo', case when p_mascarar then public._mascarar_cpf(fa.doc_titulo) else fa.doc_titulo end,
      'arquivo_nome', case when p_mascarar then public._mascarar_cpf(fa.doc_arquivo_nome) else fa.doc_arquivo_nome end,
      'formato', fa.doc_formato, 'bucket', fa.doc_bucket,
      'caminho', case when p_mascarar and public._tem_cpf(fa.doc_caminho) then null
                      else fa.doc_caminho end,
      'versao', fa.doc_versao, 'registrado_em', fa.doc_registrado_em
    )
    || case when p_mascarar and public._tem_cpf(fa.doc_caminho)
            then jsonb_build_object('nota', 'arquivo com nome que parece CPF: peça ao admin')
            else '{}'::jsonb end as doc
  ) fd on fa.alvo_tabela is not null
  left join lateral (
    select case
      when nullif(btrim(a.storage_path, E' \t\n\r'), '') is not null then
        jsonb_build_object(
          'id', null, 'tipo', a.doc_tipo,
          'titulo', case
            when a.doc_tipo = 'balancete' then
              case when a.data_ref is not null
                then 'Balancete de ' ||
                     (array['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'])[extract(month from a.data_ref)::integer] ||
                     '/' || to_char(a.data_ref, 'YY')
                else 'Balancete' end
            else 'Plano de trabalho v' || coalesce(a.plano_versao::text, '0')
          end,
          'arquivo_nome', case when p_mascarar
            then public._mascarar_cpf(coalesce(nullif(btrim(a.arquivo_nome, E' \t\n\r'), ''),
                                               nullif(regexp_replace(a.storage_path, '^.*/', ''), '')))
            else coalesce(nullif(btrim(a.arquivo_nome, E' \t\n\r'), ''),
                          nullif(regexp_replace(a.storage_path, '^.*/', ''), '')) end,
          'formato', case when lower(a.storage_path) ~ '\.pdf$' then 'pdf'
                          when lower(a.storage_path) ~ '\.docx$' then 'docx'
                          when a.doc_tipo = 'balancete' then 'pdf' else 'docx' end,
          'bucket', a.bucket,
          'caminho', case when p_mascarar and public._tem_cpf(a.storage_path) then null
                          else a.storage_path end,
          'versao', null, 'registrado_em', null
        )
        || case when p_mascarar and public._tem_cpf(a.storage_path)
                then jsonb_build_object('nota', 'arquivo com nome que parece CPF: peça ao admin')
                else '{}'::jsonb end
      else null
    end as doc
  ) ld on a.alvo_tabela is not null and (fa.alvo_tabela is null or a.ambigua);
$$;

comment on function public._resolver_origens_v2(jsonb, boolean) is
  'Resolve origem (documento/legado/digitado) de um conjunto de alvos com a mesma regra de get_origem_v2, em uma consulta por tabela (mig. 065).';

revoke all on function public._resolver_origens_v2(jsonb, boolean) from public, anon, authenticated;

create or replace function public._resolver_origem_alvo(
  p_alvo_tabela text, p_alvo_id uuid, p_campo text, p_mascarar boolean
) returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o.origem
    from public._resolver_origens_v2(
      jsonb_build_array(jsonb_build_object(
        'alvo_tabela', p_alvo_tabela, 'alvo_id', p_alvo_id, 'campo', p_campo)),
      p_mascarar
    ) as o
   limit 1;
$$;

comment on function public._resolver_origem_alvo(text, uuid, text, boolean) is
  'Invólucro de um alvo sobre _resolver_origens_v2; a regra de origem é uma só (mig. 065).';

revoke all on function public._resolver_origem_alvo(text, uuid, text, boolean) from public, anon, authenticated;

create or replace function public.explicar_livre_v2(p_project_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_sl jsonb; v_has_plano boolean; v_has_balancete boolean; v_data_ref text; v_motivo text; v_mascarar boolean;
  v_balancete_id uuid; v_plano_id uuid; v_grupos jsonb; v_rubricas jsonb; v_bolsas jsonb;
  v_livre_total numeric; v_partes_grupos jsonb := '[]'::jsonb;
  v_alvos_prev jsonb; v_alvos_real jsonb; v_alvos_comp jsonb;
  v_origens_prev jsonb := '{}'::jsonb; v_origens_real jsonb := '{}'::jsonb; v_origens_comp jsonb := '{}'::jsonb;
  v_g jsonb; v_g_code text; v_g_name text; v_g_saldo numeric; v_g_cob text; v_g_partes jsonb;
  v_r jsonb; v_r_code text; v_r_name text; v_r_prev numeric; v_r_real numeric; v_r_comp numeric;
  v_prev_folhas jsonb; v_real_folhas jsonb; v_comp_folhas jsonb;
begin
  if p_project_id is null then raise exception 'project_id é obrigatório.' using errcode = '22023'; end if;
  perform public.assert_project_allowed(p_project_id);
  v_mascarar := (not public.is_admin()) or public.is_agente();

  v_sl := public.get_saldo_livre(p_project_id);
  v_has_plano := coalesce((v_sl ->> 'has_plano')::boolean, false);
  v_has_balancete := coalesce((v_sl ->> 'has_balancete')::boolean, false);
  v_data_ref := nullif(v_sl ->> 'data_referencia', '');
  v_grupos := coalesce(v_sl -> 'grupos', '[]'::jsonb);

  if not v_has_plano then v_motivo := 'sem plano'; v_data_ref := null;
  elsif not v_has_balancete then v_motivo := 'sem balancete'; v_data_ref := null;
  elsif jsonb_typeof(v_grupos) <> 'array' or jsonb_array_length(v_grupos) = 0 then v_motivo := 'sem números';
  end if;

  if v_motivo is not null then
    return jsonb_build_object(
      'valor', null, 'motivo', v_motivo, 'data_referencia', v_data_ref, 'rotulo', 'Livre para gastar',
      'tipo', 'calculo', 'conta', 'soma dos grupos', 'chave', 'livre', 'sinal', 1, 'ref', null, 'nota', null, 'partes', '[]'::jsonb
    );
  end if;

  v_balancete_id := nullif(v_sl ->> 'balancete_id', '')::uuid;
  v_rubricas := coalesce(v_sl -> 'rubricas', '[]'::jsonb);
  v_bolsas := coalesce(v_sl -> 'bolsas_ativas', '[]'::jsonb);

  select pt.id into v_plano_id from public.planos_trabalho pt
   where pt.project_id = p_project_id and pt.ativo = true order by pt.versao desc limit 1;

  -- 065: os alvos das folhas viram conjuntos; a origem sai em uma consulta por tabela.
  select coalesce(jsonb_agg(jsonb_build_object(
           'alvo_tabela', 'plano_rubricas', 'alvo_id', pr.id, 'campo', 'valor_previsto')), '[]'::jsonb)
    into v_alvos_prev
    from public.plano_rubricas pr
   where pr.plano_id = v_plano_id and pr.valor_previsto <> 0;

  select coalesce(jsonb_agg(jsonb_build_object(
           'alvo_tabela', 'balancete_lancamentos', 'alvo_id', bl.id, 'campo', 'saldo_atual')), '[]'::jsonb)
    into v_alvos_real
    from public.balancete_lancamentos bl
   where bl.balancete_id = v_balancete_id and bl.saldo_atual <> 0;

  select coalesce(jsonb_agg(jsonb_build_object(
           'alvo_tabela', 'scholarships', 'alvo_id', (b.elem ->> 'scholarship_id')::uuid, 'campo', 'amount')), '[]'::jsonb)
    into v_alvos_comp
    from jsonb_array_elements(v_bolsas) as b(elem)
   where coalesce((b.elem ->> 'compromisso')::numeric, 0) <> 0;

  -- 065 (2ª rodada): uma chamada por tabela, fora do laço das rubricas; o resultado
  -- fica indexado por (alvo_tabela, alvo_id, campo) e é consultado a cada folha.
  select coalesce(jsonb_object_agg(
           o.alvo_tabela || '|' || coalesce(o.alvo_id::text, '') || '|' || o.campo, o.origem),
         '{}'::jsonb)
    into v_origens_prev
    from public._resolver_origens_v2(v_alvos_prev, v_mascarar) o;

  select coalesce(jsonb_object_agg(
           o.alvo_tabela || '|' || coalesce(o.alvo_id::text, '') || '|' || o.campo, o.origem),
         '{}'::jsonb)
    into v_origens_real
    from public._resolver_origens_v2(v_alvos_real, v_mascarar) o;

  select coalesce(jsonb_object_agg(
           o.alvo_tabela || '|' || coalesce(o.alvo_id::text, '') || '|' || o.campo, o.origem),
         '{}'::jsonb)
    into v_origens_comp
    from public._resolver_origens_v2(v_alvos_comp, v_mascarar) o;

  for v_g in select value from jsonb_array_elements(v_grupos) loop
    v_g_code := v_g ->> 'grupo_code'; v_g_name := v_g ->> 'grupo_name';
    v_g_saldo := (v_g ->> 'saldo_livre')::numeric; v_g_cob := v_g ->> 'compromissos_cobertura'; v_g_partes := '[]'::jsonb;

    for v_r in select value from jsonb_array_elements(v_rubricas) where value ->> 'grupo_code' = v_g_code loop
      v_r_code := v_r ->> 'rubrica_code'; v_r_name := v_r ->> 'rubrica_name';
      v_r_prev := coalesce((v_r ->> 'previsto')::numeric, 0);
      v_r_real := coalesce((v_r ->> 'realizado')::numeric, 0);
      v_r_comp := coalesce((v_r ->> 'compromissos')::numeric, 0);

      select coalesce(jsonb_agg(jsonb_build_object(
        'rotulo', case when v_mascarar then public._mascarar_cpf(coalesce(nullif(btrim(pr.descricao_livre, E' \t\n\r"'), ''), v_r_name))
                  else coalesce(nullif(btrim(pr.descricao_livre, E' \t\n\r"'), ''), v_r_name) end,
        'valor', pr.valor_previsto,
        'tipo', coalesce(v_origens_prev -> ('plano_rubricas|' || pr.id::text || '|valor_previsto') ->> 'tipo', 'legado'),
        'chave', 'linha:' || pr.id::text,
        'conta', null, 'sinal', 1, 'ref', jsonb_build_object('alvo_tabela', 'plano_rubricas', 'alvo_id', pr.id, 'campo', 'valor_previsto'),
        'nota', case when v_mascarar
                     then public._mascarar_cpf(v_origens_prev -> ('plano_rubricas|' || pr.id::text || '|valor_previsto') ->> 'nota')
                     else v_origens_prev -> ('plano_rubricas|' || pr.id::text || '|valor_previsto') ->> 'nota' end,
        'partes', '[]'::jsonb
      ) order by pr.valor_previsto desc, pr.descricao_livre nulls last, pr.id), '[]'::jsonb)
        into v_prev_folhas
        from public.plano_rubricas pr
       where pr.plano_id = v_plano_id and pr.rubrica_code = v_r_code and pr.valor_previsto <> 0;

      if v_r_prev <> 0 or jsonb_array_length(v_prev_folhas) > 0 then
        v_g_partes := v_g_partes || jsonb_build_array(jsonb_build_object(
          'rotulo', 'Previsto — ' || v_r_name, 'valor', v_r_prev, 'tipo', 'calculo',
          'chave', 'rubrica:' || v_r_code || ':previsto', 'conta', 'soma das linhas do plano',
          'sinal', 1, 'ref', null, 'nota', null, 'partes', v_prev_folhas
        ));
      end if;

      select coalesce(jsonb_agg(jsonb_build_object(
        'rotulo', case when v_mascarar then public._mascarar_cpf(case when nullif(btrim(bl.conta_descricao, E' \t\n\r'), '') is not null then bl.conta_codigo || ' — ' || btrim(bl.conta_descricao, E' \t\n\r') else bl.conta_codigo end)
                  else case when nullif(btrim(bl.conta_descricao, E' \t\n\r'), '') is not null then bl.conta_codigo || ' — ' || btrim(bl.conta_descricao, E' \t\n\r') else bl.conta_codigo end end,
        'valor', bl.saldo_atual,
        'tipo', coalesce(v_origens_real -> ('balancete_lancamentos|' || bl.id::text || '|saldo_atual') ->> 'tipo', 'legado'),
        'chave', 'linha:' || bl.id::text,
        'conta', null, 'sinal', 1, 'ref', jsonb_build_object('alvo_tabela', 'balancete_lancamentos', 'alvo_id', bl.id, 'campo', 'saldo_atual'),
        'nota', case when v_mascarar
                     then public._mascarar_cpf(v_origens_real -> ('balancete_lancamentos|' || bl.id::text || '|saldo_atual') ->> 'nota')
                     else v_origens_real -> ('balancete_lancamentos|' || bl.id::text || '|saldo_atual') ->> 'nota' end,
        'partes', '[]'::jsonb
      ) order by bl.saldo_atual desc, bl.conta_codigo, bl.id), '[]'::jsonb)
        into v_real_folhas
        from public.balancete_lancamentos bl
       where bl.balancete_id = v_balancete_id and bl.rubrica_code = v_r_code and bl.saldo_atual <> 0;

      if v_r_real <> 0 or jsonb_array_length(v_real_folhas) > 0 then
        v_g_partes := v_g_partes || jsonb_build_array(jsonb_build_object(
          'rotulo', 'Realizado — ' || v_r_name, 'valor', v_r_real, 'tipo', 'calculo',
          'chave', 'rubrica:' || v_r_code || ':realizado', 'conta', 'soma das contas do balancete',
          'sinal', -1, 'ref', null, 'nota', null, 'partes', v_real_folhas
        ));
      end if;

      if v_r_code = 'a.bolsas' then
        select coalesce(jsonb_agg(jsonb_build_object(
          'rotulo', case when v_mascarar then public._mascarar_cpf((b.elem ->> 'bolsista') || ' — ' || (b.elem ->> 'meses') || case when (b.elem ->> 'meses')::integer = 1 then ' mês' else ' meses' end || ' × R$ ' || public._fmt_brl_num((b.elem ->> 'valor_mensal')::numeric))
                    else (b.elem ->> 'bolsista') || ' — ' || (b.elem ->> 'meses') || case when (b.elem ->> 'meses')::integer = 1 then ' mês' else ' meses' end || ' × R$ ' || public._fmt_brl_num((b.elem ->> 'valor_mensal')::numeric) end,
          'valor', (b.elem ->> 'compromisso')::numeric,
          'tipo', coalesce(v_origens_comp -> ('scholarships|' || (b.elem ->> 'scholarship_id') || '|amount') ->> 'tipo', 'digitado'),
          'chave', 'linha:' || (b.elem ->> 'scholarship_id'), 'conta', null, 'sinal', 1,
          'ref', jsonb_build_object('alvo_tabela', 'scholarships', 'alvo_id', (b.elem ->> 'scholarship_id')::uuid, 'campo', 'amount'),
          'nota', case when v_mascarar
                       then public._mascarar_cpf(v_origens_comp -> ('scholarships|' || (b.elem ->> 'scholarship_id') || '|amount') ->> 'nota')
                       else v_origens_comp -> ('scholarships|' || (b.elem ->> 'scholarship_id') || '|amount') ->> 'nota' end,
          'partes', '[]'::jsonb
        ) order by (b.elem ->> 'compromisso')::numeric desc, b.ord), '[]'::jsonb)
          into v_comp_folhas
          from jsonb_array_elements(v_bolsas) with ordinality as b(elem, ord)
         where coalesce((b.elem ->> 'compromisso')::numeric, 0) <> 0;

        if v_r_comp <> 0 or jsonb_array_length(v_comp_folhas) > 0 then
          v_g_partes := v_g_partes || jsonb_build_array(jsonb_build_object(
            'rotulo', 'Comprometido — ' || v_r_name, 'valor', v_r_comp, 'tipo', 'calculo',
            'chave', 'rubrica:' || v_r_code || ':comprometido', 'conta', 'soma das bolsas na janela',
            'sinal', -1, 'ref', null, 'nota', null, 'partes', v_comp_folhas
          ));
        end if;
      end if;
    end loop;

    v_partes_grupos := v_partes_grupos || jsonb_build_array(jsonb_build_object(
      'rotulo', v_g_name, 'valor', v_g_saldo, 'tipo', 'calculo', 'chave', 'grupo:' || v_g_code,
      'conta', case when v_g_cob = 'bolsas' then 'previsto − realizado − comprometido' else 'previsto − realizado' end,
      'sinal', 1, 'ref', null,
      'nota', case when v_g_cob = 'nenhuma' then 'compromissos fora de bolsas não são rastreados' else null end,
      'partes', v_g_partes
    ));
  end loop;

  select sum((g ->> 'saldo_livre')::numeric) into v_livre_total
    from jsonb_array_elements(v_grupos) as g where g ->> 'saldo_livre' is not null;

  return jsonb_build_object(
    'valor', v_livre_total, 'motivo', null, 'data_referencia', v_data_ref, 'rotulo', 'Livre para gastar',
    'tipo', 'calculo', 'conta', 'soma dos grupos', 'chave', 'livre', 'sinal', 1, 'ref', null, 'nota', null, 'partes', v_partes_grupos
  );
end;
$$;

comment on function public.explicar_livre_v2(uuid) is
  'Monta a árvore do saldo livre por centro a partir de get_saldo_livre, resolvendo a origem das folhas em lote e mascarando CPF para não-admin/agente (mig. 065).';

revoke all on function public.explicar_livre_v2(uuid) from public, anon;
grant execute on function public.explicar_livre_v2(uuid) to authenticated;

-- criar_pendencia_v2: existente não faz checagem prévia; o gatilho decide (item 4).

create or replace function public.criar_pendencia_v2(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_chaves_invalidas text;
  v_chave            text;
  v_project_id_txt   text;
  v_project_id       uuid;
  v_tipo             text;
  v_titulo           text;
  v_detalhe          jsonb;
  v_origem           text;
  v_id               uuid;
  v_chave_ret        text;
  v_situacao         text;
  v_criada           boolean;
  v_ex_id            uuid;
  v_ex_project_id    uuid;
  v_ex_tipo          text;
begin
  if not public.is_admin() or public.is_agente() then
    raise exception 'Só admin humano cria pendências nesta fase.' using errcode = '42501';
  end if;

  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'Payload deve ser um objeto JSON.' using errcode = '22023';
  end if;

  select string_agg(k, ', ' order by k)
    into v_chaves_invalidas
    from jsonb_object_keys(p) as k
   where k not in ('chave', 'project_id', 'tipo', 'titulo', 'detalhe', 'origem');

  if v_chaves_invalidas is not null then
    raise exception 'Campos não permitidos em criar_pendencia_v2: %', v_chaves_invalidas
      using errcode = '22023';
  end if;

  if jsonb_typeof(p -> 'chave') is distinct from 'string' then
    raise exception 'Campo chave é obrigatório.' using errcode = '22023';
  end if;
  v_chave := nullif(btrim(p ->> 'chave', E' \t\n\r'), '');
  if v_chave is null then
    raise exception 'Campo chave não pode ser vazio.' using errcode = '22023';
  end if;

  if jsonb_typeof(p -> 'tipo') is distinct from 'string' then
    raise exception 'Campo tipo é obrigatório.' using errcode = '22023';
  end if;
  v_tipo := nullif(btrim(p ->> 'tipo', E' \t\n\r'), '');
  if v_tipo is null or v_tipo not in ('balancete', 'plano', 'bolsas', 'contrato', 'cadastro', 'outro') then
    raise exception 'Tipo de pendência inválido.' using errcode = '22023';
  end if;

  if jsonb_typeof(p -> 'titulo') is distinct from 'string' then
    raise exception 'Campo titulo é obrigatório.' using errcode = '22023';
  end if;
  v_titulo := nullif(btrim(p ->> 'titulo', E' \t\n\r'), '');
  if v_titulo is null then
    raise exception 'Campo titulo não pode ser vazio.' using errcode = '22023';
  end if;

  if p ? 'origem' and jsonb_typeof(p -> 'origem') not in ('string', 'null') then
    raise exception 'Campo origem deve ser texto.' using errcode = '22023';
  end if;
  v_origem := coalesce(nullif(btrim(p ->> 'origem', E' \t\n\r'), ''), 'sistema');
  if v_origem not in ('sistema', 'buriti', 'claude', 'pessoa') then
    raise exception 'Origem de pendência inválida.' using errcode = '22023';
  end if;

  v_project_id := null;
  if p ? 'project_id' and jsonb_typeof(p -> 'project_id') <> 'null' then
    if jsonb_typeof(p -> 'project_id') <> 'string' then
      raise exception 'Campo project_id deve ser UUID ou nulo.' using errcode = '22023';
    end if;
    v_project_id_txt := nullif(btrim(p ->> 'project_id', E' \t\n\r'), '');
    if v_project_id_txt is null then
      raise exception 'Campo project_id não pode ser vazio; use null para pendência geral.'
        using errcode = '22023';
    end if;
    if v_project_id_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Campo project_id inválido.' using errcode = '22023';
    end if;
    begin
      v_project_id := v_project_id_txt::uuid;
    exception when invalid_text_representation then
      raise exception 'Campo project_id inválido.' using errcode = '22023';
    end;
  end if;

  if p ? 'detalhe' and jsonb_typeof(p -> 'detalhe') not in ('object', 'null') then
    raise exception 'Campo detalhe deve ser um objeto JSON.' using errcode = '22023';
  end if;
  v_detalhe := case
    when not (p ? 'detalhe') or jsonb_typeof(p -> 'detalhe') = 'null' then '{}'::jsonb
    else p -> 'detalhe'
  end;

  -- Se já existe pela chave, mantém idempotência mesmo que o centro tenha sido inativado.
  select pe.id, pe.chave, pe.situacao, pe.project_id, pe.tipo
    into v_ex_id, v_chave_ret, v_situacao, v_ex_project_id, v_ex_tipo
    from public.pendencias pe
   where pe.chave = v_chave
     for update;

  if found then
    if v_ex_project_id is distinct from v_project_id or v_ex_tipo is distinct from v_tipo then
      raise exception 'Conflito de chave: já existe pendência com esta chave para outro centro ou tipo.'
        using errcode = '22023';
    end if;

    if v_situacao = 'aberta' then
      update public.pendencias
         set titulo  = v_titulo,
             detalhe = v_detalhe
       where id = v_ex_id;
    end if;

    return jsonb_build_object(
      'id',       v_ex_id,
      'chave',    v_chave_ret,
      'situacao', v_situacao,
      'criada',   false
    );
  end if;

  -- 065: pendência NOVA recusa qualquer CPF; existente deixa o gatilho decidir (23514).
  if public._tem_cpf(public._texto_pendencia(v_chave, v_titulo, v_detalhe)) then
    raise exception 'Pendência contém sequência no formato de CPF e não pode ser gravada.'
      using errcode = '22023';
  end if;

  if v_project_id is not null and not exists (
    select 1 from public.projects pr where pr.id = v_project_id and pr.active = true
  ) then
    raise exception 'Projeto não encontrado ou inativo.' using errcode = '22023';
  end if;

  insert into public.pendencias (chave, project_id, tipo, titulo, detalhe, origem)
  values (v_chave, v_project_id, v_tipo, v_titulo, v_detalhe, v_origem)
  on conflict (chave) do update
     set titulo  = excluded.titulo,
         detalhe = excluded.detalhe
   where public.pendencias.situacao = 'aberta'
     and public.pendencias.project_id is not distinct from excluded.project_id
     and public.pendencias.tipo = excluded.tipo
  returning id, chave, situacao, (xmax = 0)
    into v_id, v_chave_ret, v_situacao, v_criada;

  if not found then
    select pe.id, pe.chave, pe.situacao, pe.project_id, pe.tipo
      into v_id, v_chave_ret, v_situacao, v_ex_project_id, v_ex_tipo
      from public.pendencias pe
     where pe.chave = v_chave;

    if v_ex_project_id is distinct from v_project_id or v_ex_tipo is distinct from v_tipo then
      raise exception 'Conflito de chave: já existe pendência com esta chave para outro centro ou tipo.'
        using errcode = '22023';
    end if;

    v_criada := false;
  end if;

  return jsonb_build_object(
    'id',       v_id,
    'chave',    v_chave_ret,
    'situacao', v_situacao,
    'criada',   v_criada
  );
end;
$$;

comment on function public.criar_pendencia_v2(jsonb) is
  'Cria pendência idempotente por chave (só admin). Pendência nova recusa CPF; existente deixa o gatilho decidir o CPF novo (migs. 064/065).';

revoke all on function public.criar_pendencia_v2(jsonb) from public, anon;
grant execute on function public.criar_pendencia_v2(jsonb) to authenticated;

-- ------------------------------------------------------------
-- 4. Asserções dentro da transação
-- ------------------------------------------------------------
do $$
declare
  v_tname   text;
  v_pols    text;
  v_fn_sig  text;
  v_fn      oid;
  v_sample  text;
  v_tab     oid;
begin
  foreach v_tname in array array['documentos', 'documento_versoes', 'fatos', 'pendencias'] loop
    v_tab := ('public.' || v_tname)::regclass;

    if not (select relrowsecurity from pg_class where oid = v_tab) then
      raise exception '065: RLS desligado em %', v_tname;
    end if;

    if exists (
      select 1 from pg_class c
       cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
       where c.oid = v_tab and a.grantee in (0::oid, 'anon'::regrole::oid)
    ) then
      raise exception '065: anon/PUBLIC possui privilégio em %', v_tname;
    end if;

    if coalesce((
      select array_agg(a.privilege_type order by a.privilege_type)
        from pg_class c
       cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
       where c.oid = v_tab and a.grantee = 'authenticated'::regrole::oid
    ), '{}'::text[]) <> array['SELECT']::text[] then
      raise exception '065: ACL incorreta para authenticated em %', v_tname;
    end if;

    select string_agg(policyname, ', ' order by policyname)
      into v_pols
      from pg_policies
     where schemaname = 'public' and tablename = v_tname;

    if (select count(*) from pg_policies where schemaname = 'public' and tablename = v_tname) <> 1 then
      raise exception '065: % deve ter exatamente 1 policy (sobraram: %)', v_tname, coalesce(v_pols, '<nenhuma>');
    end if;

    if not exists (
      select 1 from pg_trigger t
       where t.tgrelid = v_tab
         and t.tgname = 'trg_bloqueia_agente'
         and not t.tgisinternal
         and t.tgenabled = 'O'
         and t.tgqual is null
         and (t.tgtype & 1) = 0
         and (t.tgtype & 2) <> 0
         and (t.tgtype & (4|8|16)) = (4|8|16)
         and t.tgfoid = 'public.bloqueia_escrita_do_agente()'::regprocedure
    ) then
      raise exception '065: trg_bloqueia_agente ausente, desabilitado ou alterado em %', v_tname;
    end if;
  end loop;

  foreach v_fn_sig in array array[
    'public._cpf_candidato(text, integer)',
    'public._tem_cpf(text)',
    'public._mascarar_cpf(text)',
    'public._cpfs(text)',
    'public._fmt_brl_num(numeric)',
    'public._texto_pendencia(text, text, jsonb)',
    'public._resolver_origens_v2(jsonb, boolean)',
    'public._resolver_origem_alvo(text, uuid, text, boolean)',
    'public._pendencias_sem_cpf()'
  ] loop
    v_fn := v_fn_sig::regprocedure;
    if not exists (
      select 1 from pg_proc p
       where p.oid = v_fn
         and p.prosecdef
         and p.proconfig is not null
         and p.proconfig = array['search_path=public, pg_temp']::text[]
    ) then
      raise exception '065: função interna % sem security definer ou search_path', v_fn_sig;
    end if;

    if has_function_privilege('anon', v_fn, 'EXECUTE')
       or has_function_privilege('authenticated', v_fn, 'EXECUTE')
       or exists (
         select 1 from pg_proc p
          cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
       ) then
      raise exception '065: ACL incorreta na função interna %', v_fn_sig;
    end if;
  end loop;

  foreach v_fn_sig in array array[
    'public.registrar_documento_v2(jsonb)',
    'public.get_origem_v2(text, uuid, text)',
    'public.explicar_livre_v2(uuid)',
    'public.criar_pendencia_v2(jsonb)',
    'public.resolver_pendencia_v2(uuid, text)'
  ] loop
    v_fn := v_fn_sig::regprocedure;
    if not exists (
      select 1 from pg_proc p
       where p.oid = v_fn
         and p.prosecdef
         and p.proconfig is not null
         and p.proconfig = array['search_path=public, pg_temp']::text[]
    ) then
      raise exception '065: RPC % sem security definer ou search_path', v_fn_sig;
    end if;

    if not has_function_privilege('authenticated', v_fn, 'EXECUTE')
       or has_function_privilege('anon', v_fn, 'EXECUTE')
       or exists (
         select 1 from pg_proc p
          cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where p.oid = v_fn and a.grantee = 0 and a.privilege_type = 'EXECUTE'
       ) then
      raise exception '065: ACL incorreta na RPC %', v_fn_sig;
    end if;
  end loop;

  if (select provolatile from pg_proc where oid = 'public._resolver_origens_v2(jsonb, boolean)'::regprocedure) <> 's' then
    raise exception '065: _resolver_origens_v2 deve ser stable';
  end if;
  if (select provolatile from pg_proc where oid = 'public._cpf_candidato(text, integer)'::regprocedure) <> 'i'
     or (select provolatile from pg_proc where oid = 'public._tem_cpf(text)'::regprocedure) <> 'i'
     or (select provolatile from pg_proc where oid = 'public._mascarar_cpf(text)'::regprocedure) <> 'i'
     or (select provolatile from pg_proc where oid = 'public._cpfs(text)'::regprocedure) <> 'i' then
    raise exception '065: helpers de CPF devem ser immutable';
  end if;

  foreach v_sample in array array[
    '529.982.247-25',
    '52998224725',
    '529 982 247 25',
    '529/982/247/25',
    '529,,,,,982,,,,,247,,,,,25',
    '529' || chr(160) || '982' || chr(160) || '247' || chr(160) || '25',
    '529' || chr(8211) || '982' || chr(8211) || '247' || chr(8211) || '25',
    '1.234,56 NOME 529.982.247-25',
    '100 529.982.247-25',
    '529     ' || E'\n' || '982     247     25'
  ] loop
    if not public._tem_cpf(v_sample) then
      raise exception '065: _tem_cpf falhou para %', v_sample;
    end if;
    if public._tem_cpf(public._mascarar_cpf(v_sample)) then
      raise exception '065: _mascarar_cpf deixou CPF passar para %', v_sample;
    end if;
    if not (public._cpfs(v_sample) @> array['52998224725']::text[]) then
      raise exception '065: _cpfs não devolveu o CPF de %', v_sample;
    end if;
  end loop;

  foreach v_sample in array array[
    '123.456.789-00',
    '111.111.111-11',
    '529982247250',
    '7.1.3.05.01.00042 2506042',
    '7.1.3.04.01.09142 09142 BOLSA DOACAO PESQUISA 380.000,00 0,00 380.000,00',
    'rubrica 529 e 982 com valor 247,25',
    '{"saldo": 1107372.93, "conta": "7.1.3.05.01.00042", "red": "71199553"}',
    '529,,,,,,,982,,,,,247,,,,,25'
  ] loop
    if public._tem_cpf(v_sample) then
      raise exception '065: _tem_cpf deu falso positivo para %', v_sample;
    end if;
    if public._mascarar_cpf(v_sample) is distinct from v_sample then
      raise exception '065: _mascarar_cpf alterou texto sem CPF: %', v_sample;
    end if;
    if array_length(public._cpfs(v_sample), 1) is not null then
      raise exception '065: _cpfs devolveu CPF para texto sem CPF: %', v_sample;
    end if;
  end loop;

  if public._mascarar_cpf('CPF 529 982 247 25 ok') <> 'CPF ***.***.***-** ok' then
    raise exception '065: _mascarar_cpf falhou no caso simples';
  end if;
  if public._mascarar_cpf('ref 123.456.789-00') <> 'ref 123.456.789-00' then
    raise exception '065: _mascarar_cpf mascarou DV inválido';
  end if;
  if public._mascarar_cpf('1.234,56 NOME 529.982.247-25') <> '1.234,56 NOME ***.***.***-**' then
    raise exception '065: _mascarar_cpf não isolou o CPF vizinho';
  end if;
  if public._mascarar_cpf('100 529.982.247-25') <> '100 ***.***.***-**' then
    raise exception '065: _mascarar_cpf não isolou o CPF depois de 100';
  end if;
  if public._cpfs('x 529.982.247-25 y 529.982.247-25') <> array['52998224725']::text[] then
    raise exception '065: _cpfs duplicou ou perdeu CPF repetido';
  end if;
end $$;

commit;
