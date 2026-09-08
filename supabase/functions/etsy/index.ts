/* ============================================================
   etsy — la passerelle vers un service extérieur.
   ------------------------------------------------------------
   Pourquoi une fonction et pas un appel depuis la page :

     1. L'API d'Etsy ne répond pas aux navigateurs (aucun en-tête
        CORS) : même avec un jeton valide, `fetch` depuis la page
        serait refusé avant d'avoir commencé.
     2. Un jeton Etsy vaut un accès à la boutique. Il vit donc en
        base, dans une table que la clé anon ne peut pas lire
        (RLS activée, aucune policy), et seule cette fonction —
        qui parle avec la clé de service — y touche. Même
        raisonnement que pour la clé Anthropic : ce que le
        navigateur ne voit jamais ne peut pas fuir.

   Ce qu'il faut lui donner : le secret ETSY_CLIENT_ID (le
   « keystring » de l'application Etsy). Pas de secret client —
   OAuth d'Etsy impose PKCE, qui existe précisément pour s'en
   passer.

   Déploiement :
     supabase secrets set ETSY_CLIENT_ID=...
     supabase functions deploy etsy --no-verify-jwt

   `--no-verify-jwt` est obligatoire : /callback est ouvert par
   Etsy dans le navigateur, sans jeton Supabase. Toutes les
   autres routes vérifient la session à la main (voir `whoami`).

   Routes :
     POST /etsy/start      → { url } à ouvrir pour autoriser
     GET  /etsy/callback   → Etsy y renvoie ; range les jetons
     GET  /etsy/status     → { connected, label }
     POST /etsy/disconnect → oublie les jetons
     POST /etsy/sync       → { days: { 'AAAA-MM-JJ': nombre } }
     GET  /etsy/probe      → un échantillon brut, pour calibrer
   ============================================================ */

const ETSY_CLIENT_ID = Deno.env.get('ETSY_CLIENT_ID');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/etsy/callback`;
const ETSY_SCOPES = 'transactions_r shops_r';
const ETSY_API = 'https://openapi.etsy.com/v3/application';
const ETSY_TOKEN = 'https://api.etsy.com/v3/public/oauth/token';

// Le fuseau qui découpe les journées. Une commande de 23 h 40 appartient au
// jour qu'on a vécu, pas à celui d'UTC — sinon un quart des ventes du soir
// atterrirait sur le lendemain dans le tracker.
const TZ = 'Europe/Paris';
const dayFmt = new Intl.DateTimeFormat('fr-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});
const dayOf = (epochSeconds: number) => dayFmt.format(new Date(epochSeconds * 1000));

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/* ---- La base, en clé de service -------------------------------------------
   PostgREST plutôt qu'un client : trois requêtes en tout, importer la
   bibliothèque coûterait plus cher que les écrire. */
const db = async (path: string, init: RequestInit = {}) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
      ...(init.headers || {}),
    },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`base: ${r.status} ${text}`);
  return text ? JSON.parse(text) : null;
};

// Qui appelle. La plateforme ne vérifie plus le jeton pour nous (voir
// --no-verify-jwt), donc on le fait ici, sur toutes les routes sauf /callback.
const whoami = async (req: Request): Promise<string | null> => {
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: SUPABASE_ANON_KEY },
  });
  if (!r.ok) return null;
  const u = await r.json();
  return u?.id || null;
};

/* ---- PKCE ------------------------------------------------------------------
   Un secret jetable inventé ici, dont seul le condensé part chez Etsy : le
   code d'autorisation intercepté en route ne sert alors à personne. */
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
const challengeOf = async (verifier: string) =>
  b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));

/* ---- Les jetons ------------------------------------------------------------
   Etsy accepte le JSON sur son point de jeton ; certaines passerelles ne
   veulent que le formulaire. On tente l'un puis l'autre plutôt que de parier. */
const etsyToken = async (body: Record<string, string>) => {
  let r = await fetch(ETSY_TOKEN, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok){
    r = await fetch(ETSY_TOKEN, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });
  }
  const text = await r.text();
  if (!r.ok) throw new Error(`etsy oauth: ${r.status} ${text}`);
  return JSON.parse(text);
};

type Conn = {
  user_id: string; service: string; external_id: string | null; label: string | null;
  access_token: string; refresh_token: string | null; expires_at: number | null; connected_at: number | null;
};

const connectionOf = async (userId: string): Promise<Conn | null> => {
  const rows = await db(`service_connections?user_id=eq.${userId}&service=eq.etsy&select=*`);
  return rows?.[0] || null;
};

// Un jeton Etsy vit une heure. On le renouvelle une minute avant l'échéance
// plutôt qu'après le premier échec : une synchro qui part sur un jeton mort
// perdrait sa page en cours de route.
const freshToken = async (conn: Conn): Promise<string> => {
  if (conn.expires_at && conn.expires_at > Date.now() + 60_000) return conn.access_token;
  if (!conn.refresh_token) return conn.access_token;
  const t = await etsyToken({
    grant_type: 'refresh_token', client_id: ETSY_CLIENT_ID!, refresh_token: conn.refresh_token,
  });
  const patch = {
    access_token: t.access_token,
    refresh_token: t.refresh_token || conn.refresh_token,
    expires_at: Date.now() + (Number(t.expires_in) || 3600) * 1000,
  };
  await db(`service_connections?user_id=eq.${conn.user_id}&service=eq.etsy`,
    { method: 'PATCH', body: JSON.stringify(patch) });
  return patch.access_token;
};

const etsyGet = async (token: string, path: string) => {
  const r = await fetch(`${ETSY_API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'x-api-key': ETSY_CLIENT_ID! },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`etsy ${path}: ${r.status} ${text}`);
  return JSON.parse(text);
};

// Etsy pagine par 100. On suit jusqu'au bout plutôt que de tronquer : une
// synchro qui s'arrête à la centième commande écrirait des journées fausses
// sans le dire.
const etsyAll = async (token: string, path: string, cap = 5000) => {
  const out: any[] = [];
  for (let offset = 0; offset < cap; offset += 100){
    const sep = path.includes('?') ? '&' : '?';
    const page = await etsyGet(token, `${path}${sep}limit=100&offset=${offset}`);
    const rows = page?.results || [];
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
};

// Un montant Etsy est un entier et son diviseur ({amount:1234, divisor:100}).
const money = (m: any) => (m && typeof m.amount === 'number')
  ? m.amount / (m.divisor || 100) : 0;

/* ---- Les trois lectures possibles ------------------------------------------
   `revenue` et `orders` se lisent des commandes : ce que l'acheteur a payé, et
   combien de fois. `net` se lit du grand livre de paiement, seul endroit où
   les frais d'Etsy sont écrits — on en retire les virements vers la banque,
   qui ne sont pas un gain mais un déplacement d'argent déjà compté.

   Attention : `net` reste ce qu'ETSY sait. Le coût d'impression d'un poster
   n'est écrit nulle part chez eux ; ce chiffre est un bénéfice avant coût de
   production, pas après. */
const PAYOUT = /deposit|payout|transfer/i;

const dailyValues = async (token: string, shopId: string, metric: string, fromSec: number, toSec: number) => {
  const days: Record<string, number> = {};
  const add = (day: string, v: number) => { days[day] = (days[day] || 0) + v; };

  if (metric === 'net'){
    const rows = await etsyAll(token,
      `/shops/${shopId}/payment-account/ledger-entries?min_created=${fromSec}&max_created=${toSec}`);
    for (const e of rows){
      if (PAYOUT.test(String(e.ledger_type || ''))) continue;
      add(dayOf(Number(e.create_date)), Number(e.amount || 0) / 100);
    }
  } else {
    const rows = await etsyAll(token,
      `/shops/${shopId}/receipts?min_created=${fromSec}&max_created=${toSec}`);
    for (const r of rows){
      const day = dayOf(Number(r.created_timestamp ?? r.create_timestamp));
      add(day, metric === 'orders' ? 1 : money(r.grandtotal));
    }
  }
  // Deux décimales : un centime de flottant traîné jusque dans un graphe.
  for (const k of Object.keys(days)) days[k] = Math.round(days[k] * 100) / 100;
  return days;
};

const page = (title: string, body: string) => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
   <title>${title}</title>
   <style>body{font:16px/1.5 system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;
   background:#111;color:#eee;padding:24px;text-align:center}p{max-width:32em;color:#aaa}</style>
   <div><h1>${title}</h1><p>${body}</p></div>`,
  { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = new URL(req.url);
  const route = url.pathname.replace(/^.*\/etsy/, '') || '/';

  if (!ETSY_CLIENT_ID){
    const msg = "La fonction n'a pas de clé Etsy configurée (secret ETSY_CLIENT_ID).";
    return route === '/callback' ? page('Configuration manquante', msg) : json({ error: msg }, 500);
  }

  try {
    /* --- Etsy nous renvoie ici, dans le navigateur, sans session Supabase.
           C'est le `state` — tiré au sort, rangé en base, à usage unique — qui
           dit de quel compte il s'agit. --- */
    if (route === '/callback'){
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state') || '';
      const denied = url.searchParams.get('error');
      if (denied) return page('Connexion annulée', "Aucun accès n'a été donné à Tracklog.");
      if (!code || !state) return page('Lien incomplet', 'Recommencez depuis Tracklog.');

      const pend = await db(`oauth_pending?state=eq.${encodeURIComponent(state)}&select=*`);
      const p = pend?.[0];
      if (!p) return page('Demande expirée', 'Recommencez depuis Tracklog.');
      await db(`oauth_pending?state=eq.${encodeURIComponent(state)}`, { method: 'DELETE' });

      const t = await etsyToken({
        grant_type: 'authorization_code', client_id: ETSY_CLIENT_ID,
        redirect_uri: REDIRECT_URI, code, code_verifier: p.verifier,
      });
      // Le jeton d'Etsy commence par l'identifiant de l'utilisateur : « 12345.xxx ».
      const etsyUserId = String(t.access_token).split('.')[0];
      let shopId: string | null = null, shopName: string | null = null;
      try {
        const shops = await etsyGet(t.access_token, `/users/${etsyUserId}/shops`);
        const shop = shops?.results?.[0] || shops;
        shopId = shop?.shop_id ? String(shop.shop_id) : null;
        shopName = shop?.shop_name || null;
      } catch { /* la boutique se retrouvera à la première synchro */ }

      await db('service_connections', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({
          user_id: p.user_id, service: 'etsy', external_id: shopId, label: shopName,
          access_token: t.access_token, refresh_token: t.refresh_token || null,
          expires_at: Date.now() + (Number(t.expires_in) || 3600) * 1000,
          connected_at: Date.now(),
        }),
      });
      return page('Etsy est connecté', `${shopName ? shopName + ' — ' : ''}vous pouvez fermer cet onglet et revenir dans Tracklog.`);
    }

    const userId = await whoami(req);
    if (!userId) return json({ error: 'Non authentifié.' }, 401);

    if (route === '/start'){
      const verifier = randomToken();
      const state = randomToken();
      await db('oauth_pending', { method: 'POST', body: JSON.stringify({
        state, user_id: userId, service: 'etsy', verifier, created_at: Date.now(),
      })});
      const q = new URLSearchParams({
        response_type: 'code', client_id: ETSY_CLIENT_ID, redirect_uri: REDIRECT_URI,
        scope: ETSY_SCOPES, state, code_challenge: await challengeOf(verifier), code_challenge_method: 'S256',
      });
      return json({ url: `https://www.etsy.com/oauth/connect?${q}` });
    }

    if (route === '/status'){
      const c = await connectionOf(userId);
      return json({ connected: !!c, label: c?.label || null, shopId: c?.external_id || null,
                    connectedAt: c?.connected_at || null });
    }

    if (route === '/disconnect'){
      await db(`service_connections?user_id=eq.${userId}&service=eq.etsy`, { method: 'DELETE' });
      return json({ ok: true });
    }

    const conn = await connectionOf(userId);
    if (!conn) return json({ error: 'Compte Etsy non connecté.' }, 409);
    const token = await freshToken(conn);
    let shopId = conn.external_id;
    if (!shopId){
      const shops = await etsyGet(token, `/users/${String(token).split('.')[0]}/shops`);
      const shop = shops?.results?.[0] || shops;
      shopId = shop?.shop_id ? String(shop.shop_id) : null;
      if (shopId) await db(`service_connections?user_id=eq.${userId}&service=eq.etsy`,
        { method: 'PATCH', body: JSON.stringify({ external_id: shopId, label: shop?.shop_name || null }) });
    }
    if (!shopId) return json({ error: "Aucune boutique trouvée sur ce compte Etsy." }, 409);

    /* Un échantillon brut, pour vérifier une fois connecté que les champs lus
       sont bien ceux qu'Etsy envoie. Aucune donnée acheteur n'en sort : on ne
       demande que les commandes, et on n'en rend que la forme. */
    if (route === '/probe'){
      const receipts = await etsyGet(token, `/shops/${shopId}/receipts?limit=2`);
      let ledger: unknown = null;
      try { ledger = await etsyGet(token, `/shops/${shopId}/payment-account/ledger-entries?limit=5`); }
      catch (e){ ledger = { error: String(e) }; }
      return json({ shopId, receipts, ledger });
    }

    if (route === '/sync'){
      const body = await req.json().catch(() => ({}));
      const metric = ['revenue', 'net', 'orders'].includes(body?.metric) ? body.metric : 'revenue';
      const toSec = Math.floor((Number(body?.to) || Date.now()) / 1000);
      const fromSec = Math.floor((Number(body?.from) || Date.now() - 90 * 86400_000) / 1000);
      const days = await dailyValues(token, shopId, metric, fromSec, toSec);
      return json({ days, metric, from: fromSec * 1000, to: toSec * 1000, shop: conn.label });
    }

    return json({ error: 'Route inconnue.' }, 404);
  } catch (e){
    const msg = String((e as Error)?.message || e);
    return route === '/callback' ? page('Ça a raté', msg) : json({ error: msg }, 502);
  }
});
