// ينشئ طلب دفع في Paymob ويعيد رابط صفحة الدفع.
// الأسعار تُحسب هنا من جدول المنتجات — لا يُعتمد على أي سعر يرسله المتصفح.
import { config as cfgFn, json, loadProducts, checkoutMode } from '../lib/paymob.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
  const cfg = cfgFn();
  if (!cfg.secretKey || !cfg.publicKey || !cfg.integrations.length) {
    return json({ ok: false, error: 'الدفع الإلكتروني غير مفعّل بعد. تواصل معنا عبر واتساب لإتمام طلبك.' }, 503);
  }

  let body;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'طلب غير صالح' }, 400); }

  // ---- بيانات العميل ----
  const c = body.customer || {};
  const name = String(c.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  const email = String(c.email || '').trim().slice(0, 120);
  let phone = String(c.phone || '').replace(/[\s\-()]/g, '');
  if (/^00/.test(phone)) phone = '+' + phone.slice(2);
  if (/^\d{8}$/.test(phone)) phone = '+968' + phone;
  if (/^\d{9,15}$/.test(phone)) phone = '+' + phone;
  if (name.length < 2) return json({ ok: false, error: 'اكتب اسمك' }, 400);
  if (!/^\+\d{8,15}$/.test(phone)) return json({ ok: false, error: 'رقم الهاتف غير صحيح' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: 'البريد الإلكتروني غير صحيح' }, 400);
  const [first, ...rest] = name.split(' ');
  const last = rest.join(' ') || first;

  // ---- المنتجات والأسعار ----
  let products;
  try { products = await loadProducts(cfg); }
  catch { return json({ ok: false, error: 'تعذّر تحميل المنتجات، حاول مرة أخرى' }, 502); }
  const byId = Object.fromEntries(products.map(p => [String(p.id), p]));

  const list = Array.isArray(body.items) ? body.items.slice(0, 30) : [];
  const items = [];
  for (const it of list) {
    const p = byId[String(it.id)];
    if (!p) return json({ ok: false, error: 'أحد المنتجات لم يعد متوفرًا، حدّث الصفحة' }, 409);
    if (checkoutMode(p) !== 'online') return json({ ok: false, error: '"' + p.name + '" يُطلب عبر واتساب' }, 400);
    const opts = Array.isArray(p.options) ? p.options : [];
    const oi = Number(it.opt);
    let price = Number(p.price) || 0, label = '';
    if (opts.length) {
      if (!(oi >= 0 && oi < opts.length)) return json({ ok: false, error: 'خيار غير صالح لـ "' + p.name + '"' }, 400);
      price = Number(opts[oi].price) || 0; label = String(opts[oi].label || '');
    }
    const qty = Math.max(1, Math.min(99, parseInt(it.qty, 10) || 1));
    const unit = Math.round(price * cfg.multiplier);
    if (unit <= 0) return json({ ok: false, error: 'سعر "' + p.name + '" غير صالح' }, 400);
    items.push({
      name: (p.name + (label ? ' - ' + label : '')).slice(0, 50),
      amount: unit,
      description: (p.desc || p.name).slice(0, 255),
      quantity: qty,
    });
  }
  if (!items.length) return json({ ok: false, error: 'السلة فارغة' }, 400);
  const amount = items.reduce((s, i) => s + i.amount * i.quantity, 0);

  // ---- إنشاء طلب الدفع ----
  const origin = new URL(req.url).origin;
  const ref = 'MM-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  const payload = {
    amount,
    currency: cfg.currency,
    payment_methods: cfg.integrations,
    items,
    billing_data: {
      first_name: first, last_name: last, email, phone_number: phone,
      country: 'OM', city: 'NA', state: 'NA', street: 'NA', building: 'NA',
      apartment: 'NA', floor: 'NA', postal_code: 'NA', shipping_method: 'NA',
    },
    customer: { first_name: first, last_name: last, email },
    special_reference: ref,
    notification_url: origin + '/api/paymob-webhook',
    redirection_url: origin + '/api/payment-return',
    extras: { ref },
  };

  let res, data;
  try {
    res = await fetch(cfg.apiBase + '/v1/intention/', {
      method: 'POST',
      headers: { 'Authorization': 'Token ' + cfg.secretKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    data = await res.json().catch(() => ({}));
  } catch (err) {
    console.error('paymob request failed', err);
    return json({ ok: false, error: 'تعذّر الاتصال ببوابة الدفع، حاول مرة أخرى' }, 502);
  }
  if (!res.ok || !data.client_secret) {
    console.error('paymob intention error', res.status, JSON.stringify(data).slice(0, 800));
    return json({ ok: false, error: 'رفضت بوابة الدفع الطلب. تواصل معنا إذا تكرر ذلك.', detail: JSON.stringify(data).slice(0, 300) }, 502);
  }

  const url = cfg.checkoutBase + '/?publicKey=' + encodeURIComponent(cfg.publicKey) +
              '&clientSecret=' + encodeURIComponent(data.client_secret);
  return json({ ok: true, url, ref });
};

export const config = { path: '/api/create-payment' };
