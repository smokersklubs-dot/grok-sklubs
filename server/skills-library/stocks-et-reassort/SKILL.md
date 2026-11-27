---
name: Stock and reordering
description: Help a small shop or online store keep the right stock - sort products by value and predictability (ABC/XYZ), forecast simply, compute safety stock and reorder points with the real delivery delays, plan promotions and seasons without overstock, and decide when to mark down - with the calculations shown.
---

> Adapted from ECC "inventory-demand-planning" (© 2026 Affaan Mustafa and ECC contributors; this skill is licensed Apache License 2.0 in its front matter, and the repository is under the MIT License). Modified for Sklubot (2026-11-22): condensed for small shops instead of multi-site retailers, worked through in a spreadsheet or a file with the owner's real figures, translated into French.

# Stock and reordering

Use only the owner's real figures (sales history, supplier delays, prices). When a figure is missing, ask for it or show the calculation with an explicit assumption; never present an estimate as a fact. Work in a spreadsheet the owner can reuse (office tools or a CSV file) and show each formula.

## 1. Sort the products

- **ABC (value)**: rank products by margin (not revenue). A = the top products making about 80 % of the margin, B = the next 15 %, C = the rest.
- **XYZ (predictability)**: X = steady sales (variation coefficient under 0.5), Y = moderate (0.5 to 1), Z = erratic (over 1), measured on weekly sales without the seasonal effect.
- **What to do**: AX → regular automatic reorders with tight safety stock; AZ → look every time (valuable but erratic); CX → simple min/max; CZ → order to demand, or question keeping it.

## 2. Forecast simply

- Steady products: average of the last 4 to 8 weeks.
- Trend or season: compare with the same weeks last year, adjusted by this year's trend.
- A new product: copy the pattern of 3 to 5 similar products, with a cautious start.
- Take promotions out of the history before forecasting normal weeks.
- Check the forecast every month: is it **biased** (always too high or too low)? Weighted error = sum of absolute errors ÷ sum of real sales.

## 3. Safety stock and reorder point

- **Stock position** = on hand + on order − already promised to customers. Never reorder on "on hand" alone.
- **Safety stock** = Z × √(delay × variation of demand² + average demand² × variation of delay²). Z = 1.65 for 95 % of orders served (normal for A products), 2.33 for 99 % (critical products), 1.28 for 90 % (C products).
- **Reorder point** = average demand during the delivery delay + safety stock. Order when the stock position goes below it.
- **How much**: economic quantity √(2 × yearly demand × cost of one order ÷ yearly holding cost per unit), rounded to the supplier's packs and minimums; or "order up to" a level at fixed review days with the supplier.
- When a supplier's delay changes, recompute at once for its products.

## 4. Promotions and seasons

- Estimate the extra sales of a promotion from earlier ones on the same or similar products; expect the neighbouring products to lose part of it, and a dip of 1 to 3 weeks after a big promotion (customers stocked up).
- Seasonal products: commit about 60 to 70 % of the expected season at first, keep the rest for a reorder once real sales show the trend.
- **Mark down** when sales at mid-season are clearly behind plan (for example under 60 % of what was planned at that point): early small markdowns save more margin than late big ones. Set an end date to clear what is left before the next season arrives.

## 5. What to deliver

A table per product: class, forecast, safety stock, reorder point, quantity to order, date; the list of products to order this week; alerts (out-of-stock risk, overstock, slow movers). Placing an order with a supplier commits money: prepare it and let the owner approve. Offer a weekly routine for the reorder list.
