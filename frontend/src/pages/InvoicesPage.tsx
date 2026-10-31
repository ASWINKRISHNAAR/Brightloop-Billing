import React, { useState, useEffect, useCallback } from 'react';
import api from '../api/client';

interface Invoice {
  id: string;
  invoice_number: string;
  subscription_id: string;
  customer_name?: string;
  status: string;
  invoice_date: string;
  due_date: string;
  period_start: string;
  period_end: string;
  subtotal: string;
  discount_amount: string;
  tax_amount: string;
  total: string;
  amount_paid: string;
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

function fmtMoney(v: string | number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(v));
}

function fmtDate(d: string) {
  if (!d) return '—';
  const date = new Date(d);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ inv: Invoice; action: 'confirm' | 'cancel' } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState<Set<string>>(new Set());
  const PAGE_SIZE = 12;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String((page - 1) * PAGE_SIZE),
        ...(search ? { search } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
      });
      const res = await api.get(`/billing/invoices?${params}`);
      setInvoices(res.data.data || []);
      setTotal(res.data.total || 0);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const handleAction = async () => {
    if (!confirmModal) return;
    setActionLoading(true);
    try {
      const { inv, action } = confirmModal;
      await api.patch(`/billing/invoices/${inv.id}/status`, { status: action === 'confirm' ? 'confirmed' : 'cancelled' });
      setConfirmModal(null);
      setSelected(null);
      load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Action failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDownload = async (inv: Invoice) => {
    setDownloading((prev) => new Set(prev).add(inv.id));
    try {
      const res = await api.get(`/billing/invoices/${inv.id}/pdf`, { responseType: 'blob' });
      const blob = res.data as Blob;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `invoice-${inv.invoice_number}.html`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Download failed');
    } finally {
      setDownloading((prev) => {
        const next = new Set(prev);
        next.delete(inv.id);
        return next;
      });
    }
  };

  const pages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Invoices</h1>
          <p className="page-subtitle">{total} total invoices</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={load}>↻ Refresh</button>
      </div>

      {error && <div className="alert alert-error mb-4"><span>⚠</span> {error}</div>}

      {/* Filters */}
      <div className="card mb-6">
        <div className="card-body" style={{ padding: '16px 20px' }}>
          <div className="flex gap-3 flex-wrap items-center">
            <div className="search-bar" style={{ flex: 1, minWidth: 200 }}>
              <span className="search-icon">🔍</span>
              <input
                className="form-control"
                placeholder="Search invoices…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            <select
              className="form-control"
              style={{ width: 160 }}
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            >
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="confirmed">Confirmed</option>
              <option value="paid">Paid</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="table-container">
          {loading ? (
            <div className="loading-overlay"><div className="spinner" /></div>
          ) : invoices.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🧾</div>
              <div className="empty-title">No invoices found</div>
              <div className="empty-desc">Invoices are auto-generated by the billing engine</div>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Customer</th>
                  <th>Period</th>
                  <th>Status</th>
                  <th>Invoice Date</th>
                  <th>Due Date</th>
                  <th className="text-right">Subtotal</th>
                  <th className="text-right">Discount</th>
                  <th className="text-right">Tax</th>
                  <th className="text-right">Total</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td
                      className="text-primary font-mono"
                      style={{ fontSize: 12.5, cursor: 'pointer' }}
                      onClick={() => setSelected(selected?.id === inv.id ? null : inv)}
                    >
                      {inv.invoice_number}
                    </td>
                    <td>{inv.customer_name || '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {fmtDate(inv.period_start)} – {fmtDate(inv.period_end)}
                    </td>
                    <td><StatusBadge status={inv.status} /></td>
                    <td className="text-sm text-muted">{fmtDate(inv.invoice_date)}</td>
                    <td className="text-sm text-muted">{fmtDate(inv.due_date)}</td>
                    <td className="amount text-right">{fmtMoney(inv.subtotal)}</td>
                    <td className="amount text-right text-success">
                      {Number(inv.discount_amount) > 0 ? `-${fmtMoney(inv.discount_amount)}` : '—'}
                    </td>
                    <td className="amount text-right">{fmtMoney(inv.tax_amount)}</td>
                    <td className="amount text-right font-bold" style={{ color: 'var(--text-primary)' }}>
                      {fmtMoney(inv.total)}
                    </td>
                    <td>
                      <div className="flex gap-2">
                        {inv.status === 'draft' && (
                          <button
                            className="btn btn-sm btn-success"
                            onClick={() => setConfirmModal({ inv, action: 'confirm' })}
                            id={`confirm-inv-${inv.id}`}
                          >
                            Confirm
                          </button>
                        )}
                        {(inv.status === 'draft' || inv.status === 'confirmed') && (
                          <button
                            className="btn btn-sm btn-danger"
                            onClick={() => setConfirmModal({ inv, action: 'cancel' })}
                            id={`cancel-inv-${inv.id}`}
                          >
                            Cancel
                          </button>
                        )}
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={() => handleDownload(inv)}
                          disabled={downloading.has(inv.id)}
                          title="Download invoice"
                        >
                          {downloading.has(inv.id) ? <span className="spinner" style={{ width: 12, height: 12, display: 'inline-block' }} /> : '⬇'} Download
                        </button>
                      </div>
                    </td>
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

      {/* Invoice Detail Panel */}
      {selected && (
        <div className="card mt-4">
          <div className="card-header">
            <span className="card-title">Invoice Detail: {selected.invoice_number}</span>
            <div className="flex gap-2 items-center">
              <button
                className="btn btn-primary btn-sm"
                onClick={() => handleDownload(selected)}
                disabled={downloading.has(selected.id)}
                title="Download invoice"
              >
                {downloading.has(selected.id) ? <span className="spinner" style={{ width: 12, height: 12, display: 'inline-block' }} /> : '⬇'} Download
              </button>
              <button className="btn-icon" onClick={() => setSelected(null)}>✕</button>
            </div>
          </div>
          <div className="card-body">
            <div className="grid-2 gap-4">
              <div>
                <div className="text-muted text-sm mb-1">Period</div>
                <div>{fmtDate(selected.period_start)} → {fmtDate(selected.period_end)}</div>
              </div>
              <div>
                <div className="text-muted text-sm mb-1">Status</div>
                <StatusBadge status={selected.status} />
              </div>
              <div>
                <div className="text-muted text-sm mb-1">Subtotal</div>
                <div className="font-mono">{fmtMoney(selected.subtotal)}</div>
              </div>
              <div>
                <div className="text-muted text-sm mb-1">Discount</div>
                <div className="font-mono text-success">-{fmtMoney(selected.discount_amount)}</div>
              </div>
              <div>
                <div className="text-muted text-sm mb-1">Tax</div>
                <div className="font-mono">{fmtMoney(selected.tax_amount)}</div>
              </div>
              <div>
                <div className="text-muted text-sm mb-1">Total Due</div>
                <div className="font-mono font-bold" style={{ color: 'var(--accent-primary)', fontSize: 18 }}>
                  {fmtMoney(selected.total)}
                </div>
              </div>
              <div>
                <div className="text-muted text-sm mb-1">Amount Paid</div>
                <div className="font-mono text-success">{fmtMoney(selected.amount_paid)}</div>
              </div>
              <div>
                <div className="text-muted text-sm mb-1">Balance</div>
                <div className="font-mono" style={{ color: Number(selected.total) - Number(selected.amount_paid) > 0 ? 'var(--accent-danger)' : 'var(--accent-success)' }}>
                  {fmtMoney(Number(selected.total) - Number(selected.amount_paid))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Action Modal */}
      {confirmModal && (
        <div className="modal-overlay" onClick={() => setConfirmModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                {confirmModal.action === 'confirm' ? 'Confirm Invoice' : 'Cancel Invoice'}
              </span>
              <button className="btn-icon" onClick={() => setConfirmModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
                {confirmModal.action === 'confirm'
                  ? `Confirm invoice ${confirmModal.inv.invoice_number} for ${fmtMoney(confirmModal.inv.total)}?`
                  : `Cancel invoice ${confirmModal.inv.invoice_number}? This action cannot be undone.`}
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setConfirmModal(null)}>Back</button>
              <button
                className={`btn ${confirmModal.action === 'cancel' ? 'btn-danger' : 'btn-primary'}`}
                onClick={handleAction}
                disabled={actionLoading}
              >
                {actionLoading ? '…' : confirmModal.action === 'confirm' ? 'Confirm Invoice' : 'Cancel Invoice'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
