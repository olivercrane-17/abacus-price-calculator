# Updating prices

Every price the calculator uses is in **`prices.json`**. Nothing else needs to change.

1. Open `prices.json` on GitHub (or locally) and edit the numbers. Amounts are in pounds and **include VAT**.
   For example, to change a 3 bed 4-weekly clean from £27 to £28:
   ```json
   "3": { "regular": { "4": 28, ...
   ```
2. Update `"price_list_date"` (for example `"March 2026"`). It's shown in the footer.
3. Commit the change. On GitHub, use the pencil icon, then **Commit changes**.
4. Vercel redeploys automatically in about a minute.

## Where things are

| What | Where in `prices.json` |
|---|---|
| Regular window prices per visit | `windows.bedrooms.<beds>.regular.<weeks>` |
| Conservatory/extension extra (regular) | `windows.bedrooms.<beds>.conservatory_addon` |
| One-off window prices | `windows.bedrooms.<beds>.one_off` / `one_off_with_conservatory` |
| Internal windows rule (× external) | `windows.internal_multiplier` |
| Conservatory roof | `windows.conservatory_roof` |
| Velux | `windows.velux` |
| Roof lanterns | `windows.lanterns` |
| Gutter prices | `gutters.bedrooms.<beds>.<service>.no_cons / with_cons` |
| Heavily soiled multiplier | `gutters.heavily_soiled_multiplier` |
| "Ask the customer about" items | `gutters.ask_about` |
| Warning wording | `warnings` |
| Phone numbers in the footer | `contact` |

Keep the file valid JSON: quotes around names, commas between items, and no comma after the last item in a list.
If a deploy fails after an edit, a stray or missing comma is the usual cause. The automated tests also check the
file loads.
