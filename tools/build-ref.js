/* ref-list.txt + SR28 → foods-ref.json, la table des aliments simples.

   À lancer depuis ce dossier, après `npm i fda-nutrient-database` (qui embarque
   les fichiers SR28 bruts) :   node build-ref.js ../foods-ref.json
   ref-list.txt est la partie choisie à la main — un aliment par ligne,
   « nom français | groupe | recherche USDA ou ndb:XXXXX | options ». Les
   chiffres, eux, ne sont jamais saisis : ils sortent de SR28.
   Le libellé USDA retenu est conservé dans le fichier : c'est la provenance
   de chaque ligne, consultable depuis l'app. */
const fs = require('fs');
const { FOODS, find } = require('./usda.js');

const byNdb = Object.fromEntries(FOODS.map(f => [f.ndb, f]));
const GROUPS = {
  viandes:'Viandes et volailles', poissons:'Poissons et fruits de mer',
  laitiers:'Œufs et produits laitiers', feculents:'Féculents et pains',
  legumineuses:'Légumineuses', legumes:'Légumes', fruits:'Fruits',
  noix:'Noix et graines', gras:'Matières grasses', sucres:'Sucré',
  boissons:'Boissons',
};
const round = (v, d) => v == null ? null : Math.round(v * 10**d) / 10**d;

const out = [];
const misses = [];
for (const raw of fs.readFileSync(__dirname + '/ref-list.txt', 'utf8').split('\n')){
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const [fr, group, query, ...opts] = line.split('|');
  const hit = query.startsWith('ndb:') ? byNdb[query.slice(4)] : find(query, { limit:1 })[0];
  if (!hit){ misses.push(fr); continue; }
  const n = {};
  for (const k in hit.n){
    const v = hit.n[k];
    if (v == null) continue;
    n[k] = ['kcal'].includes(k) ? Math.round(v)
         : ['protein','carbs','fat','fiber','sugars','sat','salt'].includes(k) ? round(v, 2)
         : round(v, 1);
  }
  const portionOpt = opts.find(o => o.startsWith('p='));
  out.push({
    id: 'ref_' + hit.ndb,
    name: fr,
    group,
    groupLabel: GROUPS[group] || group,
    basis: opts.includes('ml') ? 'ml' : 'g',
    servingG: portionOpt ? Number(portionOpt.slice(2)) : null,
    usda: hit.desc,
    nutriments: n,
  });
}
if (misses.length){ console.error('introuvables:', misses); process.exit(1); }

const doc = {
  source: 'USDA National Nutrient Database for Standard Reference, Release 28 (SR28)',
  publisher: 'US Department of Agriculture, Agricultural Research Service',
  url: 'https://fdc.nal.usda.gov/',
  note: "Valeurs pour 100 g (ou 100 ml). Moyennes de référence pour des aliments génériques, non des produits de marque : elles ne remplacent pas une étiquette, elles la remplacent quand il n'y en a pas.",
  count: out.length,
  foods: out,
};
const path = process.argv[2] || __dirname + '/foods-ref.json';
fs.writeFileSync(path, JSON.stringify(doc));
console.log(out.length, 'aliments →', path, (fs.statSync(path).size/1024).toFixed(0)+' Ko');
