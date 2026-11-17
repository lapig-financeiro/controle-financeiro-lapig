-- 061 — premissas do planejamento de bolsas (pedido do Victor em 17/11/2026: levar o mapa de 2027 para o site).
--
-- O mapa (pessoa × mês, quem paga cada bolsa até o horizonte) lê do banco o que já está nele: bolsas, saldos
-- livres, vigências, balancetes. O resto — fontes que ainda não estão em centro nenhum (contrato a assinar),
-- pessoas previstas em plano e ainda não implantadas, cenários, decisões de continuidade — morava num arquivo
-- fora do git, porque tem nome de bolsista. Esta tabela é o lugar dele no banco.
--
-- Cada gravação é uma VERSÃO nova (só insert): mudar uma premissa nunca apaga a anterior, e a tela mostra quem
-- mudou o quê e quando. Só admin lê e grava; o agente (Buriti) e a automação não. Texto com CPF é recusado.

begin;

create table public.planejamento_versoes (
  id            uuid primary key default gen_random_uuid(),
  planejamento  text not null check (planejamento ~ '^[a-z0-9][a-z0-9-]{2,59}$'),
  premissas     jsonb not null check (jsonb_typeof(premissas) = 'object'),
  nota          text check (nota is null or length(nota) <= 500),
  criado_em     timestamptz not null default now(),
  criado_por    uuid not null default auth.uid()
);

comment on table public.planejamento_versoes is
  'Premissas do planejamento de bolsas (o que o mapa usa e não está no banco), uma linha por versão; a vigente é a mais recente de cada planejamento. Só admin (mig. 061).';

create index idx_planejamento_versoes on public.planejamento_versoes (planejamento, criado_em desc);

alter table public.planejamento_versoes enable row level security;
revoke all on public.planejamento_versoes from public, anon, authenticated;
grant select, insert on public.planejamento_versoes to authenticated;

create policy leitura on public.planejamento_versoes for select to authenticated
  using (public.is_admin() and not public.is_agente() and not public.is_automacao(null));
create policy gravacao on public.planejamento_versoes for insert to authenticated
  with check (public.is_admin() and not public.is_agente() and not public.is_automacao(null) and criado_por = auth.uid());

-- CPF é recusado por gatilho, não por CHECK: contem_cpf não é executável por authenticated (052), e o CHECK roda
-- com o papel de quem grava. A função do gatilho é definer só para chamar contem_cpf; não lê nem grava nada.
-- A data da versão é sempre a do banco (clock_timestamp): quem grava não escolhe qual versão é a vigente
-- (achado da revisão do Gemini 4 em 17/11/2026).
create function public._planejamento_sem_cpf() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.contem_cpf(new.premissas::text) or public.contem_cpf(coalesce(new.nota, ''))
     or public.contem_cpf(new.planejamento) then
    raise exception 'Premissas com CPF não são gravadas.' using errcode = '23514';
  end if;
  new.criado_em := clock_timestamp();
  return new;
end $$;
revoke all on function public._planejamento_sem_cpf() from public, anon, authenticated;

create trigger trg_planejamento_sem_cpf before insert on public.planejamento_versoes
  for each row execute function public._planejamento_sem_cpf();

create trigger trg_bloqueia_agente before insert or update or delete on public.planejamento_versoes
  for each statement execute function public.bloqueia_escrita_do_agente();

-- Asserções: RLS, barreira do agente, ACL só select/insert para authenticated e nada para anon.
do $$
declare t oid := 'public.planejamento_versoes'::regclass;
begin
  if not (select relrowsecurity from pg_class where oid = t) then
    raise exception '061: RLS desligado'; end if;
  if not exists (select 1 from pg_trigger where tgrelid = t and tgname = 'trg_bloqueia_agente') then
    raise exception '061: sem trg_bloqueia_agente'; end if;
  if has_table_privilege('anon', t, 'SELECT') or has_table_privilege('anon', t, 'INSERT') then
    raise exception '061: anon com acesso'; end if;
  if has_table_privilege('authenticated', t, 'UPDATE') or has_table_privilege('authenticated', t, 'DELETE')
     or not has_table_privilege('authenticated', t, 'SELECT') or not has_table_privilege('authenticated', t, 'INSERT') then
    raise exception '061: ACL de authenticated incorreta'; end if;
  if not exists (select 1 from pg_trigger where tgrelid = t and tgname = 'trg_planejamento_sem_cpf') then
    raise exception '061: sem o gatilho de CPF'; end if;
  if (select count(*) from pg_policy where polrelid = t) <> 2 then
    raise exception '061: políticas inesperadas'; end if;
end $$;

commit;
