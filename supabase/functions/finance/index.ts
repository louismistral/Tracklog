/* ============================================================
   finance — les comptes des business, lus chez Etsy et Gelato.
   ------------------------------------------------------------
   Une fonction et pas la page, pour les mêmes raisons qu'avant :
   Etsy ne répond pas aux navigateurs (pas de CORS), et un jeton
   de boutique ou une clé Gelato ne descendent jamais dans la page.

   Un business = une boutique Etsy, reliée par OAuth (une ligne
   `service_connections`, service `etsy:<business>`). Redline a en
   plus Gelato, qui imprime et livre : sa clé est un secret.

   La synchro relit TOUT l'historique et remplace ce qui était en
   base pour ce business : ~500 lignes, et c'est ce qui garantit
   qu'un remboursement ou une correction d'Etsy après coup se
   retrouve dans les chiffres sans logique de rattrapage.

   Secrets : ETSY_CLIENT_ID (keystring de l'app Etsy), ETSY_SECRET
   (son « shared secret », pour l'en-tête x-api-key « key:secret »),
   GELATO_API_KEY. Le redirect URI de l'app Etsy doit être
   `${SUPABASE_URL}/functions/v1/finance/callback`.

   Déploiement : supabase functions deploy finance --no-verify-jwt
   (/callback est ouvert par Etsy sans session ; les autres routes
   vérifient la session elles-mêmes).

   Routes :
     POST /start      {business} → { url } à ouvrir pour autoriser
     GET  /callback   → Etsy y renvoie ; range les jetons
     GET  /status     → { businesses: { id: {connected, label, syncedAt, error} } }
     POST /disconnect {business}
     POST /sync       {business?} → relit et réécrit ; sans business, tous
   ============================================================ */

const ETSY_CLIENT_ID = Deno.env.get('ETSY_CLIENT_ID') ?? '';
const ETSY_SECRET = Deno.env.get('ETSY_SECRET') ?? '';
const GELATO_API_KEY = Deno.env.get('GELATO_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/finance/callback`;
const ETSY_SCOPES = 'transactions_r shops_r billing_r';
const ETSY_API = 'https://openapi.etsy.com/v3/application';
const ETSY_TOKEN = 'https://api.etsy.com/v3/public/oauth/token';
const GELATO_ORDER = 'https://order.gelatoapis.com/v4';
const API_KEY = ETSY_SECRET ? `${ETSY_CLIENT_ID}:${ETSY_SECRET}` : ETSY_CLIENT_ID;

/* Les business connus. `gelato` : ses commandes Gelato sont le coût de
   production. `unitCosts` : un business qui produit lui-même (Arro, impression
   3D) — coût par taille, timbre par défaut, corrigeables commande par commande
   dans la page (table `finance_order_costs`). */
const BUSINESSES: Record<string, { label: string; gelato?: boolean; unitCosts?: boolean }> = {
  redline: { label: 'Redline Editions', gelato: true },
  arro: { label: 'Arro Designs', unitCosts: true },
};

// Le fuseau qui découpe les journées (une vente de 23 h 40 reste ce jour-là).
const dayFmt = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
const dayOf = (sec: number) => dayFmt.format(new Date(sec * 1000));

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/* ---- La base, en clé de service : chaque requête porte son user_id ---- */
const db = async (path: string, init: RequestInit = {}) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json',
               Prefer: 'return=representation', ...(init.headers || {}) },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`base: ${r.status} ${text}`);
  return text ? JSON.parse(text) : null;
};

const whoami = async (req: Request): Promise<string | null> => {
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: auth, apikey: SUPABASE_ANON_KEY } });
  if (!r.ok) return null;
  return (await r.json())?.id || null;
};

/* ---- OAuth Etsy (PKCE) ---- */
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
const challengeOf = async (v: string) => b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))));

const etsyToken = async (body: Record<string, string>) => {
  const r = await fetch(ETSY_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                                      body: new URLSearchParams(body).toString() });
  const text = await r.text();
  if (!r.ok) throw new Error(`etsy oauth: ${r.status} ${text}`);
  return JSON.parse(text);
};

type Conn = { user_id: string; service: string; external_id: string | null; label: string | null;
              access_token: string; refresh_token: string | null; expires_at: number | null };

const connOf = async (userId: string, business: string): Promise<Conn | null> =>
  (await db(`service_connections?user_id=eq.${userId}&service=eq.etsy:${business}&select=*`))?.[0] || null;

// Un jeton Etsy vit une heure : renouvelé une minute avant l'échéance.
const freshToken = async (c: Conn) => {
  if (c.expires_at && c.expires_at > Date.now() + 60_000) return c.access_token;
  if (!c.refresh_token) return c.access_token;
  const t = await etsyToken({ grant_type: 'refresh_token', client_id: ETSY_CLIENT_ID, refresh_token: c.refresh_token });
  const patch = { access_token: t.access_token, refresh_token: t.refresh_token || c.refresh_token,
                  expires_at: Date.now() + (Number(t.expires_in) || 3600) * 1000 };
  await db(`service_connections?user_id=eq.${c.user_id}&service=eq.${c.service}`, { method: 'PATCH', body: JSON.stringify(patch) });
  return patch.access_token;
};

const etsyGet = async (token: string, path: string) => {
  const r = await fetch(`${ETSY_API}${path}`, { headers: { Authorization: `Bearer ${token}`, 'x-api-key': API_KEY } });
  const text = await r.text();
  if (!r.ok) throw new Error(`etsy ${path.split('?')[0]}: ${r.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
};
const etsyAll = async (token: string, path: string) => {
  const out: any[] = [];
  for (let off = 0; off < 20000; off += 100){
    const page = await etsyGet(token, `${path}${path.includes('?') ? '&' : '?'}limit=100&offset=${off}`);
    out.push(...(page?.results || []));
    if ((page?.results || []).length < 100) break;
  }
  return out;
};
const money = (m: any) => (m && typeof m.amount === 'number') ? m.amount / (m.divisor || 100) : 0;
const r2 = (v: number) => Math.round(v * 100) / 100;

/* ---- Le grand livre Etsy → des lignes HT / TVA ------------------------------
   Même logique que l'export Redline (etsy/finances.py), qui a été vérifiée au
   centime contre la page « Bénéfices » d'une commande sur Etsy. */
const LABEL: Record<string, [string, string]> = {   // type → [section, ligne]
  PAYMENT_GROSS: ['Etsy', 'Ventes'], REFUND_GROSS: ['Etsy', 'Ventes'],   // une annulation s'annule dans les ventes
  PAYMENT_PROCESSING_FEE: ['Etsy', 'Frais de paiement'], REFUND_PROCESSING_FEE: ['Etsy', 'Frais de paiement'],
  transaction: ['Etsy', 'Frais de transaction'], transaction_quantity: ['Etsy', 'Frais de transaction'],
  transaction_refund: ['Etsy', 'Frais de transaction'],
  listing: ['Etsy', 'Mise en ligne'],
  renew_sold_auto: ['Etsy', 'Renouvellement après vente'], renew_sold_auto_refund: ['Etsy', 'Renouvellement après vente'],
  renew_sold: ['Etsy', 'Renouvellement après vente'], renew_expired: ['Etsy', 'Mise en ligne'], renew: ['Etsy', 'Mise en ligne'],
  prolist: ['Etsy', 'Pub Etsy Ads'], offsite_ads_fee: ['Etsy', 'Pub hors Etsy'], offsite_ads_fee_refund: ['Etsy', 'Pub hors Etsy'],
  regulatory_operating_fee: ['Etsy', 'Frais réglementaires'], regulatory_operating_fee_refund: ['Etsy', 'Frais réglementaires'],
  seller_onboarding_fee: ['Frais uniques', 'Ouverture de la boutique Etsy'],
  SELLER_DRIVEN_TRAFFIC_CREDIT: ['Etsy', 'Crédit trafic vendeur'],
  shipping_labels: ['Etsy', 'Étiquettes d’envoi'],
};
// Des mouvements d'argent, pas des gains ni des coûts.
const MOVES = new Set(['DISBURSE2', 'DISBURSE', 'billing_payment', 'seller_onboarding_fee_payment', 'DEPOSIT_FEE']);
const VAT_SERVICES = new Set(['vat_seller_services', 'vat_seller_services_refund']);
const TAXES = new Set(['sales_tax', 'sales_tax_refund', 'vat_on_processing_fees']);
// Les frais qui n'ont pas de TVA de service Etsy attachée.
const NO_SERVICE_VAT = new Set(['PAYMENT_GROSS', 'REFUND_GROSS', 'PAYMENT_PROCESSING_FEE', 'REFUND_PROCESSING_FEE', 'SELLER_DRIVEN_TRAFFIC_CREDIT']);
// Ce qui se rattache à une commande (sinon : hors commandes).
const ORDER_TYPES = /^(PAYMENT_|REFUND_|transaction|regulatory|offsite_ads)/;

type Line = { key: string; day: string; section: string; ligne: string; commande: string | null; ht: number; tva: number; _t?: string; _ref?: string };

const ledgerLines = async (token: string, shopId: string, since: number) => {
  const now = Math.floor(Date.now() / 1000);
  const seen = new Map<number, any>();
  for (let t = since; t < now; t += 2_600_000){   // l'API refuse plus de 31 jours par fenêtre
    for (const e of await etsyAll(token, `/shops/${shopId}/payment-account/ledger-entries?min_created=${t}&max_created=${Math.min(t + 2_600_000, now)}`))
      seen.set(e.entry_id, e);
  }
  const entries = [...seen.values()].sort((a, b) => a.sequence_number - b.sequence_number);

  const lines: Line[] = [];
  const open: Line[] = [];                                  // frais sans leur TVA de service encore
  const taxes = new Map<string, Record<string, number>>();  // référence → taxes à rattacher
  const unknown = new Set<string>();
  for (const e of entries){
    const k = String(e.ledger_type), amt = Number(e.amount) / 100, ref = String(e.reference_id);
    if (MOVES.has(k)) continue;
    if (TAXES.has(k)){ const m = taxes.get(ref) || {}; m[k] = (m[k] || 0) + amt; taxes.set(ref, m); continue; }
    if (VAT_SERVICES.has(k)){
      // La TVA d'un service Etsy n'a pas de référence : elle suit son frais
      // dans le registre, et vaut 20 % de lui (arrondi au centime).
      const cand = open.filter(l => Math.round(Math.abs(l.ht) * 20) === Math.round(Math.abs(amt) * 100));
      const l = (cand.length ? cand : open).at(-1);
      if (l){ l.tva = r2(l.tva + amt); open.splice(open.indexOf(l), 1); }
      continue;
    }
    const lab = LABEL[k];
    if (!lab){ unknown.add(k); continue; }
    const l: Line = { key: `e${e.entry_id}`, day: dayOf(Number(e.create_date)), section: lab[0], ligne: lab[1],
                      commande: null, ht: amt, tva: 0, _t: k, _ref: ref };
    if (k === 'REFUND_GROSS' && e.payment_adjustments?.[0]) l._ref = String(e.payment_adjustments[0].payment_id);
    if (!NO_SERVICE_VAT.has(k)) open.push(l);
    lines.push(l);
  }
  // Remboursement de frais de paiement : sa référence est l'ajustement → le paiement d'origine.
  const adj = new Map<string, string>();
  for (const e of entries) for (const a of (e.payment_adjustments || [])) adj.set(String(a.payment_adjustment_id), String(a.payment_id));
  for (const l of lines) if (l._t === 'REFUND_PROCESSING_FEE' && adj.has(l._ref!)) l._ref = adj.get(l._ref!);
  return { lines, taxes, unknown: [...unknown] };
};

/* ---- Gelato : le coût d'impression + livraison de chaque commande ---- */
const gelato = async (path: string, init: RequestInit = {}) => {
  const r = await fetch(`${GELATO_ORDER}${path}`, { ...init, headers: { 'X-API-KEY': GELATO_API_KEY, 'Content-Type': 'application/json',
    'User-Agent': 'Tracklog/1.0', ...(init.headers || {}) } });
  const text = await r.text();
  if (!r.ok) throw new Error(`gelato ${path}: ${r.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
};
// Commandes Gelato passées à la main, avant que la boutique soit reliée → leur vente Etsy.
const MANUAL: Record<string, string> = { 'G-260729221155': '4120993204' };

/* ---- Coûts d'un business qui produit lui-même (Arro) ----
   Valeurs de la page Notion « Arro Designs » → Finance : coût unitaire par
   taille (filament + carton + pochette + papier bulle + fournitures), socle en
   plus ; le timbre est une valeur par défaut, corrigée commande par commande. */
const ARRO_COSTS = { small: { base: 2.49, plain: 2.14, stamp: 4.8 }, large: { base: 5.20, plain: 4.00, stamp: 15.5 } };
const arroDefaults = (variant: string) => {
  const big = /18/.test(variant);
  const c = big ? ARRO_COSTS.large : ARRO_COSTS.small;
  const withBase = /socle|base|stand|avec/i.test(variant) && !/sans|without|no /i.test(variant);
  return { production: withBase ? c.base : c.plain, postage: c.stamp };
};

const syncBusiness = async (userId: string, business: string) => {
  const conf = BUSINESSES[business];
  const conn = await connOf(userId, business);
  if (!conn) throw new Error(`${conf.label} : boutique Etsy non connectée.`);
  const token = await freshToken(conn);
  const shopId = conn.external_id!;
  const shop = await etsyGet(token, `/shops/${shopId}`);
  const since = Number(shop.create_date || shop.created_timestamp || 0) - 86400;

  const { lines, taxes, unknown } = await ledgerLines(token, shopId, since);
  const receipts = await etsyAll(token, `/shops/${shopId}/receipts`);

  // Références Etsy → numéro de commande : paiement (ventes, frais de paiement), transaction (frais de transaction).
  const pays = [...new Set(lines.filter(l => /^(PAYMENT_|REFUND_)/.test(l._t!)).map(l => l._ref!))];
  const payToReceipt = new Map<string, string>();
  for (let i = 0; i < pays.length; i += 100){
    const r = await etsyGet(token, `/shops/${shopId}/payments?payment_ids=${pays.slice(i, i + 100).join(',')}`);
    for (const p of r.results || []) payToReceipt.set(String(p.payment_id), String(p.receipt_id));
  }
  const txToReceipt = new Map<string, string>();
  for (const rc of receipts) for (const t of rc.transactions || []) txToReceipt.set(String(t.transaction_id), String(rc.receipt_id));
  const receiptIds = new Set(receipts.map((r: any) => String(r.receipt_id)));
  for (const l of lines){
    if (!ORDER_TYPES.test(l._t!)) continue;
    const ref = l._ref!;
    l.commande = payToReceipt.get(ref) || txToReceipt.get(ref) || (receiptIds.has(ref) ? ref : null);
  }
  // Taxes : taxe acheteur → ligne de vente (+ sa ligne « reversée »), TVA des frais de paiement → frais de paiement.
  const byReceipt = new Map<string, Record<string, number>>();
  for (const [ref, t] of taxes){
    const m = byReceipt.get(ref) || {}; for (const [k, v] of Object.entries(t)) m[k] = (m[k] || 0) + v; byReceipt.set(ref, m);
  }
  const extra: Line[] = [];
  for (const l of lines){
    const t = l.commande ? byReceipt.get(l.commande) : null;
    if (!t) continue;
    if (l._t === 'PAYMENT_GROSS' || l._t === 'REFUND_GROSS'){
      const k = l._t === 'PAYMENT_GROSS' ? 'sales_tax' : 'sales_tax_refund';
      const tax = -(t[k] || 0); delete t[k];
      if (tax){
        l.tva = r2(tax); l.ht = r2(l.ht - tax);
        // Comme sur Etsy : la taxe de l'acheteur entre avec la vente et repart aussitôt.
        extra.push({ key: `${l.key}t`, day: l.day, section: 'Etsy', ligne: 'Taxe acheteur reversée', commande: l.commande, ht: 0, tva: -tax });
      }
    } else if (l._t === 'PAYMENT_PROCESSING_FEE'){
      l.tva = r2(l.tva + (t.vat_on_processing_fees || 0)); delete t.vat_on_processing_fees;
    }
  }
  lines.push(...extra);

  // Commandes : une ligne par commande Etsy, coûts de production compris.
  const prodLines: Line[] = [];
  if (conf.gelato && GELATO_API_KEY){
    const orders: any[] = [];
    for (let off = 0; ; off += 100){
      const r = await gelato('/orders:search', { method: 'POST', body: JSON.stringify({ limit: 100, offset: off }) });
      orders.push(...(r.orders || []));
      if ((r.orders || []).length < 100) break;
    }
    // shortcut: un appel de détail par commande à chaque synchro ; à mettre en cache au-delà de quelques centaines de commandes.
    for (const o of orders){
      if (o.fulfillmentStatus === 'canceled') continue;
      const d = await gelato(`/orders/${o.id}`);
      const ht = (d.items || []).reduce((s: number, i: any) => s + Number(i.price || 0), 0) + Number(d.shipment?.price || 0);
      const total = Number(o.totalInclVat || 0);
      const ref = MANUAL[o.orderReferenceId] || o.orderReferenceId;
      prodLines.push({ key: `g${o.id}`, day: dayOf(Date.parse(o.createdAt) / 1000), section: 'Gelato', ligne: 'Production + livraison',
                       commande: /^\d+$/.test(ref) ? ref : null, ht: -r2(ht), tva: -r2(total - ht) });
    }
  }
  let overrides = new Map<string, any>();
  if (conf.unitCosts){
    const rows = await db(`finance_order_costs?user_id=eq.${userId}&business=eq.${business}&select=*`);
    overrides = new Map((rows || []).map((r: any) => [r.commande, r]));
  }

  const orders = receipts.map((rc: any) => {
    const k = String(rc.receipt_id), t = rc.transactions?.[0] || {};
    const day = dayOf(Number(rc.created_timestamp ?? rc.create_timestamp));
    const variante = (t.variations || []).map((v: any) => v.formatted_value).join(' · ');
    const canceled = rc.status === 'Canceled';
    if (conf.unitCosts && !canceled){
      const ov = overrides.get(k), def = (rc.transactions || []).reduce((s: any, tr: any) => {
        const d = arroDefaults((tr.variations || []).map((v: any) => v.formatted_value).join(' '));
        return { production: s.production + d.production * (tr.quantity || 1), postage: Math.max(s.postage, d.postage) };
      }, { production: 0, postage: 0 });
      const production = ov?.production ?? def.production, postage = ov?.postage ?? def.postage;
      prodLines.push({ key: `p${k}`, day, section: 'Production', ligne: 'Impression + emballage', commande: k, ht: -r2(production), tva: 0 });
      prodLines.push({ key: `s${k}`, day, section: 'Production', ligne: 'Timbre', commande: k, ht: -r2(postage), tva: 0 });
    }
    return { commande: k, day, produit: String(t.title || '').split('|')[0].trim() + ((rc.transactions || []).length > 1 ? ` +${rc.transactions.length - 1}` : ''),
             variante, statut: canceled ? 'Annulée' : '', edited: overrides.has(k) };
  });
  lines.push(...prodLines);
  for (const o of orders){
    const mine = lines.filter(l => l.commande === o.commande);
    const sum = (f: (l: Line) => boolean, v: (l: Line) => number) => r2(mine.filter(f).reduce((s, l) => s + v(l), 0));
    Object.assign(o, {
      prix_ht: sum(l => l.ligne === 'Ventes', l => l.ht),
      taxe_acheteur: sum(l => l.ligne === 'Ventes', l => l.tva),
      frais_etsy: sum(l => l.section === 'Etsy' && l.ligne !== 'Ventes' && l.ligne !== 'Taxe acheteur reversée', l => l.ht + l.tva),
      couts: sum(l => l.section === 'Gelato' || l.section === 'Production', l => l.ht + l.tva),
      net: sum(() => true, l => l.ht + l.tva),
    });
  }

  // Remplacer ce business en entier : effacer puis écrire.
  const rows = lines.map(l => ({ user_id: userId, business, key: l.key, day: l.day, section: l.section, ligne: l.ligne,
                                 commande: l.commande, ht: r2(l.ht), tva: r2(l.tva) }));
  await db(`finance_lines?user_id=eq.${userId}&business=eq.${business}`, { method: 'DELETE' });
  for (let i = 0; i < rows.length; i += 500) await db('finance_lines', { method: 'POST', body: JSON.stringify(rows.slice(i, i + 500)) });
  await db(`finance_orders?user_id=eq.${userId}&business=eq.${business}`, { method: 'DELETE' });
  if (orders.length) await db('finance_orders', { method: 'POST', body: JSON.stringify(orders.map((o: any) => ({ user_id: userId, business, ...o }))) });
  const note = unknown.length ? `Types Etsy ignorés : ${unknown.join(', ')}` : (conf.gelato && !GELATO_API_KEY ? 'Gelato non lu (secret GELATO_API_KEY absent).' : null);
  await db('finance_sync', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ user_id: userId, business, synced_at: Date.now(), error: note }) });
  return { business, lines: rows.length, orders: orders.length, note };
};

const page = (title: string, body: string) => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
   <style>body{font:16px/1.5 system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#111;color:#eee;padding:24px;text-align:center}p{max-width:32em;color:#aaa}</style>
   <div><h1>${title}</h1><p>${body}</p></div>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = new URL(req.url);
  const route = url.pathname.replace(/^.*\/finance/, '') || '/';
  if (!ETSY_CLIENT_ID){
    const msg = "La fonction n'a pas de clé Etsy (secret ETSY_CLIENT_ID).";
    return route === '/callback' ? page('Configuration manquante', msg) : json({ error: msg }, 500);
  }
  try {
    if (route === '/callback'){
      const code = url.searchParams.get('code'), state = url.searchParams.get('state') || '';
      if (url.searchParams.get('error')) return page('Connexion annulée', "Aucun accès n'a été donné à Tracklog.");
      if (!code || !state) return page('Lien incomplet', 'Recommencez depuis Tracklog.');
      const p = (await db(`oauth_pending?state=eq.${encodeURIComponent(state)}&select=*`))?.[0];
      if (!p) return page('Demande expirée', 'Recommencez depuis Tracklog.');
      await db(`oauth_pending?state=eq.${encodeURIComponent(state)}`, { method: 'DELETE' });
      const t = await etsyToken({ grant_type: 'authorization_code', client_id: ETSY_CLIENT_ID, redirect_uri: REDIRECT_URI,
                                  code, code_verifier: p.verifier });
      const etsyUser = String(t.access_token).split('.')[0];
      const shops = await etsyGet(t.access_token, `/users/${etsyUser}/shops`);
      const shop = shops?.results?.[0] || shops;
      if (!shop?.shop_id) return page('Pas de boutique', "Ce compte Etsy n'a pas de boutique.");
      await db('service_connections', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ user_id: p.user_id, service: p.service, external_id: String(shop.shop_id), label: shop.shop_name || null,
          access_token: t.access_token, refresh_token: t.refresh_token || null,
          expires_at: Date.now() + (Number(t.expires_in) || 3600) * 1000, connected_at: Date.now() }) });
      return page('Boutique connectée', `${shop.shop_name || ''} — fermez cet onglet et revenez dans Tracklog.`);
    }

    const userId = await whoami(req);
    if (!userId) return json({ error: 'Non authentifié.' }, 401);
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const business = String(body?.business || '');
    if (business && !BUSINESSES[business]) return json({ error: 'Business inconnu.' }, 400);

    if (route === '/start'){
      if (!business) return json({ error: 'Quel business ?' }, 400);
      const verifier = randomToken(), state = randomToken();
      await db('oauth_pending', { method: 'POST', body: JSON.stringify({ state, user_id: userId, service: `etsy:${business}`, verifier, created_at: Date.now() }) });
      const q = new URLSearchParams({ response_type: 'code', client_id: ETSY_CLIENT_ID, redirect_uri: REDIRECT_URI, scope: ETSY_SCOPES,
        state, code_challenge: await challengeOf(verifier), code_challenge_method: 'S256' });
      return json({ url: `https://www.etsy.com/oauth/connect?${q}` });
    }
    if (route === '/status'){
      const conns = await db(`service_connections?user_id=eq.${userId}&service=like.etsy:*&select=service,label`);
      const syncs = await db(`finance_sync?user_id=eq.${userId}&select=*`);
      const out: Record<string, unknown> = {};
      for (const [id, b] of Object.entries(BUSINESSES)){
        const c = (conns || []).find((x: any) => x.service === `etsy:${id}`), s = (syncs || []).find((x: any) => x.business === id);
        out[id] = { label: b.label, connected: !!c, shop: c?.label || null, syncedAt: s?.synced_at || null, note: s?.error || null };
      }
      return json({ businesses: out });
    }
    if (route === '/disconnect'){
      if (!business) return json({ error: 'Quel business ?' }, 400);
      await db(`service_connections?user_id=eq.${userId}&service=eq.etsy:${business}`, { method: 'DELETE' });
      return json({ ok: true });
    }
    if (route === '/sync'){
      const ids = business ? [business] : Object.keys(BUSINESSES);
      const results = [];
      for (const id of ids){
        if (!business && !(await connOf(userId, id))) continue;
        try { results.push(await syncBusiness(userId, id)); }
        catch (e){ results.push({ business: id, error: String((e as Error).message || e) }); }
      }
      return json({ results });
    }
    return json({ error: 'Route inconnue.' }, 404);
  } catch (e){
    const msg = String((e as Error)?.message || e);
    return route === '/callback' ? page('Ça a raté', msg) : json({ error: msg }, 502);
  }
});
