-- Yakıt Defteri: araçlar, dolumlar ve günlük fotoğraf okuma sayacı.
-- Her kullanıcı yalnızca kendi kayıtlarını görür ve değiştirir (Row Level Security).

create table public.cars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  plate text not null check (char_length(plate) between 1 and 20),
  name text check (char_length(name) <= 60),
  fuel text not null default 'Benzin',
  tank numeric check (tank > 0 and tank < 1000),
  created_at timestamptz not null default now()
);

create table public.fills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  car_id uuid not null references public.cars on delete cascade,
  date date not null,
  odo integer not null check (odo >= 0),
  liters numeric(8,2) not null check (liters > 0),
  price numeric(8,2) not null check (price > 0),
  total numeric(10,2) not null check (total > 0),
  full_tank boolean not null default true,
  created_at timestamptz not null default now()
);
create index fills_car_odo on public.fills (car_id, odo);
create index cars_user on public.cars (user_id);

alter table public.cars enable row level security;
alter table public.fills enable row level security;

create policy "Kendi araçları" on public.cars for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Kendi dolumları" on public.fills for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.cars c where c.id = car_id and c.user_id = (select auth.uid()))
  );

grant select, insert, update, delete on public.cars, public.fills to authenticated;

-- Fotoğraf okuma: kişi başı günlük sayaç (ücretsiz kotayı korumak için)
create table public.ocr_usage (
  user_id uuid not null references auth.users on delete cascade,
  day date not null default current_date,
  count integer not null default 0,
  primary key (user_id, day)
);
alter table public.ocr_usage enable row level security;

create function public.ocr_bump() returns integer
language plpgsql security definer set search_path = public as $$
declare c integer;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.ocr_usage (user_id, day, count) values (auth.uid(), current_date, 1)
  on conflict (user_id, day) do update set count = public.ocr_usage.count + 1
  returning count into c;
  return c;
end $$;
revoke all on function public.ocr_bump() from public, anon;
grant execute on function public.ocr_bump() to authenticated;
