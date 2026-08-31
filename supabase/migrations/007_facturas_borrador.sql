-- ============================================================
-- ENVIEX CRM — Facturas en borrador (revisar antes de enviar)
-- Ejecutar en Supabase: SQL Editor > New query > pegar > Run
-- ============================================================

-- ------------------------------------------------------------
-- 1) Una factura ahora puede existir como "borrador" antes de
--    tener número, hash, QR y PDF (eso solo se asigna al enviarla)
-- ------------------------------------------------------------
alter table public.invoices alter column series drop not null;
alter table public.invoices alter column number drop not null;
alter table public.invoices alter column hash drop not null;
alter table public.invoices alter column qr_data drop not null;
alter table public.invoices alter column status set default 'draft';

alter table public.invoices drop constraint if exists invoices_status_check;
alter table public.invoices add constraint invoices_status_check
  check (status in ('draft', 'issued', 'sent', 'rectified'));

-- ------------------------------------------------------------
-- 2) Las empresas clientas NUNCA deben ver un borrador, solo lo
--    que ya está emitido de verdad
-- ------------------------------------------------------------
drop policy if exists "empresa ve sus facturas" on public.invoices;
create policy "empresa ve sus facturas emitidas" on public.invoices
  for select using (company_id = public.my_company_id() and status = 'issued');

-- ------------------------------------------------------------
-- 3) El personal (Admin/Gestor) puede editar y borrar SOLO
--    mientras la factura siga en borrador. Una vez emitida,
--    nadie la toca desde aquí (ni siquiera un Gestor).
-- ------------------------------------------------------------
create policy "staff edita borradores" on public.invoices
  for update using (public.is_staff() and status = 'draft');
create policy "staff borra borradores" on public.invoices
  for delete using (public.is_staff() and status = 'draft');

create policy "staff edita lineas de borrador" on public.invoice_lines
  for update using (
    public.is_staff()
    and exists (select 1 from public.invoices where id = invoice_id and status = 'draft')
  );
create policy "staff inserta lineas de borrador" on public.invoice_lines
  for insert with check (
    public.is_staff()
    and exists (select 1 from public.invoices where id = invoice_id and status = 'draft')
  );
create policy "staff borra lineas de borrador" on public.invoice_lines
  for delete using (
    public.is_staff()
    and exists (select 1 from public.invoices where id = invoice_id and status = 'draft')
  );
