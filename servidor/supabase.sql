-- ============================================================================
--  Cortes de calle · Policía Local de Don Benito
--  Esquema para Supabase (PostgreSQL). Ejecutar UNA vez en: SQL Editor > New query > Run
--
--  Seguridad:
--   · Los AGENTES (usuarios autenticados) leen y escriben la tabla `cortes`.
--   · Los CIUDADANOS (sin sesión) solo pueden leer la vista `cortes_publicos`, que
--     contiene únicamente los cortes publicados y SIN campos internos
--     (notas internas, referencia de expediente, usuarios).
--   · Cada alta, cambio o borrado queda en `historial` mediante un disparador de la
--     base de datos (no se puede saltar desde el navegador).
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists public.cortes (
  id               uuid primary key default gen_random_uuid(),
  calle            text not null,
  tramo            text default '',
  tipo             text not null default 'total' check (tipo in ('total','parcial','sentido','estac')),
  motivo           text default '',
  organismo        text default '',            -- quién lo solicita / origina
  autoriza         text default '',            -- quién lo autoriza
  autoriza_detalle text default '',
  referencia       text default '',            -- INTERNO
  inicio           timestamptz not null,
  fin              timestamptz,
  desvio           text default '',
  obs              text default '',            -- INTERNO
  segs             jsonb not null default '[]'::jsonb,   -- [[ [lat,lon], ... ], ...]
  publicado        boolean not null default true,
  origen           text default 'manual',
  creado           timestamptz not null default now(),
  creado_por       text,
  modificado       timestamptz not null default now(),
  modificado_por   text
);
create index if not exists cortes_fechas_idx on public.cortes (inicio, fin);

create table if not exists public.historial (
  id        bigserial primary key,
  corte_id  uuid,
  accion    text not null,                     -- INSERT | UPDATE | DELETE
  usuario   text,
  fecha     timestamptz not null default now(),
  datos     jsonb
);
create index if not exists historial_fecha_idx on public.historial (fecha desc);

-- Quién y cuándo
create or replace function public.cortes_meta() returns trigger
language plpgsql as $$
begin
  new.modificado     := now();
  new.modificado_por := coalesce(auth.jwt() ->> 'email', 'sistema');
  if tg_op = 'INSERT' then
    new.creado_por := new.modificado_por;
  end if;
  return new;
end $$;
drop trigger if exists trg_cortes_meta on public.cortes;
create trigger trg_cortes_meta before insert or update on public.cortes
  for each row execute function public.cortes_meta();

-- Registro de actividad
create or replace function public.cortes_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  insert into public.historial (corte_id, accion, usuario, datos)
  values (r.id, tg_op, coalesce(auth.jwt() ->> 'email', 'sistema'), to_jsonb(r) - 'segs');
  return r;
end $$;
drop trigger if exists trg_cortes_log on public.cortes;
create trigger trg_cortes_log after insert or update or delete on public.cortes
  for each row execute function public.cortes_log();

-- Permisos
alter table public.cortes    enable row level security;
alter table public.historial enable row level security;

drop policy if exists agentes_cortes on public.cortes;
create policy agentes_cortes on public.cortes
  for all to authenticated using (true) with check (true);

drop policy if exists agentes_historial on public.historial;
create policy agentes_historial on public.historial
  for select to authenticated using (true);

revoke all on public.cortes    from anon;
revoke all on public.historial from anon;

-- Vista pública: solo publicados y sin datos internos. Se ocultan los finalizados hace más de 2 días.
create or replace view public.cortes_publicos as
  select id, calle, tramo, tipo, motivo, organismo, autoriza, autoriza_detalle,
         inicio, fin, desvio, segs
  from public.cortes
  where publicado
    and (fin is null or fin > now() - interval '2 days');

grant select on public.cortes_publicos to anon, authenticated;
