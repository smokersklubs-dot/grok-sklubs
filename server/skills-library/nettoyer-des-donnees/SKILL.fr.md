---
name: Nettoyer un tableau de données (pandas)
description: Quand le patron donne un fichier CSV ou Excel en désordre (clients, produits, commandes) - le lire sans le changer, lister les problèmes, les corriger avec pandas sur une copie (espaces, majuscules, dates, virgules décimales, doublons, valeurs manquantes, e-mails invalides), et rendre le fichier propre avec un rapport de ce qui a changé et de ce qui demande une décision.
---

# Nettoyer un tableau de données (pandas)

Compétence originale de Sklubot. pandas et openpyxl sont installés sur l'ordinateur du bot. Travaille sur une copie : les originaux du patron ne sont jamais écrasés (écris dans un nouveau dossier `sortie/`). Montre un résultat avant de traiter tout un dossier.

## 1. Lire et décrire (sans rien changer)

```python
import pandas as pd
df = pd.read_csv("clients.csv", sep=None, engine="python", dtype=str, encoding="utf-8-sig")  # ou pd.read_excel("x.xlsx", dtype=str)
print(df.shape); print(df.head(10)); print(df.isna().sum()); print(df.nunique())
```
Lis tout en texte d'abord (`dtype=str`) pour que rien ne soit converti en silence (zéros au début des codes postaux, numéros de téléphone).

## 2. Lister les problèmes

Doublons (même e-mail, même nom et ville), espaces et majuscules, dates dans plusieurs formats, nombres avec une virgule ou un signe de devise, cases vides, e-mails invalides, valeurs hors d'une liste (pays, état). Montre la liste au patron avec les nombres et des exemples.

## 3. Corriger, sur une copie

```python
d = df.copy()
d = d.apply(lambda c: c.str.strip())                               # espaces
d["email"] = d["email"].str.lower()
d["total"] = pd.to_numeric(d["total"].str.replace("€", "").str.replace("\u00a0", "").str.replace(" ", "").str.replace(",", "."), errors="coerce")
d["date"] = pd.to_datetime(d["date"], dayfirst=True, errors="coerce").dt.strftime("%Y-%m-%d")
bad_email = ~d["email"].str.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", na=False)
dups = d.duplicated(subset=["email"], keep="first")
```
Ne supprime pas une ligne douteuse : marque-la dans une colonne `a_verifier` avec la raison. Fusionner des doublons (lequel garder) est le choix du patron quand les lignes diffèrent.

## 4. Rendre

`sortie/clients-propre.csv` (UTF-8, séparateur virgule, dates ISO) ou `.xlsx`, et un court rapport : lignes avant/après, ce qui a été changé (nombre par règle), lignes à vérifier, et les valeurs illisibles (devenues vides). Les données personnelles restent dans la bibliothèque du bot ; ne les transmets jamais ailleurs.
