-- ============================================================
-- ENVIEX CRM — Numeración de facturas independiente por empresa
-- Ejecutar en Supabase: SQL Editor > New query > pegar > Run
-- ============================================================

-- ------------------------------------------------------------
-- 1) Cada empresa tiene su propia serie y su propio contador
--    (antes era un único contador compartido por todos los clientes)
-- ------------------------------------------------------------
create table public.invoice_sequences_v2 (
  company_id uuid primary key references public.companies(id) on delete cascade,
  series text not null default 'A',
  next_number integer not null default 1
);

alter table public.invoice_sequences_v2 enable row level security;

create policy "staff ve la numeracion" on public.invoice_sequences_v2
  for select using (public.is_staff());
create policy "solo admin edita la numeracion" on public.invoice_sequences_v2
  for update using (public.is_admin());
create policy "solo admin inserta numeracion" on public.invoice_sequences_v2
  for insert with check (public.is_admin());

-- Creamos una fila de numeración para las empresas que ya existan
insert into public.invoice_sequences_v2 (company_id, series, next_number)
select id, 'A', 1 from public.companies
on conflict (company_id) do nothing;

-- Y que a partir de ahora, cada empresa nueva tenga la suya automáticamente
create or replace function public.create_invoice_sequence_for_company()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.invoice_sequences_v2 (company_id, series, next_number)
  values (new.id, 'A', 1)
  on conflict (company_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_create_invoice_sequence on public.companies;
create trigger trg_create_invoice_sequence
  after insert on public.companies
  for each row execute function public.create_invoice_sequence_for_company();
