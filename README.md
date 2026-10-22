# Yakıt Defteri

Aracının yakıt tüketimini takip eden, telefonda uygulama gibi çalışan bir web uygulaması.

- Yakıt fişinin fotoğrafından litre fiyatını, litreyi ve toplam tutarı okur
- Kilometre göstergesinin fotoğrafından km'yi okur ya da elle girilir
- 100 km'de ortalama tüketim, km başına TL, aylık km ve harcama, litre fiyatı trendi
- Kısmi dolumları doğru hesaplar, kayıtlar düzenlenip silinebilir, CSV olarak dışa aktarılır
- Birden fazla araç, e-posta ve şifreyle giriş; herkes yalnızca kendi verisini görür
- Türkçe ve İngilizce arayüz (Aracım › Dil ya da giriş ekranındaki dil düğmesi)

## Nasıl çalışır

| Parça | Servis | Ücret |
|---|---|---|
| Uygulama (index.html, app.js) | GitHub Pages | Ücretsiz |
| Giriş ve veritabanı | Supabase | Ücretsiz katman |
| Fiş ve km okuma | Supabase Edge Function + Google Gemini | Ücretsiz katman |
| Yedek fiş okuma | Tesseract.js (telefonda) | Ücretsiz |

`main` dalına her gönderimde `.github/workflows/deploy.yml` veritabanı tablolarını günceller, okuma servisini yayınlar ve uygulamayı GitHub Pages'e koyar.

## Kurulum

### 1. GitHub sırları

Depoda **Settings › Secrets and variables › Actions › New repository secret** ile şunları ekle:

| Ad | Nereden alınır |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | supabase.com › sağ üstte hesap › Account preferences › Access Tokens › Generate new token |
| `SUPABASE_PROJECT_REF` | Supabase projesi › Project Settings › General › Project ID |
| `SUPABASE_DB_PASSWORD` | Projeyi oluştururken belirlediğin veritabanı şifresi |
| `GEMINI_API_KEY` | aistudio.google.com/apikey |

### 2. GitHub Pages

**Settings › Pages › Build and deployment › Source** alanında **GitHub Actions** seç.

### 3. Supabase giriş ayarları

- **Authentication › URL Configuration › Site URL:** `https://fazlikeles.github.io/yakit-defteri/`
- Aynı sayfada **Redirect URLs** listesine de aynı adresi ekle.
- **Authentication › Sign In / Providers › Email:** "Confirm email" seçeneğini kapat. Supabase'in ücretsiz e-posta servisi yalnızca proje ekibine e-posta gönderir. Kapatmazsan arkadaşların hesap açamaz.
- Herkes hesabını açtıktan sonra istersen **Allow new users to sign up** seçeneğini kapatıp yeni kayıtları durdurabilirsin.

### 4. Yayınla

**Actions › Yayınla › Run workflow**. Bitince uygulama `https://fazlikeles.github.io/yakit-defteri/` adresinde açılır.

## Telefona ekleme

- **iPhone:** Safari'de aç › Paylaş › Ana Ekrana Ekle
- **Android:** Chrome'da aç › ⋮ › Ana ekrana ekle

## Sınırlar

- Fotoğraf okuma kişi başı günde 30 kez yapılabilir (`OCR_DAILY_LIMIT` Supabase sırrıyla değiştirilebilir).
- Gemini modelleri sırayla denenir: `gemini-3.5-flash` (iki kez), `gemini-3.1-flash-lite`, `gemini-3.8-flash`. Her deneme en fazla 10 saniye sürer. Önce başka bir model denensin istersen Supabase'de `GEMINI_MODEL` sırrını ayarla.
- "Confirm email" kapalıyken şifre yenileme e-postaları da yalnızca proje ekibine gider. Şifresini unutan biri olursa Supabase › Authentication › Users ekranından şifresini sıfırlayabilirsin.
