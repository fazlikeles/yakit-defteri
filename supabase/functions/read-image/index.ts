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
- liters: alınan yakıt miktarı, litre
- price_per_liter: litre birim fiyatı, TL
- total: ödenen toplam tutar, KDV dahil (TOPLAM satırı; TOPKDV satırını alma)
- date: fiş tarihi, YYYY-MM-DD
Türk fişlerinde yakıt satırı genelde "12,580 LT X 79,52" biçimindedir: ilk sayı litre (12.58), X'ten sonraki sayı litre fiyatıdır (79.52). Türkçede virgül ondalık ayırıcıdır, nokta binlik ayırıcıdır: "1.000,00" = 1000. Sayıların önündeki * işaretini yok say.
Sayıları JSON sayısı olarak, ondalık ayırıcı nokta olacak şekilde yaz. Gerçekten göremediğin değere null yaz.
Sadece şu JSON'u döndür: {"price_per_liter": number|null, "liters": number|null, "total": number|null, "date": string|null}`,
  odometer: `Bu fotoğraf bir aracın gösterge panelini gösteriyor. Toplam kilometre sayacını (ODO) oku. TRIP, menzil, hız ya da saat değerlerini alma.
Sadece şu JSON'u döndür: {"odometer_km": number|null}. Okuyamıyorsan null yaz.`,
};

const num = { type: "NUMBER", nullable: true };
const SCHEMAS: Record<string, unknown> = {
  receipt: { type: "OBJECT", properties: { price_per_liter: num, liters: num, total: num, date: { type: "STRING", nullable: true } }, required: ["price_per_liter", "liters", "total", "date"] },
  odometer: { type: "OBJECT", properties: { odometer_km: num }, required: ["odometer_km"] },
};
// "1.000,00", "*79,52" ya da 79.52 gibi değerleri sayıya çevirir
const toNum = (v: unknown): number | null => {
  if (typeof v === "number") return isFinite(v) && v > 0 ? v : null;
  if (typeof v !== "string") return null;
  let s = v.replace(/[^\d.,]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = parseFloat(s);
  return isFinite(n) && n > 0 ? n : null;
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
      generationConfig: { temperature: 0, response_mime_type: "application/json", response_schema: SCHEMAS[body.kind!] },
    }),
  });
  if (!res.ok) {
    console.error("gemini", res.status, await res.text());
    return json({ error: res.status === 429 ? "upstream_limit" : "upstream" }, 502);
  }
  const out = await res.json();
  const text: string = out?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  let raw: Record<string, unknown>;
  try {
    const m = text.match(/\{[\s\S]*\}/);
    raw = JSON.parse(m ? m[0] : text);
  } catch {
    console.error("okunamadı", body.kind, text.slice(0, 300));
    return json({ error: "unreadable" }, 422);
  }
  if (body.kind === "odometer") {
    const r = { odometer_km: toNum(raw.odometer_km) };
    console.log("sonuç", body.kind, JSON.stringify(r));
    return r.odometer_km ? json(r) : json({ error: "unreadable" }, 422);
  }
  const r = {
    price_per_liter: toNum(raw.price_per_liter),
    liters: toNum(raw.liters),
    total: toNum(raw.total),
    date: typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : null,
  };
  console.log("sonuç", body.kind, JSON.stringify(r));
  // En az iki değer yoksa okunamadı say; uygulama telefonda okumayı dener
  const n = [r.price_per_liter, r.liters, r.total].filter((x) => x).length;
  return n >= 2 ? json(r) : json({ error: "unreadable" }, 422);
});
