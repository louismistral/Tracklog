/* ============================================================
   analyse-repas — le seul morceau de serveur du projet.
   ------------------------------------------------------------
   Pourquoi il existe : appeler Claude demande une clé API, et
   une clé API dans le navigateur est lisible par quiconque
   obtient l'exécution de code sur la page (un CDN compromis
   suffit) — et facturée au compte. Contrairement à la clé anon
   Supabase, que Row Level Security rend inoffensive, celle-ci
   n'a aucune protection propre. Elle vit donc ici, en secret
   côté serveur, et le navigateur ne voit que le résultat.

   Le front envoie une description de repas, et/ou une photo ; on
   renvoie sa décomposition en ingrédients pesés, avec des valeurs
   nutritionnelles POUR 100 g — c'est ce qui permet à l'app de
   recalculer les macros toute seule quand l'utilisateur corrige
   un poids, sans redemander quoi que ce soit au modèle.

   Deux modes, demandés par le champ `mode` :
     normal      — le modèle estime de tête. Rapide.
     advanced    — il peut chercher sur le web (vraies références :
                   la carte d'un restaurant nommé, la fiche d'un
                   produit) et remplit aussi les micronutriments.

   Déploiement :
     supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
     supabase functions deploy analyse-repas
   ============================================================ */

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');

const MODEL = 'claude-opus-5';
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_IMAGE_BASE64_CHARS = 8_000_000; // ~6 Mo décodés, large marge sous la limite de la fonction

// L'app est servie depuis un autre domaine que Supabase : sans ces en-têtes,
// le navigateur refuse la réponse avant même de la lire.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

/* ---- Le contrat de sortie -------------------------------------------------
   Un schéma strict plutôt qu'un « réponds en JSON » dans le prompt : le modèle
   ne peut alors structurellement pas rendre autre chose, et le front n'a aucun
   texte à rattraper. Les valeurs sont pour 100 g, le poids est à part.

   Les micronutriments, dans les clés ET les unités de l'app (le front range
   ce bloc tel quel dans les valeurs « pour 100 g » de l'ingrédient). Ils ne
   sont demandés qu'en mode approfondi : de tête, un modèle rendrait quatorze
   nombres dont aucun ne vaudrait mieux qu'un blanc. D'où « 0 si inconnu » —
   un zéro est filtré côté app, une valeur inventée ne le serait pas. */
const MICRO_FIELDS: Array<[string, string]> = [
  ['sugars', 'Sucres, en g pour 100 g'],
  ['sat', 'Acides gras saturés, en g pour 100 g'],
  ['fiber', 'Fibres, en g pour 100 g'],
  ['salt', 'Sel, en g pour 100 g'],
  ['calcium', 'Calcium, en mg pour 100 g'],
  ['iron', 'Fer, en mg pour 100 g'],
  ['magnesium', 'Magnésium, en mg pour 100 g'],
  ['potassium', 'Potassium, en mg pour 100 g'],
  ['phosphorus', 'Phosphore, en mg pour 100 g'],
  ['zinc', 'Zinc, en mg pour 100 g'],
  ['sodium', 'Sodium, en mg pour 100 g'],
  ['vitaminA', 'Vitamine A, en µg pour 100 g'],
  ['vitaminC', 'Vitamine C, en mg pour 100 g'],
  ['vitaminD', 'Vitamine D, en µg pour 100 g'],
  ['vitaminE', 'Vitamine E, en mg pour 100 g'],
  ['vitaminB6', 'Vitamine B6, en mg pour 100 g'],
  ['vitaminB9', 'Vitamine B9 (folates), en µg pour 100 g'],
  ['vitaminB12', 'Vitamine B12, en µg pour 100 g'],
];
const MICROS_SCHEMA = {
  type: 'object',
  description: 'Micronutriments POUR 100 g. Mets 0 partout où tu ne sais pas — un 0 est ignoré par l\'app, un chiffre inventé ne le serait pas.',
  properties: Object.fromEntries(MICRO_FIELDS.map(([k, d]) => [k, { type: 'number', description: d }])),
  required: MICRO_FIELDS.map(([k]) => k),
  additionalProperties: false,
};

/* Le schéma dépend du mode, et c'est le seul endroit où les deux modes
   diffèrent structurellement : en normal, les micros ne sont pas demandés du
   tout (de tête, ce seraient dix-huit nombres inventés), et « sources » reste
   un tableau vide puisque rien n'est consulté. */
const schemaFor = (advanced: boolean) => ({
  type: 'object',
  properties: {
    plat: { type: 'string', description: 'Nom court du plat, tel qu\'on le dirait.' },
    ingredients: {
      type: 'array',
      description: 'Un élément par composant réellement mangé, y compris les matières grasses de cuisson et les sauces.',
      items: {
        type: 'object',
        properties: {
          nom: { type: 'string', description: 'Ingrédient, en précisant cru ou cuit quand ça change le chiffre. Ex. "Riz basmati, cuit".' },
          grammes: { type: 'number', description: 'Poids mangé de ce composant, en grammes.' },
          kcal: { type: 'number', description: 'Calories POUR 100 g de ce composant.' },
          proteines: { type: 'number', description: 'Protéines en g POUR 100 g.' },
          glucides: { type: 'number', description: 'Glucides en g POUR 100 g.' },
          lipides: { type: 'number', description: 'Lipides en g POUR 100 g.' },
          hypothese: { type: 'string', description: 'Ce qui a été supposé pour ce composant, ou "" si rien. Ex. "15 g d\'huile de cuisson supposés".' },
          ...(advanced ? { micros: MICROS_SCHEMA } : {}),
        },
        required: ['nom', 'grammes', 'kcal', 'proteines', 'glucides', 'lipides', 'hypothese',
                   ...(advanced ? ['micros'] : [])],
        additionalProperties: false,
      },
    },
    marge: { type: 'string', description: 'La marge d\'erreur ET sa cause dominante. Ex. "±15 % — la quantité d\'huile est inconnue".' },
    question: {
      type: 'string',
      description: 'UNE question qui réduirait le plus la marge, ou "" si l\'estimation est déjà serrée.',
    },
    sources: {
      type: 'array',
      description: 'Les URL réellement consultées, si tu as cherché. Tableau vide sinon — n\'invente jamais une source.',
      items: { type: 'string' },
    },
  },
  required: ['plat', 'ingredients', 'marge', 'question', 'sources'],
  additionalProperties: false,
});

/* ---- La méthode ----------------------------------------------------------
   Portage du skill « estimation-macros » : la précision vient de quatre
   inconnues, pas d'une procédure. Le modèle ne peut pas demander de précisions
   — il doit donc trancher, et surtout DIRE ce qu'il a supposé, puisque c'est
   l'utilisateur qui corrigera les poids ensuite.

   En mode approfondi seulement, il peut chercher sur le web : c'est ce qui
   transforme « une pizza de resto » en la pizza que ce restaurant-là sert,
   quand l'utilisateur l'a nommé. Le reste de la méthode ne bouge pas. */
const SYSTEM = `Tu estimes les calories et macros d'un repas, pour une app de suivi nutritionnel.

Le message peut contenir une photo du repas, un texte qui le décrit, ou les deux. Quand une photo est
fournie, elle prime sur ta seule imagination pour la composition et les proportions visibles ; le texte
(s'il y en a) sert à corriger ou préciser ce que la photo ne montre pas — un ingrédient caché sous les
autres, une quantité pesée, la sauce utilisée.

Toute la précision vient de quatre inconnues. Face à un repas, la question n'est pas « où j'en suis dans les étapes » mais « laquelle de ces quatre me manque » :

1. LA COMPOSITION — la liste des ingrédients, Y COMPRIS ceux qu'on ne voit pas : huile ou beurre de cuisson, sucre de la sauce, crème du liant, marinade. C'est le point structurellement opaque au restaurant. Suppose-les explicitement plutôt que de les omettre : ce sont eux qui font déraper une estimation.
2. LE POIDS DE CHAQUE INGRÉDIENT — en précisant toujours cru ou cuit, sinon le chiffre est inexploitable. La conversion cru/cuit est la plus grosse source d'erreur silencieuse : pâtes et riz secs absorbent l'eau (pâtes ~2,3×, riz ~2,5–3×), viandes et poissons perdent eau et gras (~-25 à -30 %), l'aubergine et les légumes poreux boivent le gras de cuisson.
3. LA VALEUR NUTRITIONNELLE RÉELLE — les vraies valeurs pour 100 g, pas une moyenne générique. Un steak va de 130 à 280 kcal/100 g selon le morceau, un haché de 5 % à 20 % de gras. Quand le type précis change tout et n'est pas donné, prends l'hypothèse la plus courante et dis-la.
4. LE POIDS RÉELLEMENT MANGÉ — distinct de ce qui a été servi. Ce qui est laissé (peau, gras, os, fond d'assiette) se soustrait.

Règles de travail :
- Déconstruis par composant. Jamais d'estimation en bloc : un composant par ligne. L'erreur reste isolée et on voit qui domine.
- Ce que l'utilisateur donne prime toujours sur ton estimation. S'il a pesé, utilise son poids tel quel.
- Les valeurs nutritionnelles que tu rends sont POUR 100 g du composant ; le poids mangé va dans son propre champ. Ne mélange jamais les deux.
- Annonce la marge ET sa cause, pour que l'utilisateur sache quoi mesurer la prochaine fois.
- Vise ±5 %, pas 0 %. Au restaurant le 100 % est inatteignable : prends une marge haute plutôt que de faire semblant.
- Renseigne « hypothese » dès que tu as supposé quelque chose sur un composant. C'est ce que l'utilisateur relira pour corriger.
- Si le repas décrit est trop vague pour être décomposé honnêtement, rends quand même ta meilleure décomposition, avec une marge large et la question qui la resserrerait.

Tout est en français.`;

/* Ce qui s'ajoute au système en mode approfondi. Un bloc à part plutôt qu'un
   « si » dans le texte : le mode normal ne doit pas lire des consignes de
   recherche qu'il n'a pas les outils d'exécuter. */
const SYSTEM_ADVANCED = `

MODE APPROFONDI — tu disposes de la recherche web, et deux choses changent.

1. CHERCHE quand il y a quelque chose à trouver. Un établissement nommé, une chaîne, un produit de marque, un plat régional précis : va lire les vraies valeurs plutôt que d'estimer de tête. Cherche la fiche nutritionnelle de l'enseigne en premier, une base publique (Open Food Facts, Ciqual, USDA) ensuite. Deux ou trois recherches ciblées valent mieux que dix vagues. Si rien de fiable ne sort, estime comme en mode normal et dis-le dans « hypothese ».
2. REMPLIS les micronutriments, pour 100 g, dans les unités demandées par le schéma. Un composant simple (riz, poulet, huile d'olive) a des valeurs de table connues : utilise-les. Partout où tu ne sais pas, mets 0 — c'est traité comme « pas d'information ». N'invente jamais un micronutriment pour ne pas laisser un champ vide : un chiffre faux est pire qu'un blanc, il se cumule dans les totaux du jour de l'utilisateur.

« sources » ne contient que les URL que tu as réellement ouvertes. Aucune source inventée, jamais.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405);

  if (!ANTHROPIC_API_KEY){
    return json({ error: "La fonction n'a pas de clé API configurée (secret ANTHROPIC_API_KEY)." }, 500);
  }

  // Le compte est vérifié ici en plus de la vérification de jeton faite par la
  // plateforme : cette fonction dépense de l'argent réel, elle ne doit jamais
  // répondre à un appel anonyme, même si la config du projet changeait.
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return json({ error: 'Non authentifié.' }, 401);
  try {
    const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: auth, apikey: SUPABASE_ANON_KEY ?? '' },
    });
    if (!who.ok) return json({ error: 'Session expirée — reconnecte-toi.' }, 401);
  } catch {
    return json({ error: "Impossible de vérifier la session." }, 503);
  }

  let description = '';
  let advanced = false;
  let image: { data: string; mediaType: string } | null = null;
  try {
    const body = await req.json();
    description = String(body?.description ?? '').trim();
    advanced = String(body?.mode ?? '') === 'advanced';
    if (body?.image){
      const data = String(body.image.data ?? '');
      const mediaType = String(body.image.mediaType ?? '');
      if (!data || !ALLOWED_IMAGE_TYPES.has(mediaType)){
        return json({ error: 'Photo illisible ou format non supporté (jpeg, png, webp, gif).' }, 400);
      }
      if (data.length > MAX_IMAGE_BASE64_CHARS) return json({ error: 'Photo trop lourde.' }, 400);
      image = { data, mediaType };
    }
  } catch {
    return json({ error: 'Requête illisible.' }, 400);
  }
  if (description.length < 3 && !image) return json({ error: 'Décris le repas, ou joins une photo.' }, 400);
  if (description.length > 4000) return json({ error: 'Description trop longue.' }, 400);

  // Photo d'abord, texte ensuite : c'est l'ordre que Claude lit le mieux quand
  // les deux sont présents — le texte agit alors comme une légende de l'image.
  const content: Array<Record<string, unknown>> = [];
  if (image) content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } });
  content.push({ type: 'text', text: description || 'Décompose ce repas à partir de la photo.' });

  try {
    /* Une recherche longue peut s'interrompre en cours de tour : l'API rend
       alors `stop_reason: "pause_turn"` et attend qu'on lui renvoie le message
       tel quel pour reprendre. Sans cette reprise, le mode approfondi
       rendrait par moments une réponse sans JSON du tout. Deux reprises
       suffisent largement pour cinq recherches ; au-delà, on s'arrête plutôt
       que de boucler sur le compte de l'utilisateur. */
    const messages: Array<Record<string, unknown>> = [{ role: 'user', content }];
    // deno-lint-ignore no-explicit-any
    let msg: any = null;

    for (let turn = 0; turn < 3; turn++){
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          // Sur un refus de politique, la requête est rejouée côté serveur sur un
          // modèle de repli dans le même appel, au lieu de revenir les mains vides.
          'anthropic-beta': 'server-side-fallback-2026-07-01',
        },
        body: JSON.stringify({
          model: MODEL,
          // Chercher, lire des pages et rendre dix-huit micros par ingrédient
          // demande de la place ; estimer de tête, non.
          max_tokens: advanced ? 32000 : 16000,
          system: advanced ? SYSTEM + SYSTEM_ADVANCED : SYSTEM,
          thinking: { type: 'adaptive' },
          output_config: { format: { type: 'json_schema', schema: schemaFor(advanced) } },
          fallbacks: 'default',
          // La recherche web est un outil serveur : Anthropic l'exécute dans le
          // même appel, la fonction n'a rien à orchestrer et aucune page ne
          // transite par nous. Bridée à cinq usages — au-delà, le modèle creuse
          // une précision que la pesée d'une assiette ne portera de toute façon pas.
          ...(advanced ? { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }] } : {}),
          messages,
        }),
      });

      if (!r.ok){
        const detail = await r.text();
        console.error('anthropic', r.status, detail.slice(0, 500));
        if (r.status === 429) return json({ error: "Trop de requêtes d'un coup — réessaie dans un instant." }, 429);
        if (r.status === 401) return json({ error: "La clé API est refusée par Anthropic." }, 502);
        return json({ error: `Le service d'analyse a répondu ${r.status}.` }, 502);
      }

      msg = await r.json();
      if (msg && msg.stop_reason === 'pause_turn'){
        // On renvoie le tour de l'assistant TEL QUEL — les résultats de
        // recherche y sont chiffrés, les retoucher invalide la requête.
        messages.push({ role: 'assistant', content: msg.content });
        continue;
      }
      break;
    }
    if (!msg) return json({ error: "Le service d'analyse n'a rien renvoyé." }, 502);

    if (msg.stop_reason === 'refusal'){
      return json({ error: "L'analyse a été refusée pour cette description." }, 422);
    }

    /* Sortie structurée : le JSON arrive dans un bloc texte. Avec la recherche
       web, la réponse en contient plusieurs — les tours intermédiaires du
       modèle pendant qu'il cherche — et seul le DERNIER porte le résultat.
       Les concaténer rendait un texte illisible dès qu'une recherche avait eu
       lieu, donc on essaie le dernier d'abord, puis les précédents à rebours. */
    const texts = (msg.content || [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => String(b.text || '').trim())
      .filter((t: string) => t);
    let parsed = null;
    for (let i = texts.length - 1; i >= 0 && !parsed; i--){
      try { parsed = JSON.parse(texts[i]); } catch { /* pas celui-là */ }
    }
    if (!parsed || typeof parsed !== 'object'){
      console.error('json illisible', texts.join(' | ').slice(0, 500));
      return json({ error: "Réponse d'analyse illisible. Réessaie." }, 502);
    }

    return json({
      plat: String(parsed.plat || ''),
      ingredients: Array.isArray(parsed.ingredients) ? parsed.ingredients : [],
      marge: String(parsed.marge || ''),
      question: String(parsed.question || ''),
      // Les sources ne sortent que si ce sont des URL : le schéma demande des
      // chaînes, rien n'empêche le modèle d'y mettre « la carte du resto ».
      sources: (Array.isArray(parsed.sources) ? parsed.sources : [])
        .map((u: unknown) => String(u || ''))
        .filter((u: string) => /^https?:\/\//.test(u))
        .slice(0, 6),
    });
  } catch (e){
    console.error(e);
    return json({ error: "Le service d'analyse est injoignable." }, 503);
  }
});
