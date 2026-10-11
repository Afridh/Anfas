# Textile ERP + POS (Sri Lanka)

Billing, stock and accounts for a **Sri Lankan wholesale textile and garment shop that buys its stock in India**.

- All billing is in Sri Lankan rupees (Rs.).
- Each consignment from India is entered as a **GRN**. The Indian price (₹) is converted to Sri Lankan rupees at a rate you type in, and the shipping and other costs are added, to get each item's cost.

It runs on one PC, and other PCs or tablets in the shop can use it over Wi-Fi. It works without internet, has no monthly fee, and needs nothing installed except Node.js.

## Start

1. Install **Node.js 22.13 or newer** from https://nodejs.org (24 LTS recommended).
2. Double-click **`start.bat`**, or run `node server.js` in this folder.
3. Open **http://localhost:3000**.
4. Log in with **`admin` / `admin123`**, then change the password straight away (bottom-left, *Change password*).

Other computers in the shop can use the address shown in the console window, for example `http://192.168.1.20:3000`. Keep the main PC running.

**First-time setup:**

1. Go to **Settings**.
2. Enter the **Indian rupee rate** (1 ₹ = Rs. ?).
3. Enter the company name, address, phone and invoice terms, and save.
4. Add products, suppliers and customers.

To explore with sample data first, click *Load sample data* on the dashboard. This only works while the system is empty.

## The GRN formula

```
Cost per piece (Rs.) = India cost (₹) × Indian rupee rate + Other expenses (Rs.) + Cargo / shipping (Rs.)
```

- **Indian rupee rate** and **other expenses** are filled in automatically on every GRN from Settings. You can change them on any GRN. Ticking *use as default* saves the new values for the next GRN.
- **Cargo and other expenses** can be entered either *per piece* or as a *total for the GRN*. A total is shared equally across all pieces in the GRN.
- **Fields on each GRN:** supplier name, cargo name, bale number, LR number. Then for each item: India cost (₹), pcs, bundles, pcs per set, colours, size, and expected selling price.
- **When you save a GRN:**
  - The pieces are added to stock at the calculated cost.
  - The expected selling price becomes the wholesale price.
  - The supplier's account is credited with India cost × rate, in Rs.

## Modules

| Area | Features |
|---|---|
| **POS billing** | Barcode scan or search, wholesale/retail price lists, discounts, split payments (cash, card, bank transfer, cheque, LankaQR), change calculation, credit sales with credit limits, hold/recall bills. Shortcuts: F2 new bill, F4 customer, F8 payment, F9 save & print, F10 save |
| **Invoices** | A4 invoice or 80mm thermal receipt in Rs., amount in words ("Rupees … and … Cents Only"), numbered by financial year (`INV/26-27/00001`, April–March) |
| **VAT** | Off by default. Switch it on in Settings only if the business is VAT registered; invoices then become "Tax Invoice" with VAT lines |
| **Returns** | Partial returns, credit notes, refund or adjust in the customer's account, restock |
| **Stock** | Products with size, colour, design and material. Average cost, stock history per item, adjustments (damage, short received in bale, physical count), low-stock alerts, CSV import/export, barcode labels |
| **Purchasing** | GRN for goods from India (see above). Local purchase bills in Rs. for goods bought in Sri Lanka |
| **Accounts** | Customer receipts (settle the oldest invoices first), supplier payments, including INR amounts with the rate used, ledgers and statements, expenses, printable receipts |
| **Reports** | Sales by day/month/product/category/customer/staff, GRN costing (by supplier and cargo company), profit & loss, stock valuation, overdue customers by age, supplier payables, day book / cash handover, VAT summary. All reports export to Excel (CSV) |
| **Admin** | Users with roles (admin / manager / cashier), audit log, settings, one-click backup, automatic daily backups (last 30 kept) |

## Backups

- Automatic copies are saved to `data/backups/` every day.
- **Settings → Download backup now** gives you a single `.db` file. Keep copies off the PC (pen drive or Google Drive).
- To restore: stop the server, replace `data/erp.db` with the backup file, then start it again.

## Technical

- Built on Node.js's built-in `http` and `node:sqlite` modules, with no npm packages to install. All data is in `data/erp.db`.
- `npm test` runs an end-to-end API test on a throwaway database.
- To change the port, run `set PORT=8080` and then `node server.js`.
