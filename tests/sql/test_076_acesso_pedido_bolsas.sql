-- Rode somente na base descartável do rodar-076-pglite.mjs.
\set ON_ERROR_STOP on
begin;

insert into public.scholarship_holders (id, full_name)
values ('00000000-0000-4000-8000-000000076001', 'Bolsista de teste');

insert into public.scholarships (holder_id, project_id, amount, start_date, end_date, status)
select '00000000-0000-4000-8000-000000076001', id, 100, current_date - 1, current_date + 30, 'active'
  from public.projects where code = '51.X';

-- Mesmo uma caixa antiga já existente fica invisível para seu dono sem permissão.
insert into public.caixas_pedido (id, dono, nome, meses)
values ('00000000-0000-4000-8000-000000076002',
        '00000000-0000-0000-0000-0000000000b1', 'Caixa de teste', 2);
insert into public.bolsista_equipes (holder_id, equipe)
values ('00000000-0000-4000-8000-000000076001', 'solos');

create function pg_temp.verificar_bolsa076(p_pode boolean)
returns void language plpgsql as $$
declare
  v_pedido jsonb := public.get_pedido_bolsas_v2();
  v_bolsa jsonb;
begin
  select value into v_bolsa from jsonb_array_elements(v_pedido -> 'bolsistas')
   where value ->> 'holder_id' = '00000000-0000-4000-8000-000000076001';
  if v_bolsa is null or (v_bolsa ->> 'valor_vigente')::numeric is distinct from 100::numeric then
    raise exception '076: a Análise perdeu a bolsa do centro permitido';
  end if;
  if p_pode then
    if v_bolsa ->> 'equipe' is distinct from 'solos'
       or jsonb_array_length(v_pedido -> 'caixas') <> 1 then
      raise exception '076: bolsista ou caixa indisponível para a conta autorizada';
    end if;
  elsif v_bolsa ->> 'equipe' is not null or v_pedido -> 'caixas' is distinct from '[]'::jsonb then
    raise exception '076: dados do pedido visíveis a uma conta sem permissão';
  end if;
end;
$$;

create function pg_temp.barrada076(p_sql text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception '076: operação indevidamente autorizada: %', p_sql;
exception when insufficient_privilege then
  null;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
select pg_temp.verificar_bolsa076(false);
select pg_temp.barrada076('select public.definir_acesso_bolsistas_v2(auth.uid(), true)');
update public.app_users set pode_bolsistas = true where user_id = auth.uid();
select pg_temp.verificar_bolsa076(false);

select pg_temp.barrada076('select public.salvar_equipe_bolsista_v2(null, null)');
select pg_temp.barrada076('select public.salvar_caixa_pedido_v2(null)');
select pg_temp.barrada076('select public.apagar_caixa_pedido_v2(null)');
select pg_temp.barrada076('select public.colocar_na_caixa_v2(null, null)');
select pg_temp.barrada076('select public.editar_item_caixa_v2(null, null, null, null)');
select pg_temp.barrada076('select public.tirar_da_caixa_v2(null, null)');
select pg_temp.barrada076('select public.limpar_ocultos_da_caixa_v2(null)');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
select pg_temp.verificar_bolsa076(false);
select pg_temp.barrada076('select public.salvar_caixa_pedido_v2(null)');
select public.definir_acesso_bolsistas_v2('00000000-0000-0000-0000-0000000000b1', true);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
do $$
begin
  if exists (
    select 1 from jsonb_array_elements(public.get_pedido_bolsas_v2() -> 'bolsistas')
     where value ->> 'holder_id' = '00000000-0000-4000-8000-000000076001'
  ) then raise exception '076: bolsa de centro fora do escopo'; end if;
end;
$$;
select pg_temp.barrada076('select public.salvar_caixa_pedido_v2(null)');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
select pg_temp.verificar_bolsa076(true);
select public.colocar_na_caixa_v2('00000000-0000-4000-8000-000000076002', '00000000-0000-4000-8000-000000076001');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
select public.definir_acesso_bolsistas_v2('00000000-0000-0000-0000-0000000000b1', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
select pg_temp.verificar_bolsa076(false);
select pg_temp.barrada076('select public.salvar_caixa_pedido_v2(null)');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
select pg_temp.barrada076('select public.get_pedido_bolsas_v2()');
select pg_temp.barrada076('select public.salvar_caixa_pedido_v2(null)');

rollback;
