/* Lecteur SR28 : ABBREV.txt (les valeurs) + FOOD_DES.txt (les libellés longs). */
const fs = require('fs');
const DIR = __dirname + '/node_modules/fda-nutrient-database/data/';
const split = (line) => line.split('^').map(c => c.replace(/^~|~$/g, ''));
const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : null; };

const longDesc = {};
for (const line of fs.readFileSync(DIR + 'FOOD_DES.txt', 'latin1').split('\n')){
  if (!line.trim()) continue;
  const c = split(line);
  longDesc[c[0]] = c[2];
}

const COL = { kcal:3, protein:4, fat:5, carbs:7, fiber:8, sugars:9, calcium:10, iron:11,
  magnesium:12, phosphorus:13, potassium:14, sodium:15, zinc:16, vitaminC:20, vitaminB6:25,
  vitaminB9:26, vitaminB12:31, vitaminA:33, vitaminE:40, vitaminD:41, sat:44 };

const FOODS = [];
for (const line of fs.readFileSync(DIR + 'ABBREV.txt', 'latin1').split('\n')){
  if (!line.trim()) continue;
  const c = split(line);
  const n = {};
  for (const k in COL){ const v = num(c[COL[k]]); if (v != null) n[k] = v; }
  if (n.sodium != null) n.salt = Math.round(n.sodium * 2.5) / 1000;   // sel = sodium × 2,5
  FOODS.push({ ndb: c[0], desc: longDesc[c[0]] || c[1], short: c[1], n });
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function find(query, { limit = 8 } = {}){
  const words = norm(query).split(' ').filter(Boolean);
  return FOODS
    .filter(f => { const d = norm(f.desc); return words.every(w => d.includes(w)); })
    .sort((a, b) => a.desc.length - b.desc.length)
    .slice(0, limit);
}
module.exports = { FOODS, find, norm };

if (require.main === module){
  const q = process.argv.slice(2).join(' ');
  for (const f of find(q, { limit: 12 })){
    const n = f.n;
    console.log(`${f.ndb}  ${String(n.kcal).padStart(4)}kcal P${String(n.protein).padStart(5)} G${String(n.carbs).padStart(5)} L${String(n.fat).padStart(5)}  ${f.desc}`);
  }
}
