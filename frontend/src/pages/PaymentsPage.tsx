import React, { useState, useEffect, useCallback } from 'react';
import api from '../api/client';

interface Payment {
  id: string;
  invoice_id: string;
  invoice_number?: string;
  amount: string;
  method: string;
  reference?: string;
  recorded_at: string;
  recorded_by?: string;
}

function fmtMoney(v: string | number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(v));
}

function fmtDate(d: string) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

const METHODS = ['bank_transfer', 'credit_card', 'check', 'cash', 'other'];

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const PAGE_SIZE = 12;

  // New payment form state
  const [invoiceId, setInvoiceId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('bank_transfer');
  const [reference, setReference] = useState('');
  const [recordedAt, setRecordedAt] = useState(new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String((page - 1) * PAGE_SIZE),
      });
      const res = await api.get(`/billing/payments?${params}`);
      setPayments(res.data.data || []);
      setTotal(res.data.total || 0);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to load payments');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const handleRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await api.post('/billing/payments', {
        invoice_id: invoiceId,
        amount: parseFloat(amount),
        method,
        reference: reference || undefined,
        recorded_at: recordedAt,
      });
      setSuccess('✓ Payment recorded successfully!');
      setShowModal(false);
      setInvoiceId(''); setAmount(''); setReference('');
      load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to record payment');
    } finally {
      setSubmitting(false);
    }
  };

  const pages = Math.ceil(total / PAGE_SIZE);

  const methodIcon: Record<string, string> = {
    bank_transfer: '🏦',
    credit_card: '💳',
    check: '✉',
    cash: '💵',
    other: '💱',
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Payments</h1>
          <p className="page-subtitle">{total} total payments recorded</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)} id="record-payment-btn">
          + Record Payment
        </button>
      </div>

      {error && <div className="alert alert-error mb-4"><span>⚠</span> {error}</div>}
      {success && <div className="alert alert-success mb-4"><span>✓</span> {success}</div>}

      <div className="card">
        <div className="table-container">
          {loading ? (
            <div className="loading-overlay"><div className="spinner" /></div>
          ) : payments.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">💳</div>
              <div className="empty-title">No payments yet</div>
              <div className="empty-desc">Record payments against confirmed invoices</div>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Method</th>
                  <th>Reference</th>
                  <th className="text-right">Amount</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="text-primary font-mono" style={{ fontSize: 12.5 }}>
                      {p.invoice_number || p.invoice_id.slice(0, 8) + '…'}
                    </td>
                    <td>
                      <span style={{ marginRight: 6 }}>{methodIcon[p.method] || '💱'}</span>
                      {p.method.replace('_', ' ')}
                    </td>
                    <td className="text-muted font-mono" style={{ fontSize: 12 }}>
                      {p.reference || '—'}
                    </td>
                    <td className="amount text-right text-success">{fmtMoney(p.amount)}</td>
                    <td className="text-sm text-muted">{fmtDate(p.recorded_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {pages > 1 && (
          <div className="pagination">
            <button className="page-btn" onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}>‹</button>
            {Array.from({ length: Math.min(pages, 5) }, (_, i) => i + 1).map((p) => (
              <button key={p} className={`page-btn${page === p ? ' active' : ''}`} onClick={() => setPage(p)}>{p}</button>
            ))}
            <button className="page-btn" onClick={() => setPage(Math.min(pages, page + 1))} disabled={page === pages}>›</button>
          </div>
        )}
      </div>

      {/* Record Payment Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Record Payment</span>
              <button className="btn-icon" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <form onSubmit={handleRecord}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Invoice ID *</label>
                  <input
                    type="text"
                    className="form-control"
                    value={invoiceId}
                    onChange={(e) => setInvoiceId(e.target.value)}
                    placeholder="Invoice UUID"
                    required
                    id="payment-invoice-id"
                  />
                  <span className="text-muted text-sm mt-1">Get the invoice ID from the Invoices page</span>
                </div>
                <div className="form-group">
                  <label className="form-label">Amount (USD) *</label>
                  <input
                    type="number"
                    className="form-control"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    required
                    id="payment-amount"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Payment Method *</label>
                  <select
                    className="form-control"
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                    id="payment-method"
                  >
                    {METHODS.map((m) => (
                      <option key={m} value={m}>{m.replace('_', ' ')}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Reference (optional)</label>
                  <input
                    type="text"
                    className="form-control"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="Transaction ID, check #, etc."
                    id="payment-reference"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Payment Date</label>
                  <input
                    type="date"
                    className="form-control"
                    value={recordedAt}
                    onChange={(e) => setRecordedAt(e.target.value)}
                    id="payment-date"
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={submitting} id="submit-payment">
                  {submitting ? '…' : '✓ Record Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
