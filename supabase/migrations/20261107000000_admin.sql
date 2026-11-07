-- Yönetici (admin) hesabı ve kullanım istatistikleri.
-- admins tablosuna istemciden erişim yok; yetki kontrolü sunucudaki fonksiyonlarda yapılır.

create table public.admins (
  user_id uuid primary key references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

-- İlk açılan hesap (uygulamanın sahibi) yönetici olur.
insert into public.admins (user_id)
select id from auth.users order by created_at limit 1
on conflict do nothing;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Kişi başına kullanım. Yönetici değilsen hata verir.
create function public.admin_usage()
returns table (
  email text,
  created_at timestamptz,
  confirmed boolean,
  last_sign_in timestamptz,
  cars bigint,
  fills bigint,
  last_fill timestamptz,
  ocr_total bigint,
  ocr_7d bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select
    u.email::text,
    u.created_at,
    u.email_confirmed_at is not null,
    u.last_sign_in_at,
    (select count(*) from public.cars c where c.user_id = u.id),
    (select count(*) from public.fills f where f.user_id = u.id),
    (select max(f.created_at) from public.fills f where f.user_id = u.id),
    coalesce((select sum(o.count) from public.ocr_usage o where o.user_id = u.id), 0)::bigint,
    coalesce((select sum(o.count) from public.ocr_usage o where o.user_id = u.id and o.day >= current_date - 6), 0)::bigint
  from auth.users u
  order by u.created_at;
end $$;
revoke all on function public.admin_usage() from public, anon;
grant execute on function public.admin_usage() to authenticated;
