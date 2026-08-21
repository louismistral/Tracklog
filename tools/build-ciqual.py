#!/usr/bin/env python3
"""Table CIQUAL (ANSES) → foods-ref.json, la table des aliments simples.

    pip install openpyxl
    python3 build-ciqual.py ciqual/Table_Ciqual_2025_FR_2025_11_03.xlsx ../foods-ref.json

Le fichier de sortie est colonnaire : une liste de clés, et un tableau de
valeurs par aliment. Répéter « protein » 3 484 fois coûtait 300 Ko pour rien.

Trois conventions, et elles comptent :
  · « - »       = non déterminé. La clé est absente : l'app affiche « — »,
                  ce qui n'est pas la même chose que zéro.
  · « traces »  = 0.
  · « < 0,5 »   = 0,25, la moitié du seuil de quantification. C'est la
                  substitution « middle bound » recommandée par l'EFSA pour
                  ce genre de données censurées ; prendre 0 sous-estime,
                  prendre 0,5 surestime.
"""
import json, re, sys, unicodedata
from datetime import date
import openpyxl

# Colonne du fichier → clé de l'app. Les indices sont ceux de la table 2025 ;
# ils sont vérifiés au chargement contre l'en-tête, pour qu'une nouvelle
# édition de CIQUAL casse bruyamment plutôt que silencieusement.
COLS = {
    'kcal':       (10, 'Energie, Règlement UE'),
    'protein':    (14, 'Protéines, N x facteur de Jones'),
    'carbs':      (16, 'Glucides'),
    'fat':        (17, 'Lipides'),
    'sugars':     (18, 'Sucres'),
    'fiber':      (26, 'Fibres alimentaires'),
    'sat':        (31, 'AG saturés'),
    'salt':       (49, 'Sel chlorure de sodium'),
    'calcium':    (50, 'Calcium'),
    'iron':       (53, 'Fer'),
    'magnesium':  (55, 'Magnésium'),
    'phosphorus': (57, 'Phosphore'),
    'potassium':  (58, 'Potassium'),
    'sodium':     (60, 'Sodium'),
    'zinc':       (61, 'Zinc'),
    'vitaminA':   (62, 'Activité vitaminique A'),
    'vitaminD':   (65, 'Vitamine D'),
    'vitaminE':   (69, 'Vitamine E'),
    'vitaminC':   (72, 'Vitamine C'),
    'vitaminB6':  (77, 'Vitamine B6'),
    'vitaminB9':  (79, 'Vitamine B9 ou Folates totaux'),
    'vitaminB12': (82, 'Vitamine B12'),
}
C_GRP, C_SSGRP, C_CODE, C_NOM = 3, 4, 6, 7

# Décimales gardées : les grammes au centième, le reste au dixième.
GRAMS = {'protein','carbs','fat','sugars','fiber','sat','salt'}

# Ce qui se boit se compte en millilitres, comme sur les bouteilles — les
# boissons, et les laits, qui sont rangés avec les produits laitiers.
# (CIQUAL donne tout pour 100 g ; à densité ~1 l'écart est négligeable.)
ML_GROUPS = {'eaux et autres boissons'}
ML_SUBGROUPS = {'laits'}

def squash(h):
    return re.sub(r'\s+', ' ', str(h or '')).strip()

def parse(v):
    """Valeur CIQUAL → nombre, ou None si non déterminée."""
    if v is None: return None
    if isinstance(v, (int, float)): return float(v)
    s = str(v).strip().replace(' ', ' ')
    if s in ('', '-'): return None
    if 'race' in s: return 0.0                      # « traces »
    m = re.match(r'^<\s*([\d.,\s]+)$', s)           # « < 0,5 » → moitié du seuil
    if m: return num(m.group(1)) / 2 if num(m.group(1)) is not None else None
    return num(s)

def num(s):
    s = str(s).replace(' ', '').replace(',', '.')
    try: return float(s)
    except ValueError: return None

def main(src, dst):
    wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
    ws = wb['composition nutritionnelle']
    it = ws.iter_rows(values_only=True)
    hdr = [squash(h) for h in next(it)]

    for key, (i, expect) in COLS.items():
        got = hdr[i] if i < len(hdr) else ''
        if not got.startswith(expect):
            sys.exit(f"colonne {i} : « {expect}… » attendu, « {got} » trouvé — "
                     f"la table a changé de forme, revoir COLS.")

    keys = list(COLS)
    groups, group_idx, foods = [], {}, []
    for r in it:
        code, name = r[C_CODE], squash(r[C_NOM])
        if not code or not name: continue
        grp = squash(r[C_GRP]) or 'aliments moyens'
        sub = squash(r[C_SSGRP])
        label = grp[:1].upper() + grp[1:]
        if label not in group_idx:
            group_idx[label] = len(groups); groups.append(label)
        vals = []
        for k in keys:
            v = parse(r[COLS[k][0]])
            if v is None: vals.append(None)
            elif k == 'kcal': vals.append(round(v))
            else: vals.append(round(v, 2 if k in GRAMS else 1))
        # Sans calories, la fiche n'est pas exploitable pour un journal.
        if vals[keys.index('kcal')] is None: continue
        foods.append([str(code), name, group_idx[label],
                      'ml' if (grp in ML_GROUPS or sub in ML_SUBGROUPS) else 'g', sub, vals])

    doc = {
        'source': 'Table Ciqual 2025 — composition nutritionnelle des aliments',
        'publisher': 'ANSES (Agence nationale de sécurité sanitaire de l’alimentation, '
                     'de l’environnement et du travail)',
        'licence': 'Licence Ouverte / Open Licence (Etalab)',
        'url': 'https://ciqual.anses.fr/',
        'note': ("Valeurs pour 100 g (ou 100 ml pour les boissons). « traces » vaut 0, "
                 "« < x » vaut x/2, et une valeur non déterminée est absente plutôt que nulle."),
        'generated': date.today().isoformat(),
        'keys': keys,
        'groups': groups,
        'count': len(foods),
        'foods': foods,
    }
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
    print(f"{len(foods)} aliments → {dst}")

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'ciqual/Table_Ciqual_2025_FR_2025_11_03.xlsx',
         sys.argv[2] if len(sys.argv) > 2 else '../foods-ref.json')
