/* Printable documents: invoice (A4 / 80mm thermal), credit note, vouchers, barcode labels. Amounts in LKR. */
(function () {
  const { esc } = App;
  const m = (v) => App.num(v);

  const A4_CSS = `<style>
    @page { size: A4; margin: 10mm; }
    * { box-sizing: border-box; }
    body { font-family: "Segoe UI", Arial, sans-serif; font-size: 11.5px; color: #111; margin: 0; }
    .doc { border: 1px solid #333; }
    .hdr { display: flex; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid #333; gap: 16px; }
    .hdr h1 { font-size: 20px; margin: 0; color: #6d1f37; }
    .hdr .tag { font-style: italic; color: #555; }
    .doc-title { text-align: center; font-weight: 700; font-size: 14px; padding: 5px; border-bottom: 1px solid #333; letter-spacing: 1px; background: #f4ecef; }
    .two { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid #333; }
    .two > div { padding: 8px 12px; }
    .two > div + div { border-left: 1px solid #333; }
    .lbl { color: #555; font-size: 10px; text-transform: uppercase; letter-spacing: .5px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #999; padding: 4px 5px; vertical-align: top; }
    th { background: #f2f2f2; font-size: 10.5px; }
    .items td, .items th { border-left: 0; border-right: 1px solid #999; }
    .items tr td:last-child, .items tr th:last-child { border-right: 0; }
    .n { text-align: right; white-space: nowrap; }
    .c { text-align: center; }
    .tot td { font-weight: 700; background: #fafafa; }
    .foot { display: grid; grid-template-columns: 1.4fr 1fr; border-top: 1px solid #333; }
    .foot > div { padding: 8px 12px; }
    .foot > div + div { border-left: 1px solid #333; }
    .sum td { border: 0; padding: 2px 0; }
    .sum .g td { font-size: 14px; font-weight: 700; border-top: 1px solid #333; padding-top: 4px; }
    .sign { display: flex; justify-content: space-between; padding: 8px 12px 10px; border-top: 1px solid #333; }
    .sign .s { margin-top: 38px; }
    .small { font-size: 10px; color: #444; white-space: pre-line; }
    .words { font-weight: 600; margin: 4px 0 8px; }
  </style>`;

  const THERMAL_CSS = `<style>
    @page { size: 80mm auto; margin: 3mm; }
    body { font-family: "Consolas", "Courier New", monospace; font-size: 11.5px; width: 74mm; margin: 0; color: #000; }
    .c { text-align: center; } .n { text-align: right; } b { font-weight: 700; }
    hr { border: 0; border-top: 1px dashed #000; margin: 4px 0; }
    table { width: 100%; border-collapse: collapse; } td { padding: 1px 0; vertical-align: top; }
    .big { font-size: 15px; font-weight: 700; }
  </style>`;

  function companyBlock(s) {
    return `<div><h1>${esc(s.company_name)}</h1>${s.company_tagline ? `<div class="tag">${esc(s.company_tagline)}</div>` : ''}
      <div>${esc(s.company_address)}${s.company_city ? ', ' + esc(s.company_city) : ''}</div>
      ${s.company_phone ? `<div>Tel: ${esc(s.company_phone)}${s.company_email ? ' · ' + esc(s.company_email) : ''}</div>` : ''}</div>
      <div style="text-align:right">${s.company_vat_no ? `<div><b>${esc(s.tax_name)} Reg. No:</b> ${esc(s.company_vat_no)}</div>` : ''}
      ${s.company_br_no ? `<div><b>BR No:</b> ${esc(s.company_br_no)}</div>` : ''}</div>`;
  }

  App.printInvoice = function (sale, format) {
    const s = App.settings();
    format = format || s.print_format || 'a4';
    if (format === 'thermal') return App.printHtml(thermalInvoice(sale, s), sale.invoice_no);
    const vat = !!sale.tax_enabled;
    const title = vat ? 'TAX INVOICE' : 'INVOICE';
    const cols = vat ? 9 : 6;
    const rows = sale.items.map((it, i) => `<tr><td class="c">${i + 1}</td><td>${esc(it.name)}</td>
      <td class="n">${App.qty(it.qty)} ${esc(it.unit || '')}</td><td class="n">${m(it.rate)}</td><td class="n">${it.discount ? m(it.discount) : ''}</td>
      ${vat ? `<td class="n">${m(it.taxable)}</td><td class="c">${it.tax_rate}%</td><td class="n">${m(it.tax)}</td>` : ''}
      <td class="n">${m(it.total)}</td></tr>`).join('');
    const blank = `<tr style="height:20px">${'<td></td>'.repeat(cols)}</tr>`.repeat(Math.max(0, 8 - sale.items.length));
    const totQty = sale.items.reduce((a, i) => a + i.qty, 0);
    const due = Math.max(0, sale.total - sale.returned - sale.paid);
    const html = `${A4_CSS}<div class="doc">
      <div class="hdr">${companyBlock(s)}</div>
      <div class="doc-title">${title}${sale.cancelled ? ' — CANCELLED' : ''}</div>
      <div class="two"><div><div class="lbl">Bill to</div><b>${esc(sale.customer_name || 'Cash Customer')}</b>
        ${sale.customer_address ? `<div>${esc(sale.customer_address)}</div>` : ''}${sale.customer_phone ? `<div>Tel: ${esc(sale.customer_phone)}</div>` : ''}
        ${sale.customer_vat_no ? `<div><b>${esc(s.tax_name)} No:</b> ${esc(sale.customer_vat_no)}</div>` : ''}</div>
        <div><table class="sum" style="width:100%"><tr><td>Invoice No.</td><td class="n"><b>${esc(sale.invoice_no)}</b></td></tr>
        <tr><td>Date</td><td class="n">${App.date(sale.date)}</td></tr>
        <tr><td>Price list</td><td class="n">${sale.price_type === 'retail' ? 'Retail' : 'Wholesale'}</td></tr>
        ${vat ? `<tr><td>Prices</td><td class="n">${sale.inclusive ? 'Inclusive of ' + esc(s.tax_name) : 'Exclusive of ' + esc(s.tax_name)}</td></tr>` : ''}
        <tr><td>Billed by</td><td class="n">${esc(sale.user_name || '')}</td></tr></table></div></div>
      <table class="items"><thead><tr><th>#</th><th>Description</th><th class="n">Qty</th><th class="n">Rate (Rs.)</th><th class="n">Disc.</th>
        ${vat ? `<th class="n">Value excl. ${esc(s.tax_name)}</th><th>${esc(s.tax_name)} %</th><th class="n">${esc(s.tax_name)}</th>` : ''}<th class="n">Amount (Rs.)</th></tr></thead>
        <tbody>${rows}${blank}</tbody>
        <tfoot><tr class="tot"><td></td><td>Total</td><td class="n">${App.qty(totQty)}</td><td></td><td class="n">${sale.discount ? m(sale.discount) : ''}</td>
        ${vat ? `<td class="n">${m(sale.taxable)}</td><td></td><td class="n">${m(sale.tax)}</td>` : ''}<td class="n">${m(sale.taxable + sale.tax)}</td></tr></tfoot></table>
      <div class="foot"><div><div class="lbl">Amount in words</div><div class="words">${esc(Tax.amountInWords(sale.total))}</div>
        ${s.bank_details ? `<div style="margin-top:8px"><div class="lbl">Bank details</div><div class="small">${esc(s.bank_details)}</div></div>` : ''}
        <div style="margin-top:8px"><div class="lbl">Terms &amp; conditions</div><div class="small">${esc(s.invoice_terms)}</div></div></div>
        <div><table class="sum">
          ${vat ? `<tr><td>Value excl. ${esc(s.tax_name)}</td><td class="n">${m(sale.taxable)}</td></tr><tr><td>${esc(s.tax_name)}</td><td class="n">${m(sale.tax)}</td></tr>`
    : `<tr><td>Gross</td><td class="n">${m(sale.gross)}</td></tr>${sale.discount ? `<tr><td>Discount</td><td class="n">- ${m(sale.discount)}</td></tr>` : ''}`}
          ${sale.round_off ? `<tr><td>Round off</td><td class="n">${m(sale.round_off)}</td></tr>` : ''}
          <tr class="g"><td>Grand Total</td><td class="n">Rs. ${m(sale.total)}</td></tr>
          ${sale.returned ? `<tr><td>Less: returns</td><td class="n">${m(sale.returned)}</td></tr>` : ''}
          <tr><td>Paid${sale.payments && sale.payments.length ? ' (' + sale.payments.map((p) => esc(App.modeLabel(p.mode))).join(' + ') + ')' : ''}</td><td class="n">${m(sale.paid)}</td></tr>
          ${due > 0.005 ? `<tr><td><b>Balance due</b></td><td class="n"><b>${m(due)}</b></td></tr>` : ''}
          ${sale.customer_balance != null && sale.customer_id ? `<tr><td class="small">Total account balance</td><td class="n small">${m(sale.customer_balance)}</td></tr>` : ''}
        </table></div></div>
      <div class="sign"><div class="s">Customer's signature</div><div>For <b>${esc(s.company_name)}</b><div class="s">Authorised Signatory</div></div></div></div>
      ${sale.notes ? `<p class="small">Note: ${esc(sale.notes)}</p>` : ''}`;
    App.printHtml(html, sale.invoice_no);
  };

  function thermalInvoice(sale, s) {
    const vat = !!sale.tax_enabled;
    const lines = sale.items.map((it) => `<tr><td colspan="2">${esc(it.name)}</td></tr>
      <tr><td>${App.qty(it.qty)} ${esc(it.unit || '')} x ${m(it.rate)}${it.discount ? ` -${m(it.discount)}` : ''}</td><td class="n">${m(it.total)}</td></tr>`).join('');
    return `${THERMAL_CSS}<div class="c"><div class="big">${esc(s.company_name)}</div>${esc(s.company_address)}${s.company_city ? ', ' + esc(s.company_city) : ''}
      ${s.company_phone ? '<br>Tel: ' + esc(s.company_phone) : ''}${s.company_vat_no ? '<br>' + esc(s.tax_name) + ' No: ' + esc(s.company_vat_no) : ''}</div><hr>
      <div class="c"><b>${vat ? 'TAX INVOICE' : 'INVOICE'}${sale.cancelled ? ' (CANCELLED)' : ''}</b></div>
      <div>No: ${esc(sale.invoice_no)}<br>Date: ${App.date(sale.date)} ${esc((sale.created_at || '').slice(11, 16))}<br>
      Customer: ${esc(sale.customer_name || 'Cash')}${sale.customer_phone ? ' / ' + esc(sale.customer_phone) : ''}</div><hr>
      <table>${lines}</table><hr>
      <table>${vat ? `<tr><td>Excl. ${esc(s.tax_name)}</td><td class="n">${m(sale.taxable)}</td></tr><tr><td>${esc(s.tax_name)}</td><td class="n">${m(sale.tax)}</td></tr>` : ''}
      ${sale.discount ? `<tr><td>Discount</td><td class="n">${m(sale.discount)}</td></tr>` : ''}
      ${sale.round_off ? `<tr><td>Round off</td><td class="n">${m(sale.round_off)}</td></tr>` : ''}
      <tr><td class="big">TOTAL</td><td class="n big">Rs. ${m(sale.total)}</td></tr>
      ${(sale.payments || []).map((p) => `<tr><td>${esc(App.modeLabel(p.mode))}</td><td class="n">${m(p.amount)}</td></tr>`).join('')}
      ${sale.total - sale.paid - sale.returned > 0.005 ? `<tr><td><b>Balance due</b></td><td class="n"><b>${m(sale.total - sale.paid - sale.returned)}</b></td></tr>` : ''}
      </table><hr><div class="c" style="font-size:10px;white-space:pre-line">${esc(s.invoice_terms)}</div><hr>
      <div class="c">Thank you! Come again.</div>`;
  }

  App.printCreditNote = function (r) {
    const s = App.settings();
    const vat = !!r.tax_enabled;
    const html = `${A4_CSS}<div class="doc"><div class="hdr">${companyBlock(s)}</div>
      <div class="doc-title">CREDIT NOTE</div>
      <div class="two"><div><div class="lbl">Issued to</div><b>${esc(r.customer_name || 'Cash Customer')}</b>
        ${r.customer_address ? `<div>${esc(r.customer_address)}</div>` : ''}${r.customer_vat_no ? `<div>${esc(s.tax_name)} No: ${esc(r.customer_vat_no)}</div>` : ''}</div>
        <div><table class="sum" style="width:100%"><tr><td>Credit note no.</td><td class="n"><b>${esc(r.return_no)}</b></td></tr>
        <tr><td>Date</td><td class="n">${App.date(r.date)}</td></tr><tr><td>Against invoice</td><td class="n">${esc(r.invoice_no)} dt. ${App.date(r.invoice_date)}</td></tr>
        <tr><td>Settlement</td><td class="n">${r.refund_mode === 'credit' ? 'Adjusted in account' : 'Refund - ' + esc(App.modeLabel(r.refund_mode))}</td></tr></table></div></div>
      <table class="items"><thead><tr><th>#</th><th>Item</th><th class="n">Qty</th>${vat ? `<th class="n">Excl. ${esc(s.tax_name)}</th><th class="n">${esc(s.tax_name)}</th>` : ''}<th class="n">Total (Rs.)</th></tr></thead><tbody>
        ${r.items.map((it, i) => `<tr><td class="c">${i + 1}</td><td>${esc(it.name)}</td><td class="n">${App.qty(it.qty)}</td>
        ${vat ? `<td class="n">${m(it.taxable)}</td><td class="n">${it.tax_rate}% · ${m(it.tax)}</td>` : ''}<td class="n">${m(it.total)}</td></tr>`).join('')}</tbody></table>
      <div class="foot"><div><div class="lbl">Amount in words</div><div class="words">${esc(Tax.amountInWords(r.total))}</div>
        ${r.reason ? `<div class="lbl">Reason</div><div>${esc(r.reason)}</div>` : ''}</div>
        <div><table class="sum">${vat ? `<tr><td>Excl. ${esc(s.tax_name)}</td><td class="n">${m(r.taxable)}</td></tr><tr><td>${esc(s.tax_name)}</td><td class="n">${m(r.tax)}</td></tr>` : ''}
        <tr class="g"><td>Credit amount</td><td class="n">Rs. ${m(r.total)}</td></tr></table></div></div>
      <div class="sign"><div class="s">Customer's signature</div><div>For <b>${esc(s.company_name)}</b><div class="s">Authorised Signatory</div></div></div></div>`;
    App.printHtml(html, r.return_no);
  };

  App.printVoucher = function (p) {
    const s = App.settings();
    const isIn = p.direction === 'in';
    const html = `${A4_CSS}<div class="doc" style="max-width:720px"><div class="hdr">${companyBlock(s)}</div>
      <div class="doc-title">${isIn ? 'RECEIPT' : 'PAYMENT VOUCHER'}</div>
      <div style="padding:14px 16px;font-size:13px;line-height:1.9">
        <div style="display:flex;justify-content:space-between"><span>No: <b>${esc(p.voucher_no)}</b></span><span>Date: <b>${App.date(p.date)}</b></span></div>
        ${isIn ? 'Received with thanks from' : 'Paid to'} <b>${esc(p.party_name)}</b><br>
        the sum of <b>${esc(Tax.amountInWords(p.amount))}</b><br>
        by <b>${esc(App.modeLabel(p.mode))}</b>${p.reference ? ` (Ref: ${esc(p.reference)})` : ''}
        ${p.fc_amount ? `<br>Foreign currency: ${esc(p.fc_currency)} ${App.fc(p.fc_amount)} @ Rs. ${p.fc_rate}` : ''}
        ${p.allocations && p.allocations.length ? `<br>Against: ${p.allocations.map((a) => `${esc(a.invoice_no)} (Rs. ${m(a.amount)})`).join(', ')}` : ''}
        ${p.notes ? `<br>Notes: ${esc(p.notes)}` : ''}
        <div style="font-size:20px;margin-top:10px;border:1px solid #333;display:inline-block;padding:4px 14px"><b>Rs. ${m(p.amount)}</b></div>
      </div>
      <div class="sign"><div class="s">${isIn ? 'Customer' : 'Receiver'}'s signature</div>
        <div>For <b>${esc(s.company_name)}</b><div class="s">Authorised Signatory</div></div></div></div>`;
    App.printHtml(html, p.voucher_no);
  };

  /* Barcode labels. items: [{ product, copies }]; size: '50x25' | '38x25' | '75x38' | 'a4' */
  App.printLabels = function (items, size) {
    const s = App.settings();
    const dims = { '50x25': [50, 25], '38x25': [38, 25], '75x38': [75, 38] }[size] || null;
    const one = (p) => `<div class="lbl">
        <div class="co">${esc(s.company_name)}</div>
        <div class="nm">${esc(p.name)}${p.size ? ' · ' + esc(p.size) : ''}</div>
        ${Barcode.svg(p.barcode || p.sku, { height: 30, cssHeight: dims ? (dims[1] * 0.36) + 'mm' : '11mm' })}
        <div class="row"><span class="code">${esc(p.barcode || p.sku)}</span><span class="pr">Rs. ${m(p.mrp || p.sale_price || p.wholesale_price)}</span></div>
      </div>`;
    const all = [];
    for (const it of items) for (let i = 0; i < it.copies; i++) all.push(one(it.product));
    const css = dims ? `<style>@page{size:${dims[0]}mm ${dims[1]}mm;margin:0}body{margin:0;font-family:Arial,sans-serif}
        .lbl{width:${dims[0]}mm;height:${dims[1]}mm;padding:1.2mm 2mm;overflow:hidden;page-break-after:always;display:flex;flex-direction:column;justify-content:space-between}`
      : `<style>@page{size:A4;margin:8mm}body{margin:0;font-family:Arial,sans-serif}.wrap{display:grid;grid-template-columns:repeat(4,1fr);gap:2mm}
        .lbl{border:1px dashed #bbb;height:30mm;padding:1.5mm 2mm;overflow:hidden;display:flex;flex-direction:column;justify-content:space-between;page-break-inside:avoid}`;
    const html = css + `.co{font-size:6.5pt;color:#444;white-space:nowrap;overflow:hidden}.nm{font-size:7.5pt;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .row{display:flex;justify-content:space-between;font-size:7.5pt}.pr{font-weight:700;font-size:9pt}</style><div class="wrap">${all.join('')}</div>`;
    App.printHtml(html, 'Labels');
  };
})();
