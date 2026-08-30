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
   texte à rattraper. Les valeurs sont pour 100 g, le poids est à part. */
const SCHEMA = {
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
        },
        required: ['nom', 'grammes', 'kcal', 'proteines', 'glucides', 'lipides', 'hypothese'],
        additionalProperties: false,
      },
    },
    marge: { type: 'string', description: 'La marge d\'erreur ET sa cause dominante. Ex. "±15 % — la quantité d\'huile est inconnue".' },
    question: {
      type: 'string',
      description: 'UNE question qui réduirait le plus la marge, ou "" si l\'estimation est déjà serrée.',
    },
  },
  required: ['plat', 'ingredients', 'marge', 'question'],
  additionalProperties: false,
};

/* ---- La méthode ----------------------------------------------------------
   Portage du skill « estimation-macros » : la précision vient de quatre
   inconnues, pas d'une procédure. Le modèle ne peut ni demander de précisions
   ni chercher sur le web ici — il doit donc trancher, et surtout DIRE ce qu'il
   a supposé, puisque c'est l'utilisateur qui corrigera les poids ensuite. */
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
  let image: { data: string; mediaType: string } | null = null;
  try {
    const body = await req.json();
    description = String(body?.description ?? '').trim();
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
        max_tokens: 16000,
        system: SYSTEM,
        thinking: { type: 'adaptive' },
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
        fallbacks: 'default',
        messages: [{ role: 'user', content }],
      }),
    });

    if (!r.ok){
      const detail = await r.text();
      console.error('anthropic', r.status, detail.slice(0, 500));
      if (r.status === 429) return json({ error: "Trop de requêtes d'un coup — réessaie dans un instant." }, 429);
      if (r.status === 401) return json({ error: "La clé API est refusée par Anthropic." }, 502);
      return json({ error: `Le service d'analyse a répondu ${r.status}.` }, 502);
    }

    const msg = await r.json();
    if (msg.stop_reason === 'refusal'){
      return json({ error: "L'analyse a été refusée pour cette description." }, 422);
    }

    // Sortie structurée : le JSON arrive dans le bloc texte de la réponse.
    const text = (msg.content || [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('');
    let parsed;
    try { parsed = JSON.parse(text); }
    catch {
      console.error('json illisible', text.slice(0, 500));
      return json({ error: "Réponse d'analyse illisible. Réessaie." }, 502);
    }

    return json({
      plat: String(parsed.plat || ''),
      ingredients: Array.isArray(parsed.ingredients) ? parsed.ingredients : [],
      marge: String(parsed.marge || ''),
      question: String(parsed.question || ''),
    });
  } catch (e){
    console.error(e);
    return json({ error: "Le service d'analyse est injoignable." }, 503);
  }
});
