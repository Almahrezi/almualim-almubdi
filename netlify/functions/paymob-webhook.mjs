// Paymob يرسل هنا تفاصيل كل عملية دفع. نتحقق من التوقيع، ونسجّل الطلبات الناجحة في ورقة Orders.
import { config as cfgFn, json, hmacForCallback, sameHmac } from '../lib/paymob.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json({ ok: false }, 405);
  const cfg = cfgFn();
  const hmac = new URL(req.url).searchParams.get('hmac');

  let body;
  try { body = await req.json(); } catch { return json({ ok: false }, 400); }
  const obj = body && body.obj;
  if (!obj || body.type !== 'TRANSACTION') return json({ ok: true, ignored: true });

  if (!cfg.hmacSecret || !sameHmac(hmacForCallback(obj, cfg.hmacSecret), hmac)) {
    console.warn('paymob webhook: invalid hmac for txn', obj.id);
    return json({ ok: false, error: 'invalid signature' }, 401);
  }

  const paid = obj.success === true && !obj.pending && !obj.is_voided && !obj.is_refunded;
  if (!paid) return json({ ok: true, recorded: false });

  const order = obj.order || {};
  const bill = (obj.payment_key_claims && obj.payment_key_claims.billing_data) || order.shipping_data || {};
  const items = (order.items || []).map(i => i.name + ' × ' + (i.quantity || 1)).join('، ');
  const record = {
    txn: String(obj.id),
    ref: String(order.merchant_order_id || (obj.payment_key_claims && obj.payment_key_claims.extra && obj.payment_key_claims.extra.ref) || ''),
    status: 'مدفوع',
    amount: (Number(obj.amount_cents) || 0) / cfg.multiplier,
    currency: obj.currency || cfg.currency,
    name: [bill.first_name, bill.last_name].filter(v => v && v !== 'NA').join(' '),
    phone: bill.phone_number || '',
    email: bill.email || '',
    items,
  };

  if (cfg.ordersKey && cfg.productsApi) {
    try {
      const res = await fetch(cfg.productsApi, {
        method: 'POST', redirect: 'follow',
        body: JSON.stringify({ action: 'order', ordersKey: cfg.ordersKey, order: record }),
      });
      const out = await res.json().catch(() => ({}));
      if (!out.ok) console.error('order log failed', JSON.stringify(out).slice(0, 300));
    } catch (err) {
      console.error('order log error', err);
    }
  }
  return json({ ok: true, recorded: true });
};

export const config = { path: '/api/paymob-webhook' };
