---
name: Clean a data table (pandas)
description: When the owner gives a messy CSV or Excel file (customers, products, orders) - read it without changing it, list the problems, fix them with pandas on a copy (spaces, case, dates, decimal commas, duplicates, missing values, invalid emails), and hand back the clean file with a report of what changed and what needs a decision.
---

# Clean a data table (pandas)

Original Sklubot skill. pandas and openpyxl are installed on the bot's computer. Work on a copy: the owner's originals are never overwritten (write to a new folder `sortie/`). Show one result before doing a whole folder.

## 1. Read and describe (change nothing)

```python
import pandas as pd
df = pd.read_csv("clients.csv", sep=None, engine="python", dtype=str, encoding="utf-8-sig")  # or pd.read_excel("x.xlsx", dtype=str)
print(df.shape); print(df.head(10)); print(df.isna().sum()); print(df.nunique())
```
Read everything as text first (`dtype=str`) so nothing is silently converted (leading zeros of postcodes, phone numbers).

## 2. List the problems

Duplicates (same email, same name and city), spaces and case, dates in several formats, numbers with a decimal comma or a currency sign, empty cells, invalid emails, values outside a list (country, state). Show the list with counts and examples to the owner.

## 3. Fix, on a copy

```python
d = df.copy()
d = d.apply(lambda c: c.str.strip())                               # spaces
d["email"] = d["email"].str.lower()
d["total"] = pd.to_numeric(d["total"].str.replace("€", "").str.replace("\u00a0", "").str.replace(" ", "").str.replace(",", "."), errors="coerce")
d["date"] = pd.to_datetime(d["date"], dayfirst=True, errors="coerce").dt.strftime("%Y-%m-%d")
bad_email = ~d["email"].str.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", na=False)
dups = d.duplicated(subset=["email"], keep="first")
```
Do not delete a doubtful row: mark it in a column `a_verifier` with the reason. Merging duplicates (which one to keep) is the owner's choice when the rows differ.

## 4. Hand back

`sortie/clients-propre.csv` (UTF-8, comma separator, ISO dates) or `.xlsx`, and a short report: rows before/after, what was changed (count per rule), rows to check, and the values that could not be read (now empty). Personal data stays in the bot's library; never send it elsewhere.
