-- Autoconferido, roda DEPOIS da 061 (banco descartável; tools/replica-local/rodar-061-pglite.mjs), com as identidades
-- sintéticas dos stubs: a1 admin, b1 professor do 51.X, c1 agente, d1 vira automação aqui. Tudo em begin/rollback.
-- Antes da 061 o roteiro falha logo no primeiro insert (a tabela não existe, 42P01).
\set ON_ERROR_STOP on

create or replace function pg_temp.ok(p boolean,p_motivo text) returns void language plpgsql as $$
begin if p is distinct from true then raise exception '061 FALHOU: %',p_motivo; end if; end $$;
create or replace function pg_temp.negado(p_sql text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when insufficient_privilege then return;
    when raise_exception then if sqlerrm like 'Acesso negado%' or sqlerrm like '%agente%' then return; else raise; end if;
  end;
  raise exception '061 FALHOU: operação permitida: %',p_sql;
end $$;

begin;
delete from public.user_projects where user_id='00000000-0000-0000-0000-0000000000d1';
update public.app_users set role='automacao' where user_id='00000000-0000-0000-0000-0000000000d1';

-- BLOCO 1 — o admin grava duas versões; a vigente é a mais recente; criado_por é ele.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
set role authenticated;
insert into public.planejamento_versoes(planejamento,premissas,nota,criado_em)
  values('bolsas-2027','{"horizonte_ate":"2027-12"}','primeira','2026-11-17 10:00');
insert into public.planejamento_versoes(planejamento,premissas,nota,criado_em)
  values('bolsas-2027','{"horizonte_ate":"2027-12","fontes":{"itens":[]}}','segunda','2026-11-17 11:00');
select pg_temp.ok((select nota='segunda' from public.planejamento_versoes where planejamento='bolsas-2027'
  order by criado_em desc limit 1),'vigente é a mais recente');
select pg_temp.ok((select count(*)=2 and bool_and(criado_por='00000000-0000-0000-0000-0000000000a1')
  from public.planejamento_versoes),'duas versões, do admin');
-- Ninguém reescreve nem apaga uma versão (nem o admin).
select pg_temp.negado($q$update public.planejamento_versoes set nota='x'$q$);
select pg_temp.negado($q$delete from public.planejamento_versoes$q$);
-- Não se grava em nome de outro.
select pg_temp.negado($q$insert into public.planejamento_versoes(planejamento,premissas,criado_por)
  values('bolsas-2027','{}','00000000-0000-0000-0000-0000000000b1')$q$);
reset role;

-- BLOCO 2 — entradas inválidas: CPF válido no texto, nome fora do padrão, premissas que não são objeto.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
set role authenticated;
do $$ begin
  begin insert into public.planejamento_versoes(planejamento,premissas) values('bolsas-2027','{"nota":"cpf 529.982.247-25"}');
    raise exception '061 FALHOU: CPF aceito'; exception when check_violation then null; end;
  begin insert into public.planejamento_versoes(planejamento,premissas,nota) values('bolsas-2027','{}','52998224725');
    raise exception '061 FALHOU: CPF na nota aceito'; exception when check_violation then null; end;
  begin insert into public.planejamento_versoes(planejamento,premissas) values('Bolsas 2027','{}');
    raise exception '061 FALHOU: nome inválido aceito'; exception when check_violation then null; end;
  begin insert into public.planejamento_versoes(planejamento,premissas) values('bolsas-2027','[]');
    raise exception '061 FALHOU: premissas não-objeto aceitas'; exception when check_violation then null; end;
end $$;
reset role;

-- BLOCO 3 — professor, agente e automação não leem nem gravam.
do $$
declare u text;
begin
  foreach u in array array['00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000c1',
                           '00000000-0000-0000-0000-0000000000d1'] loop
    perform set_config('request.jwt.claim.sub',u,true);
    set local role authenticated;
    if (select count(*) from public.planejamento_versoes) <> 0 then
      raise exception '061 FALHOU: % leu as premissas',u; end if;
    begin
      insert into public.planejamento_versoes(planejamento,premissas) values('bolsas-2027','{}');
      raise exception '061 FALHOU: % gravou',u;
    exception when insufficient_privilege then null;
      when raise_exception then if sqlerrm like '061 FALHOU%' then raise; end if;
    end;
    reset role;
  end loop;
end $$;

-- BLOCO 4 — anon não tem nada.
select pg_temp.ok(not has_table_privilege('anon','public.planejamento_versoes','SELECT'),'anon sem leitura');
rollback;
