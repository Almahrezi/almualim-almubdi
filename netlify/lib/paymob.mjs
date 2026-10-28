// أدوات مشتركة لربط Paymob — لا تضع أي مفاتيح هنا، المفاتيح توضع في إعدادات Netlify
import crypto from 'node:crypto';

const DEFAULT_PRODUCTS_API = 'https://script.google.com/macros/s/AKfycbzvlLoHcJkjhhbofkBolU6XCvbQO3dyj0uuTS9EBeWF0VhHu1TXDvz-13fLVJsD-g2J/exec';
const RICH_ID = 'mualim-mubdi';

const env = k => String(process.env[k] || '').trim();

export function config() {
  return {
    secretKey: env('PAYMOB_SECRET_KEY'),
    publicKey: env('PAYMOB_PUBLIC_KEY'),
    hmacSecret: env('PAYMOB_HMAC_SECRET'),
    integrations: env('PAYMOB_INTEGRATION_IDS').split(',').map(s => s.trim()).filter(Boolean)
      .map(s => (/^\d+$/.test(s) ? Number(s) : s)),
    apiBase: (env('PAYMOB_API_BASE') || 'https://oman.paymob.com').replace(/\/+$/, ''),
    checkoutBase: (env('PAYMOB_CHECKOUT_BASE') || 'https://om.checkout.paymob.com').replace(/\/+$/, ''),
    currency: env('PAYMOB_CURRENCY') || 'OMR',
    // الريال العماني = 1000 بيسة. Paymob يستقبل المبلغ بأصغر وحدة.
    multiplier: Number(env('PAYMOB_AMOUNT_MULTIPLIER')) || 1000,
    productsApi: env('PRODUCTS_API_URL') || DEFAULT_PRODUCTS_API,
    ordersKey: env('ORDERS_KEY'),
  };
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function loadProducts(cfg) {
  const res = await fetch(cfg.productsApi, { redirect: 'follow' });
  const data = await res.json();
  if (!data || !data.ok || !Array.isArray(data.products)) throw new Error('products_unavailable');
  return data.products;
}

export const checkoutMode = p =>
  (p.checkout === 'whatsapp' || (!p.checkout && String(p.id) === RICH_ID)) ? 'whatsapp' : 'online';

/* ---------- HMAC (SHA-512) حسب توثيق Paymob ---------- */
const FIELDS = ['amount_cents', 'created_at', 'currency', 'error_occured', 'has_parent_transaction', 'id',
  'integration_id', 'is_3d_secure', 'is_auth', 'is_capture', 'is_refunded', 'is_standalone_payment',
  'is_voided', 'order', 'owner', 'pending', 'source_data.pan', 'source_data.sub_type', 'source_data.type', 'success'];

const asStr = v => (v === null || v === undefined) ? '' : String(v);

export function hmacForCallback(obj, secret) {
  const pick = k => {
    if (k === 'order') return obj.order && typeof obj.order === 'object' ? obj.order.id : obj.order;
    return k.split('.').reduce((a, part) => (a == null ? a : a[part]), obj);
  };
  return sign(FIELDS.map(k => asStr(pick(k))).join(''), secret);
}

export function hmacForRedirect(params, secret) {
  const pick = k => (k === 'order' ? (params.get('order') ?? params.get('order_id')) : params.get(k));
  return sign(FIELDS.map(k => asStr(pick(k))).join(''), secret);
}

function sign(text, secret) {
  return crypto.createHmac('sha512', secret).update(text, 'utf8').digest('hex');
}

// توقيع داخلي لإثبات أن الطلب مدفوع (يُستخدم لتسليم روابط التنزيل)
export function signToken(text, cfg) {
  const key = (cfg.ordersKey || '') + '|' + (cfg.hmacSecret || '');
  return crypto.createHmac('sha256', key).update(String(text), 'utf8').digest('hex').slice(0, 40);
}

export function sameHmac(a, b) {
  const x = Buffer.from(String(a || '').toLowerCase());
  const y = Buffer.from(String(b || '').toLowerCase());
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}
