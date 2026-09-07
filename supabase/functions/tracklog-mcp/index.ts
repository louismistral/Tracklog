/* ============================================================
   tracklog-mcp — le carnet de Tracklog, ouvert à Claude.
   ------------------------------------------------------------
   Pourquoi il existe : estimer les macros d'une assiette coûte
   des tokens. Fait depuis l'app (`analyse-repas`), c'est une
   clé API qui paie ; fait depuis une conversation Claude, c'est
   l'abonnement, déjà payé. Le sens de l'appel s'inverse donc :
   ce n'est plus Tracklog qui appelle Claude, c'est Claude qui
   écrit dans Tracklog. « Rentre ça dans Tracklog » devient un
   appel d'outil, et la ligne apparaît dans la journée.

   Ce serveur parle MCP (Streamable HTTP) et se branche dans
   Claude en « connecteur personnalisé ». Anthropic l'appelle
   depuis SON infrastructure, pas depuis le téléphone : d'où un
   serveur distant et joignable publiquement, et non un serveur
   local — c'est aussi ce qui le rend utilisable depuis l'app
   mobile, là où on photographie une assiette.

   Deux outils, volontairement :
     tracklog_ajout_rapide — écrire une ligne dans la journée.
     tracklog_journee      — lire une journée (lignes, totaux,
                             objectifs du jour, ce qu'il reste).
   Rien d'autre. Pas de suppression, pas de modification, pas
   d'accès aux trackers : l'endpoint est public par nature (voir
   l'authentification ci-dessous), donc sa surface est ce qu'on
   accepte de perdre, pas ce qu'on aimerait pouvoir faire.

   Authentification — à lire avant de déployer.
   L'UI des connecteurs de claude.ai ne propose pas d'en-tête
   statique fiable aujourd'hui, et OAuth complet serait
   disproportionné pour un carnet personnel. Le jeton voyage
   donc dans l'URL, en dernier segment :
       https://<projet>.supabase.co/functions/v1/tracklog-mcp/<JETON>
   Conséquence à assumer : **cette URL est un mot de passe**.
   Qui l'a peut lire et écrire la journée alimentaire de l'unique
   compte visé — rien d'autre, et rien de destructif. Un
   `Authorization: Bearer <JETON>` est accepté aussi, pour les
   clients qui savent poser un en-tête (Claude Code, Desktop).

   Le compte visé est nommé en dur par un secret : la base porte
   plusieurs comptes, il ne se devine pas. Si un jour ce serveur
   doit servir plus d'une personne, la bonne forme n'est pas un
   second secret mais une table `mcp_tokens (token_hash, user_id)`
   — un jeton par personne, révocable sans redéploiement.

   Déploiement :
     supabase secrets set TRACKLOG_MCP_TOKEN=<jeton long et aléatoire>
     supabase secrets set TRACKLOG_MCP_USER_ID=<uuid du compte>
     supabase functions deploy tracklog-mcp --no-verify-jwt

   `--no-verify-jwt` est obligatoire : Anthropic n'a pas de session
   Supabase à présenter. C'est le jeton ci-dessus qui garde la porte,
   et c'est pourquoi la surface est si étroite.
   ============================================================ */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const MCP_TOKEN    = Deno.env.get('TRACKLOG_MCP_TOKEN');
const MCP_USER_ID  = Deno.env.get('TRACKLOG_MCP_USER_ID');

/* Le serveur tourne en UTC ; l'utilisateur, non. Sans ce fuseau, une
   collation notée à 00h30 à Genève atterrirait la veille — le genre
   d'erreur qu'on ne voit qu'en relisant ses graphes un mois après. */
const TZ = Deno.env.get('TRACKLOG_MCP_TZ') || 'Europe/Zurich';

const SERVER_NAME = 'tracklog';
const SERVER_VERSION = '1.0.0';

/* Les révisions successives du protocole ne changent rien à ce que ce
   serveur expose (des outils, et c'est tout) : on renvoie donc la version
   demandée par le client plutôt que d'en imposer une et de casser à la
   prochaine. La valeur ci-dessous ne sert que si le client n'en donne pas. */
const DEFAULT_PROTOCOL = '2025-06-18';

const MEALS = ['matin', 'midi', 'soir', 'collation'] as const;
const MEAL_LABELS: Record<string, string> = {
  matin: 'Petit-déjeuner', midi: 'Déjeuner', soir: 'Dîner', collation: 'Collation',
};

/* Les quatre macros de l'app, dans ses clés à elle. Le reste de Tracklog
   lit `nutriments.kcal`, `.protein`, `.carbs`, `.fat` — écrire autre chose
   produirait une ligne muette, visible mais comptée nulle part. */
const MACROS = [
  { key: 'kcal',    arg: 'kcal',      label: 'kcal' },
  { key: 'protein', arg: 'proteines', label: 'prot' },
  { key: 'carbs',   arg: 'glucides',  label: 'gluc' },
  { key: 'fat',     arg: 'lipides',   label: 'lip'  },
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-session-id, mcp-protocol-version',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

/* ---- Le jour et le repas, vus d'où vit l'utilisateur ---------------------- */

// `en-CA` rend justement AAAA-MM-JJ, la clé de jour de l'app.
function todayIn(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function hourIn(tz: string): number {
  return Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', hour12: false,
  }).format(new Date()));
}

// Mêmes bornes que `defaultMealForNow` côté app : un repas deviné doit
// tomber pareil, qu'on passe par l'écran ou par la conversation.
function defaultMeal(tz: string): string {
  const h = hourIn(tz);
  if (h < 11) return 'matin';
  if (h < 15) return 'midi';
  if (h < 18) return 'collation';
  return 'soir';
}

const isDayKey = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

// Même forme que `uid('fl_')` dans app.food.jsx : rien ne l'impose côté base,
// mais deux générateurs d'id pour une même table finissent par diverger.
const newLogId = () => 'fl_' + Math.random().toString(36).slice(2, 9);

/* ---- Accès base ----------------------------------------------------------
   La clé service-role court-circuite Row Level Security : elle ne doit donc
   JAMAIS servir sans filtrer sur `MCP_USER_ID` à la main. Chaque requête
   ci-dessous porte ce filtre — c'est lui qui remplace RLS ici. */

async function rest(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY ?? '',
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!r.ok) throw new Error(`base: ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.status === 204 ? null : await r.json();
}

const enc = encodeURIComponent;

async function readLogs(day: string) {
  return await rest(
    `food_logs?user_id=eq.${enc(MCP_USER_ID!)}&day=eq.${enc(day)}&select=name,meal,qty,unit,nutriments,ts&order=ts.asc`,
  ) as Array<Record<string, unknown>>;
}

/* Un objectif se lit TOUJOURS pour un jour donné : la table est datée
   (`from_day`), et le jour J suit la dernière consigne dont `from_day <= J`.
   Prendre « l'objectif » tout court jugerait le mois dernier à l'aune de la
   consigne d'aujourd'hui. L'ordre lexicographique des chaînes AAAA-MM-JJ est
   l'ordre chronologique : rien à convertir. */
async function readGoals(day: string) {
  const rows = await rest(
    `nutrition_goals?user_id=eq.${enc(MCP_USER_ID!)}&from_day=lte.${enc(day)}`
    + `&select=kcal,protein_g,carbs_g,fat_g,from_day&order=from_day.desc&limit=1`,
  ) as Array<Record<string, number | string>>;
  return rows?.[0] ?? null;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function totals(logs: Array<Record<string, unknown>>) {
  const out: Record<string, number> = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const l of logs) {
    const n = (l.nutriments ?? {}) as Record<string, unknown>;
    for (const m of MACROS) out[m.key] += num(n[m.key]);
  }
  for (const k in out) out[k] = Math.round(out[k] * 10) / 10;
  return out;
}

/* ---- Les outils ---------------------------------------------------------- */

const TOOLS = [
  {
    name: 'tracklog_ajout_rapide',
    description:
      "Note un aliment ou un repas estimé dans le journal alimentaire Tracklog de l'utilisateur. "
      + "À utiliser quand il dit « rentre ça dans Tracklog », « note ça », « ajoute ce repas ». "
      + "Écris les valeurs TOTALES de ce qui a été mangé (pas des valeurs pour 100 g) : "
      + "c'est un ajout rapide, la portion est déjà comprise dans les chiffres. "
      + "Estime les macros avant d'appeler, et annonce ce que tu vas noter.",
    inputSchema: {
      type: 'object',
      properties: {
        nom: { type: 'string', description: "Nom court et reconnaissable du plat, ex. « Poulet riz brocolis » ou « Sandwich jambon-beurre »." },
        kcal: { type: 'number', description: 'Calories totales de la portion mangée.' },
        proteines: { type: 'number', description: 'Protéines en grammes, pour la portion mangée.' },
        glucides: { type: 'number', description: 'Glucides en grammes, pour la portion mangée.' },
        lipides: { type: 'number', description: 'Lipides en grammes, pour la portion mangée.' },
        repas: { type: 'string', enum: [...MEALS], description: "Moment de la journée. Omets-le pour le déduire de l'heure qu'il est." },
        jour: { type: 'string', description: 'Jour au format AAAA-MM-JJ. Omets-le pour aujourd’hui.' },
      },
      required: ['nom', 'kcal'],
      additionalProperties: false,
    },
  },
  {
    name: 'tracklog_journee',
    description:
      "Lit une journée du journal Tracklog : les lignes déjà notées, les totaux, l'objectif "
      + "en vigueur ce jour-là et ce qu'il reste. À utiliser pour répondre à « il me reste combien "
      + "de protéines ? », « j'ai mangé quoi aujourd'hui ? », ou avant de proposer un repas.",
    inputSchema: {
      type: 'object',
      properties: {
        jour: { type: 'string', description: 'Jour au format AAAA-MM-JJ. Omets-le pour aujourd’hui.' },
      },
      additionalProperties: false,
    },
  },
];

function fmtTotals(t: Record<string, number>, goals: Record<string, number | string> | null) {
  const goalOf: Record<string, number | null> = goals
    ? { kcal: num(goals.kcal), protein: num(goals.protein_g), carbs: num(goals.carbs_g), fat: num(goals.fat_g) }
    : { kcal: null, protein: null, carbs: null, fat: null };
  return MACROS.map((m) => {
    const g = goalOf[m.key];
    if (!g) return `${m.label} ${t[m.key]}`;
    const left = Math.round((g - t[m.key]) * 10) / 10;
    return `${m.label} ${t[m.key]}/${g} (reste ${left})`;
  }).join(' · ');
}

async function runAjoutRapide(args: Record<string, unknown>) {
  const nom = String(args.nom ?? '').trim();
  if (!nom) throw new Error("Il faut un nom pour la ligne (paramètre `nom`).");

  const kcal = Number(args.kcal);
  if (!Number.isFinite(kcal) || kcal < 0) throw new Error('`kcal` doit être un nombre positif.');

  const day = args.jour ? String(args.jour) : todayIn(TZ);
  if (!isDayKey(day)) throw new Error('`jour` doit être au format AAAA-MM-JJ.');

  const meal = args.repas ? String(args.repas) : defaultMeal(TZ);
  if (!MEALS.includes(meal as typeof MEALS[number])) {
    throw new Error(`\`repas\` doit valoir ${MEALS.join(', ')}.`);
  }

  const nutriments: Record<string, number> = {};
  for (const m of MACROS) {
    const v = Number(args[m.arg]);
    if (Number.isFinite(v) && v >= 0) nutriments[m.key] = Math.round(v * 10) / 10;
  }

  /* Un ajout rapide n'est pas un item, et c'est délibéré : aucune fiche n'est
     créée dans la bibliothèque, et `food_id` reste nul — un lien qui ne mène
     nulle part ferait échouer l'insertion sur la clé étrangère. Les 100 g sont
     la convention de l'app pour une ligne dont le poids n'a pas de sens :
     invisible à l'écran, et les totaux du jour tombent juste. */
  const row = {
    id: newLogId(),
    user_id: MCP_USER_ID,
    day,
    meal,
    food_id: null,
    name: nom,
    brand: null,
    qty: 100,
    unit: 'g',
    grams: 100,
    nutriments,
    ts: Date.now(),
  };

  await rest('food_logs', { method: 'POST', body: JSON.stringify(row) });

  const logs = await readLogs(day);
  const goals = await readGoals(day);
  const t = totals(logs);
  const parts = MACROS.filter((m) => m.key in nutriments)
    .map((m) => `${nutriments[m.key]} ${m.label}`).join(', ');

  return `Noté dans Tracklog : « ${nom} » — ${parts} — ${MEAL_LABELS[meal]}, ${day}.\n`
       + `Total du jour : ${fmtTotals(t, goals)}.`;
}

async function runJournee(args: Record<string, unknown>) {
  const day = args.jour ? String(args.jour) : todayIn(TZ);
  if (!isDayKey(day)) throw new Error('`jour` doit être au format AAAA-MM-JJ.');

  const logs = await readLogs(day);
  const goals = await readGoals(day);
  const t = totals(logs);

  if (!logs.length) {
    return `Rien de noté le ${day}.\n`
         + (goals ? `Objectif du jour : ${fmtTotals({ kcal: 0, protein: 0, carbs: 0, fat: 0 }, goals)}.` : 'Aucun objectif réglé.');
  }

  const byMeal = MEALS.map((m) => {
    const lines = logs.filter((l) => l.meal === m);
    if (!lines.length) return null;
    const body = lines.map((l) => {
      const n = (l.nutriments ?? {}) as Record<string, unknown>;
      const macros = MACROS.map((x) => `${Math.round(num(n[x.key]) * 10) / 10} ${x.label}`).join(', ');
      return `  - ${l.name} — ${macros}`;
    }).join('\n');
    return `${MEAL_LABELS[m]} :\n${body}`;
  }).filter(Boolean).join('\n');

  return `Journée du ${day}\n${byMeal}\n\nTotal : ${fmtTotals(t, goals)}.`;
}

async function callTool(name: string, args: Record<string, unknown>) {
  if (name === 'tracklog_ajout_rapide') return await runAjoutRapide(args);
  if (name === 'tracklog_journee') return await runJournee(args);
  throw new Error(`Outil inconnu : ${name}`);
}

/* ---- JSON-RPC ------------------------------------------------------------ */

const rpcOk = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result });
const rpcErr = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });

async function handleRpc(msg: Record<string, unknown>) {
  const { method, id, params } = msg as { method?: string; id?: unknown; params?: Record<string, unknown> };

  if (method === 'initialize') {
    const asked = String(params?.protocolVersion ?? '') || DEFAULT_PROTOCOL;
    return rpcOk(id, {
      protocolVersion: asked,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      instructions:
        "Journal alimentaire personnel. `tracklog_ajout_rapide` note un repas estimé "
        + "(valeurs totales de la portion, pas pour 100 g) ; `tracklog_journee` lit une journée. "
        + "Estime les macros toi-même, annonce ce que tu vas noter, puis écris.",
    });
  }

  if (method === 'ping') return rpcOk(id, {});
  if (method === 'tools/list') return rpcOk(id, { tools: TOOLS });

  if (method === 'tools/call') {
    const name = String(params?.name ?? '');
    const args = (params?.arguments ?? {}) as Record<string, unknown>;
    try {
      const text = await callTool(name, args);
      return rpcOk(id, { content: [{ type: 'text', text }] });
    } catch (e) {
      /* Une erreur d'outil se rend DANS le résultat, pas en erreur JSON-RPC :
         le modèle doit pouvoir la lire et corriger son appel, là où une erreur
         de protocole casse la conversation. */
      return rpcOk(id, {
        content: [{ type: 'text', text: `Échec : ${e instanceof Error ? e.message : String(e)}` }],
        isError: true,
      });
    }
  }

  return rpcErr(id, -32601, `Méthode inconnue : ${method}`);
}

/* ---- Porte d'entrée ------------------------------------------------------ */

// Comparaison à temps constant : sur un jeton, une comparaison qui s'arrête au
// premier caractère faux se mesure.
function sameToken(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authorized(req: Request): boolean {
  if (!MCP_TOKEN) return false;
  const auth = req.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ') && sameToken(auth.slice(7).trim(), MCP_TOKEN)) return true;
  // Le jeton en dernier segment d'URL — le seul chemin que l'UI des
  // connecteurs de claude.ai sait emprunter aujourd'hui.
  const last = new URL(req.url).pathname.split('/').filter(Boolean).pop() ?? '';
  return sameToken(decodeURIComponent(last), MCP_TOKEN);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (!SUPABASE_URL || !SERVICE_KEY || !MCP_TOKEN || !MCP_USER_ID) {
    return json({ error: 'Fonction non configurée : secrets TRACKLOG_MCP_TOKEN et TRACKLOG_MCP_USER_ID manquants.' }, 500);
  }
  if (!authorized(req)) return json({ error: 'Non autorisé.' }, 401);

  // Ce serveur est sans état : rien à ouvrir, rien à fermer. Un GET (flux SSE
  // ouvert par le serveur) n'a donc rien à porter, et un DELETE de session
  // réussit sans rien faire.
  if (req.method === 'GET') return new Response('Method Not Allowed', { status: 405, headers: CORS });
  if (req.method === 'DELETE') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(rpcErr(null, -32700, 'JSON invalide.'), 400);
  }

  // Un lot est permis par JSON-RPC ; Claude n'en envoie pas, mais un lot rejeté
  // se diagnostique mal — quelques lignes valent mieux qu'un mystère.
  const msgs = Array.isArray(body) ? body : [body];
  const replies = [];
  for (const m of msgs) {
    // Une notification (pas d'`id`) n'attend aucune réponse — `initialized`
    // arrive juste après la poignée de main.
    if (m && typeof m === 'object' && !('id' in m)) continue;
    replies.push(await handleRpc(m as Record<string, unknown>));
  }

  if (!replies.length) return new Response(null, { status: 202, headers: CORS });
  return json(Array.isArray(body) ? replies : replies[0]);
});
