// يعيد روابط التنزيل لطلب مدفوع فقط (بعد التحقق من توقيع الدفع)
import { config as cfgFn, json, signToken, sameHmac } from '../lib/paymob.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json({ ok: false }, 405);
  const cfg = cfgFn();
  if (!cfg.ordersKey || !cfg.hmacSecret) return json({ ok: false, error: 'غير مفعّل' }, 503);

  let b;
  try { b = await req.json(); } catch { return json({ ok: false }, 400); }
  const ref = String(b.ref || ''), spec = String(b.spec || '');
  const paidOk = sameHmac(signToken('paid|' + ref, cfg), b.t);
  const itemsOk = sameHmac(signToken('items|' + ref + '|' + spec, cfg), b.it);
  if (!ref || !paidOk || !itemsOk) return json({ ok: false, error: 'تعذّر التحقق من الطلب' }, 403);

  const ids = spec.split(',').map(s => s.trim()).filter(Boolean).slice(0, 30);
  try {
    const res = await fetch(cfg.productsApi, {
      method: 'POST', redirect: 'follow',
      body: JSON.stringify({ action: 'downloads', ordersKey: cfg.ordersKey, ids }),
    });
    const out = await res.json();
    if (!out.ok) throw new Error(out.error || 'failed');
    const files = (out.files || []).filter(f => /^https:\/\//i.test(f.url)).map(f => ({ name: f.name, url: f.url }));
    return json({ ok: true, files });
  } catch (err) {
    console.error('downloads error', err);
    return json({ ok: false, error: 'تعذّر جلب الروابط، ستصلك على بريدك' }, 502);
  }
};

export const config = { path: '/api/downloads' };
