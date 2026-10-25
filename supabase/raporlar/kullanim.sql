-- Kullanım raporu: kişi başına araç, dolum ve fotoğraf okuma sayıları.
-- Supabase › SQL Editor'e yapıştırıp Run'a bas.
select
  u.email,
  to_char(u.created_at at time zone 'Europe/Istanbul', 'YYYY-MM-DD HH24:MI') as kayit,
  u.email_confirmed_at is not null as dogrulandi,
  to_char(u.last_sign_in_at at time zone 'Europe/Istanbul', 'YYYY-MM-DD HH24:MI') as son_giris,
  (select count(*) from public.cars c where c.user_id = u.id) as arac,
  (select count(*) from public.fills f where f.user_id = u.id) as dolum,
  (select max(f.created_at) from public.fills f where f.user_id = u.id) as son_dolum,
  coalesce((select sum(o.count) from public.ocr_usage o where o.user_id = u.id), 0) as foto_okuma_toplam,
  coalesce((select sum(o.count) from public.ocr_usage o where o.user_id = u.id and o.day >= current_date - 6), 0) as foto_okuma_7gun
from auth.users u
order by u.created_at;
