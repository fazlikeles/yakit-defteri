// Fiş ya da kilometre göstergesi fotoğrafını Gemini ile okur.
// Gemini anahtarı yalnızca burada, sunucuda durur; uygulamaya hiç gönderilmez.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const DAILY_LIMIT = Number(Deno.env.get("OCR_DAILY_LIMIT") ?? "30");
const MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const PROMPTS: Record<string, string> = {
  receipt: `Bu fotoğraf Türkiye'deki bir akaryakıt istasyonunun fişi. Şu değerleri oku:
- price_per_liter: litre birim fiyatı (BİRİM FİYAT, LT FİYATI, TL/LT)
- liters: alınan yakıt miktarı, litre (LİTRE, LT, MİKTAR)
- total: ödenen toplam tutar, KDV dahil (TOPLAM)
- date: fiş tarihi, YYYY-MM-DD
Sayıları JSON sayısı olarak yaz, ondalık ayırıcı nokta olsun (örn. 51.89). Okuyamadığın ya da emin olmadığın değere null yaz, tahmin etme.
Sadece şu JSON'u döndür: {"price_per_liter": number|null, "liters": number|null, "total": number|null, "date": string|null}`,
  odometer: `Bu fotoğraf bir aracın gösterge panelini gösteriyor. Toplam kilometre sayacını (ODO) oku. TRIP, menzil, hız ya da saat değerlerini alma.
Sadece şu JSON'u döndür: {"odometer_km": number|null}. Okuyamıyorsan null yaz.`,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  // Giriş yapmış kullanıcı mı?
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, (Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY"))!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  let body: { kind?: string; image?: string; mime?: string };
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }
  const prompt = PROMPTS[body.kind ?? ""];
  if (!prompt || typeof body.image !== "string" || body.image.length > 8_000_000) return json({ error: "bad_request" }, 400);
  const mime = ["image/jpeg", "image/png", "image/webp"].includes(body.mime ?? "") ? body.mime! : "image/jpeg";

  // Günlük sınır
  const { data: count, error: countErr } = await supabase.rpc("ocr_bump");
  if (countErr) return json({ error: "server" }, 500);
  if (count > DAILY_LIMIT) return json({ error: "daily_limit" }, 429);

  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return json({ error: "not_configured" }, 500);

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: body.image } }] }],
      generationConfig: { temperature: 0, response_mime_type: "application/json" },
    }),
  });
  if (!res.ok) {
    console.error("gemini", res.status, await res.text());
    return json({ error: res.status === 429 ? "upstream_limit" : "upstream" }, 502);
  }
  const out = await res.json();
  const text: string = out?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  try {
    const m = text.match(/\{[\s\S]*\}/);
    return json(JSON.parse(m ? m[0] : text));
  } catch {
    return json({ error: "unreadable" }, 422);
  }
});
