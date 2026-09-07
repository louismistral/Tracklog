/* ============================================================
   Banc d'essai de `supabase/functions/tracklog-mcp`.
   ------------------------------------------------------------
   La fonction tourne en Deno, chez Supabase, derrière un jeton,
   et n'est appelée que par l'infrastructure d'Anthropic : on ne
   peut ni la charger dans un navigateur ni la voir échouer de
   près. D'où ce banc — le seul endroit où son contrat se vérifie
   avant qu'un connecteur ne l'utilise pour de vrai.

   Il transpile le TypeScript, remplace le runtime Deno et
   PostgREST par des doublures, puis déroule la vraie poignée de
   main MCP : initialize, tools/list, tools/call, refus, jeton.
   Rien n'est envoyé sur le réseau et aucune base n'est touchée.

   Depuis la racine du dépôt :
     npx --yes esbuild supabase/functions/tracklog-mcp/index.ts \
       --format=cjs --platform=node --outfile=/tmp/mcp.cjs
     node tools/tracklog-mcp/test.cjs /tmp/mcp.cjs

   C'est le seul morceau de Tracklog qui se teste tout seul ; le
   reste de l'app se relit et s'essaie dans un navigateur.
   ============================================================ */

const TOKEN = 'jeton-de-test-tres-long-0123456789';
const USER  = '00000000-1111-2222-3333-444444444444';
const BASE  = 'https://projet.supabase.co';

// --- Faux PostgREST : garde les lignes insérées, sert les lectures. --------
let inserted = [];
let goalRows = [
  { user_id: USER, from_day: '2026-01-01', kcal: 2000, protein_g: 140, carbs_g: 200, fat_g: 60 },
  { user_id: USER, from_day: '2026-09-01', kcal: 2400, protein_g: 170, carbs_g: 240, fat_g: 70 },
];
let restCalls = [];

globalThis.fetch = async (url, init = {}) => {
  restCalls.push({ url: String(url), method: init.method || 'GET' });
  const u = new URL(String(url));
  const p = u.pathname;
  const q = u.searchParams;
  const ok = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });

  if (p.endsWith('/rest/v1/food_logs') && (init.method || 'GET') === 'POST') {
    const row = JSON.parse(init.body);
    if (globalThis.__fkError)
      return new Response(JSON.stringify({ code: '23503', message: 'insert or update on table "food_logs" violates foreign key constraint "food_logs_user_id_fkey"' }), { status: 409 });
    if (row.food_id !== null && row.food_id !== undefined)
      return new Response('FK violation', { status: 409 });
    inserted.push(row);
    return new Response(null, { status: 204 });
  }
  if (p.endsWith('/rest/v1/food_logs')) {
    const day = (q.get('day') || '').replace('eq.', '');
    const uid = (q.get('user_id') || '').replace('eq.', '');
    return ok(inserted.filter(r => r.day === day && r.user_id === uid));
  }
  if (p.endsWith('/rest/v1/nutrition_goals')) {
    const lte = (q.get('from_day') || '').replace('lte.', '');
    const uid = (q.get('user_id') || '').replace('eq.', '');
    const rows = goalRows.filter(g => g.user_id === uid && g.from_day <= lte)
                         .sort((a, b) => b.from_day.localeCompare(a.from_day));
    return ok(rows.slice(0, 1));
  }
  throw new Error('URL inattendue : ' + url);
};

// --- Faux runtime Deno ----------------------------------------------------
let handler = null;
globalThis.Deno = {
  env: { get: (k) => ({
    SUPABASE_URL: BASE,
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-factice',
    TRACKLOG_MCP_TOKEN: TOKEN,
    TRACKLOG_MCP_USER_ID: USER,
    TRACKLOG_MCP_TZ: 'Europe/Zurich',
  }[k]) },
  serve: (h) => { handler = h; },
};
require(process.argv[2] || '/tmp/mcp.cjs');

const URL_OK = `${BASE}/functions/v1/tracklog-mcp/${TOKEN}`;
const post = (body, url = URL_OK, headers = {}) =>
  handler(new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }));

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); }
};

(async () => {
console.log('\n— Poignée de main —');
let r = await post({ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', capabilities:{}, clientInfo:{name:'claude',version:'1'} } });
let j = await r.json();
check('initialize répond 200', r.status === 200);
check('version de protocole renvoyée telle que demandée', j.result?.protocolVersion === '2025-06-18', j.result?.protocolVersion);
check('capacité outils annoncée', !!j.result?.capabilities?.tools);
check('serverInfo nommé', j.result?.serverInfo?.name === 'tracklog');

r = await post({ jsonrpc:'2.0', id:9, method:'initialize', params:{ protocolVersion:'2024-11-05' } });
check('révision plus ancienne acceptée', (await r.json()).result?.protocolVersion === '2024-11-05');

r = await post({ jsonrpc:'2.0', method:'notifications/initialized' });
check('notification sans id → 202 sans corps', r.status === 202);

console.log('\n— Catalogue —');
r = await post({ jsonrpc:'2.0', id:2, method:'tools/list' });
j = await r.json();
const names = (j.result?.tools || []).map(t => t.name);
check('deux outils exposés', names.length === 2, names.join(','));
check('outil d’écriture présent', names.includes('tracklog_ajout_rapide'));
check('outil de lecture présent', names.includes('tracklog_journee'));
check('aucun outil destructif', !names.some(n => /suppr|delete|remove|update/i.test(n)));
const w = j.result.tools.find(t => t.name === 'tracklog_ajout_rapide');
check('nom et kcal obligatoires', JSON.stringify(w.inputSchema.required) === '["nom","kcal"]');

console.log('\n— Écriture —');
r = await post({ jsonrpc:'2.0', id:3, method:'tools/call', params:{ name:'tracklog_ajout_rapide',
  arguments:{ nom:'Poulet riz brocolis', kcal:640, proteines:52, glucides:70, lipides:14, repas:'midi', jour:'2026-09-07' } } });
j = await r.json();
const row = inserted[0];
check('appel sans erreur', j.result?.isError !== true, JSON.stringify(j.result).slice(0,200));
check('une ligne insérée', inserted.length === 1);
check('clés de macros dans celles de l’app', JSON.stringify(row.nutriments) === '{"kcal":640,"protein":52,"carbs":70,"fat":14}', JSON.stringify(row?.nutriments));
check('food_id nul (pas de clé étrangère morte)', row.food_id === null);
check('convention 100 g de l’ajout rapide', row.qty === 100 && row.grams === 100 && row.unit === 'g');
check('id au format de l’app', /^fl_[a-z0-9]{7}$/.test(row.id), row.id);
check('rattaché au bon compte', row.user_id === USER);
check('jour et repas respectés', row.day === '2026-09-07' && row.meal === 'midi');
const txt = j.result.content[0].text;
check('réponse dit le total du jour', /Total du jour/.test(txt));
check('objectif daté : celui de septembre, pas de janvier', /2400/.test(txt) && !/2000/.test(txt), txt);

console.log('\n— Valeurs par défaut —');
r = await post({ jsonrpc:'2.0', id:4, method:'tools/call', params:{ name:'tracklog_ajout_rapide', arguments:{ nom:'Pomme', kcal:80 } } });
j = await r.json();
const auto = inserted[1];
const todayZurich = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Zurich',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
check('jour déduit = aujourd’hui à Zurich', auto.day === todayZurich, auto.day + ' vs ' + todayZurich);
check('repas déduit valide', ['matin','midi','soir','collation'].includes(auto.meal), auto.meal);
check('macros absentes simplement omises', JSON.stringify(auto.nutriments) === '{"kcal":80}', JSON.stringify(auto.nutriments));

console.log('\n— Lecture —');
r = await post({ jsonrpc:'2.0', id:5, method:'tools/call', params:{ name:'tracklog_journee', arguments:{ jour:'2026-09-07' } } });
j = await r.json();
const read = j.result.content[0].text;
check('la ligne écrite se relit', /Poulet riz brocolis/.test(read));
check('rangée sous son repas', /Déjeuner/.test(read));
check('reste calculé', /reste/.test(read), read.split('\n').pop());
r = await post({ jsonrpc:'2.0', id:6, method:'tools/call', params:{ name:'tracklog_journee', arguments:{ jour:'2020-01-01' } } });
check('journée vide dite clairement', /Rien de noté/.test((await r.json()).result.content[0].text));

console.log('\n— Refus —');
const before = inserted.length;
for (const [nom, args] of [
  ['jour mal formé', { nom:'X', kcal:10, jour:'07/09/2026' }],
  ['repas inconnu',  { nom:'X', kcal:10, repas:'brunch' }],
  ['nom vide',       { nom:'   ', kcal:10 }],
  ['kcal absentes',  { nom:'X' }],
]) {
  const rr = await post({ jsonrpc:'2.0', id:7, method:'tools/call', params:{ name:'tracklog_ajout_rapide', arguments:args } });
  const jj = await rr.json();
  check(nom + ' → refusé, lisible par le modèle', jj.result?.isError === true && /Échec/.test(jj.result.content[0].text));
}
check('aucun refus n’a écrit en base', inserted.length === before);

r = await post({ jsonrpc:'2.0', id:8, method:'tools/call', params:{ name:'tracklog_supprime_tout', arguments:{} } });
check('outil inexistant → erreur d’outil, pas de plantage', (await r.json()).result?.isError === true);

r = await post({ jsonrpc:'2.0', id:10, method:'resources/list' });
check('méthode inconnue → -32601', (await r.json()).error?.code === -32601);

console.log('\n— Secret mal configuré —');
globalThis.__fkError = true;
r = await post({ jsonrpc:'2.0', id:14, method:'tools/call', params:{ name:'tracklog_ajout_rapide', arguments:{ nom:'Test', kcal:100 } } });
const fk = (await r.json()).result;
globalThis.__fkError = false;
check('compte inexistant → message qui nomme le bon secret', fk?.isError === true && /TRACKLOG_MCP_USER_ID/.test(fk.content[0].text));
check('et qui distingue les deux UUID', /pas le jeton/.test(fk.content[0].text));
check('sans recracher le jargon Postgres', !/23503|fkey/.test(fk.content[0].text), fk.content[0].text);

console.log('\n— Porte d’entrée —');
r = await post({ jsonrpc:'2.0', id:11, method:'tools/list' }, `${BASE}/functions/v1/tracklog-mcp/mauvais-jeton`);
check('mauvais jeton dans l’URL → 401', r.status === 401);
r = await post({ jsonrpc:'2.0', id:12, method:'tools/list' }, `${BASE}/functions/v1/tracklog-mcp`);
check('aucun jeton → 401', r.status === 401);
r = await post({ jsonrpc:'2.0', id:13, method:'tools/list' }, `${BASE}/functions/v1/tracklog-mcp`, { Authorization: 'Bearer ' + TOKEN });
check('jeton en en-tête Bearer → accepté', r.status === 200);
r = await handler(new Request(URL_OK, { method:'GET' }));
check('GET (flux SSE) → 405 propre', r.status === 405);
r = await handler(new Request(URL_OK, { method:'OPTIONS' }));
check('préflight CORS → 200', r.status === 200);

console.log(`\n${pass} passés, ${fail} échoués\n`);
process.exit(fail ? 1 : 0);
})();
