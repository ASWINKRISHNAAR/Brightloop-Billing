import { sendEmail } from './email.js';

interface InvoiceLine {
  description: string;
  quantity: number;
  unit_price: number | string;
  total: number | string;
}

interface InvoiceForEmail {
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  total: number | string;
  amount_paid: number | string;
  subtotal?: number | string;
  discount_amount?: number | string;
  tax_amount?: number | string;
  lines?: InvoiceLine[];
}

interface PaymentForEmail {
  id: string;
  amount: number | string;
  payment_method?: string;
  reference?: string;
  payment_date?: string;
  recorded_at?: string;
}

function fmt(val: number | string | undefined | null): string {
  const n = parseFloat(String(val ?? 0));
  return isNaN(n) ? '0.00' : n.toFixed(2);
}

function fmtDate(d: string | undefined | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return String(d);
  }
}

const baseStyle = `
  body { margin:0; padding:0; background:#1a1a2e; font-family: 'Segoe UI', Arial, sans-serif; color:#e0e0e0; }
  .wrapper { max-width:640px; margin:40px auto; background:#16213e; border-radius:12px; overflow:hidden; box-shadow:0 8px 32px rgba(0,0,0,0.5); }
  .header { background:linear-gradient(135deg,#0f3460,#533483); padding:32px 40px; }
  .header h1 { margin:0; font-size:26px; color:#e94560; letter-spacing:1px; }
  .header p { margin:4px 0 0; color:#a0aec0; font-size:14px; }
  .body { padding:32px 40px; }
  .section-title { font-size:11px; text-transform:uppercase; letter-spacing:2px; color:#a0aec0; margin:0 0 8px; }
  .info-box { background:#0f3460; border-radius:8px; padding:16px 20px; margin-bottom:20px; }
  .info-row { display:flex; justify-content:space-between; padding:4px 0; font-size:14px; }
  .info-row span:first-child { color:#a0aec0; }
  .info-row span:last-child { color:#e0e0e0; font-weight:500; }
  table { width:100%; border-collapse:collapse; margin-bottom:20px; font-size:13px; }
  th { background:#0f3460; color:#a0aec0; text-transform:uppercase; font-size:11px; letter-spacing:1px; padding:10px 12px; text-align:left; }
  td { padding:10px 12px; border-bottom:1px solid #0f3460; color:#e0e0e0; }
  tr:last-child td { border-bottom:none; }
  .totals { background:#0f3460; border-radius:8px; padding:16px 20px; margin-bottom:20px; }
  .total-row { display:flex; justify-content:space-between; padding:5px 0; font-size:14px; }
  .total-row.grand { border-top:1px solid #533483; margin-top:8px; padding-top:12px; font-size:17px; font-weight:700; color:#e94560; }
  .badge { display:inline-block; background:#e94560; color:#fff; padding:3px 10px; border-radius:20px; font-size:12px; font-weight:700; }
  .badge.green { background:#38a169; }
  .footer { background:#0f3460; padding:20px 40px; text-align:center; font-size:12px; color:#718096; }
`;

export async function sendInvoiceConfirmedEmail(
  invoice: InvoiceForEmail,
  customerEmail: string,
  customerName: string
): Promise<void> {
  const total = fmt(invoice.total);
  const dueDate = fmtDate(invoice.due_date);
  const invoiceDate = fmtDate(invoice.invoice_date);

  const subtotal = fmt(invoice.subtotal ?? invoice.total);
  const discount = fmt(invoice.discount_amount ?? 0);
  const tax = fmt(invoice.tax_amount ?? 0);
  const amountPaid = fmt(invoice.amount_paid);
  const balanceDue = fmt(parseFloat(String(invoice.total)) - parseFloat(String(invoice.amount_paid)));

  const linesHtml = (invoice.lines && invoice.lines.length > 0)
    ? `
      <p class="section-title">Line Items</p>
      <table>
        <thead>
          <tr>
            <th>Description</th>
            <th style="text-align:center">Qty</th>
            <th style="text-align:right">Unit Price</th>
            <th style="text-align:right">Total</th>
          </tr>
        </thead>
        <tbody>
          ${invoice.lines.map(l => `
          <tr>
            <td>${l.description || '—'}</td>
            <td style="text-align:center">${l.quantity}</td>
            <td style="text-align:right">$${fmt(l.unit_price)}</td>
            <td style="text-align:right">$${fmt(l.total)}</td>
          </tr>`).join('')}
        </tbody>
      </table>`
    : '';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyle}</style></head><body>
<div class="wrapper">
  <div class="header">
    <h1>⚡ Brightloop Billing</h1>
    <p>Invoice Confirmed</p>
  </div>
  <div class="body">
    <p style="font-size:15px;margin-bottom:20px;">Hi <strong>${customerName}</strong>,<br>Your invoice has been confirmed and is now due for payment.</p>

    <p class="section-title">Invoice Details</p>
    <div class="info-box">
      <div class="info-row"><span>Invoice Number</span><span>${invoice.invoice_number}</span></div>
      <div class="info-row"><span>Invoice Date</span><span>${invoiceDate}</span></div>
      <div class="info-row"><span>Due Date</span><span>${dueDate}</span></div>
      <div class="info-row"><span>Status</span><span><span class="badge">Confirmed</span></span></div>
    </div>

    ${linesHtml}

    <p class="section-title">Payment Summary</p>
    <div class="totals">
      <div class="total-row"><span style="color:#a0aec0">Subtotal</span><span>$${subtotal}</span></div>
      <div class="total-row"><span style="color:#a0aec0">Discount</span><span>−$${discount}</span></div>
      <div class="total-row"><span style="color:#a0aec0">Tax</span><span>$${tax}</span></div>
      <div class="total-row grand"><span>Total Due</span><span>$${total}</span></div>
      <div class="total-row" style="margin-top:8px"><span style="color:#a0aec0">Amount Paid</span><span>$${amountPaid}</span></div>
      <div class="total-row" style="font-weight:700;color:#e94560"><span>Balance Due</span><span>$${balanceDue}</span></div>
    </div>

    <p style="font-size:13px;color:#a0aec0;">Please ensure payment is made by <strong style="color:#e94560">${dueDate}</strong> to avoid any late fees.</p>
  </div>
  <div class="footer">Thank you for your business — Brightloop Billing</div>
</div>
</body></html>`;

  const text = `Invoice ${invoice.invoice_number} Confirmed\nDear ${customerName},\nYour invoice ${invoice.invoice_number} for $${total} is due by ${dueDate}.\nPlease log in to your account to make a payment.\n\nThank you for your business.`;

  await sendEmail({
    to: customerEmail,
    subject: `Invoice ${invoice.invoice_number} Confirmed – $${total} due by ${dueDate}`,
    text,
    html
  });
}

export async function sendPaymentReceivedEmail(
  payment: PaymentForEmail,
  invoice: InvoiceForEmail,
  customerEmail: string,
  customerName: string
): Promise<void> {
  const amount = fmt(payment.amount);
  const total = fmt(invoice.total);
  const amountPaid = fmt(invoice.amount_paid);
  const remaining = Math.max(0, parseFloat(String(invoice.total)) - parseFloat(String(invoice.amount_paid)));
  const isPaidInFull = remaining <= 0.005;
  const balanceText = isPaidInFull ? '<span class="badge green">PAID IN FULL</span>' : `$${fmt(remaining)} remaining`;
  const paymentDate = fmtDate(payment.payment_date || payment.recorded_at);

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyle}</style></head><body>
<div class="wrapper">
  <div class="header">
    <h1>⚡ Brightloop Billing</h1>
    <p>Payment Received</p>
  </div>
  <div class="body">
    <p style="font-size:15px;margin-bottom:20px;">Hi <strong>${customerName}</strong>,<br>We have received your payment. Thank you!</p>

    <p class="section-title">Payment Details</p>
    <div class="info-box">
      <div class="info-row"><span>Invoice</span><span>${invoice.invoice_number}</span></div>
      <div class="info-row"><span>Payment Date</span><span>${paymentDate}</span></div>
      <div class="info-row"><span>Method</span><span>${payment.payment_method ?? '—'}</span></div>
      ${payment.reference ? `<div class="info-row"><span>Reference</span><span>${payment.reference}</span></div>` : ''}
    </div>

    <p class="section-title">Account Summary</p>
    <div class="totals">
      <div class="total-row"><span style="color:#a0aec0">Invoice Total</span><span>$${total}</span></div>
      <div class="total-row"><span style="color:#a0aec0">This Payment</span><span style="color:#38a169;font-weight:700">$${amount}</span></div>
      <div class="total-row"><span style="color:#a0aec0">Total Paid</span><span>$${amountPaid}</span></div>
      <div class="total-row grand"><span>Balance</span><span>${balanceText}</span></div>
    </div>

    ${isPaidInFull
      ? `<p style="font-size:13px;color:#38a169;font-weight:600;">🎉 This invoice is now fully paid. No further action is required.</p>`
      : `<p style="font-size:13px;color:#a0aec0;">A balance of <strong style="color:#e94560">$${fmt(remaining)}</strong> remains on this invoice. Please log in to make the remaining payment.</p>`
    }
  </div>
  <div class="footer">Thank you for your business — Brightloop Billing</div>
</div>
</body></html>`;

  const text = `Payment of $${amount} received for Invoice ${invoice.invoice_number}.\nDear ${customerName},\n${isPaidInFull ? 'This invoice is now PAID IN FULL.' : `Remaining balance: $${fmt(remaining)}`}\n\nThank you for your business.`;

  await sendEmail({
    to: customerEmail,
    subject: `Payment of $${amount} Received – Invoice ${invoice.invoice_number}`,
    text,
    html
  });
}
