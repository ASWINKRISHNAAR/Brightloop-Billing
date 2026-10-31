import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';

// ─── Types ───────────────────────────────────────────────────────────────────
interface Customer { id: string; name: string; email: string; company?: string | null; }
interface Plan { id: string; name: string; period: string; price: number; }
interface Product { id: string; name: string; base_price: number; }
interface Variant { id: string; product_id: string; attribute: string; value: string; extra_price: number; }

interface SubLine {
  productId: string;
  variantId: string | null;
  quantity: number;
  unitPrice: number;
}

interface NewSubForm {
  customerId: string;
  planId: string;
  startDate: string;
  expiryDate: string;
  notes: string;
  lines: SubLine[];
}

interface Subscription {
  id: string;
  subscription_number: string;
  customer_name?: string;
  plan_name?: string;
  status: string;
  start_date: string;
  next_billing_date?: string;
  expiry_date?: string;
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

function formatDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function SubscriptionsPage() {
  const { user } = useAuth();
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [actionModal, setActionModal] = useState<{ sub: Subscription; action: string } | null>(null);
  const [actionNote, setActionNote] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const PAGE_SIZE = 10;

  const isAdmin = user?.role === 'admin' || user?.role === 'staff';

  // ── New Subscription Form State ─────────────────────────────────────────────
  const [formStep, setFormStep] = useState(1); // 1=basics, 2=line items
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [custSearch, setCustSearch] = useState('');
  const [custDropOpen, setCustDropOpen] = useState(false);
  const custRef = useRef<HTMLDivElement>(null);

  const emptyForm = (): NewSubForm => ({
    customerId: '',
    planId: '',
    startDate: new Date().toISOString().slice(0, 10),
    expiryDate: '',
    notes: '',
    lines: [],
  });
  const [form, setForm] = useState<NewSubForm>(emptyForm());

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
      const res = await api.get(`/subscriptions?${params}`);
      setSubs(res.data.data || []);
      setTotal(res.data.total || 0);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to load subscriptions');
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter]);

  useEffect(() => { load(); }, [load]);

  // ── Load reference data when modal opens ────────────────────────────────────
  useEffect(() => {
    if (!showModal) return;
    Promise.all([
      api.get('/customers?limit=200'),
      api.get('/plans?limit=100'),
      api.get('/products?limit=100'),
    ]).then(([c, p, pr]) => {
      setCustomers(c.data.data || []);
      setPlans(p.data.data || []);
      setProducts(pr.data.data || []);
    }).catch(() => {});
  }, [showModal]);

  // Load variants when products are available
  useEffect(() => {
    if (products.length === 0) return;
    api.get('/product-variants?limit=200').then((r) => {
      setVariants(r.data.data || []);
    }).catch(() => {});
  }, [products]);

  // Close customer dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (custRef.current && !custRef.current.contains(e.target as Node)) setCustDropOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const openModal = () => {
    setForm(emptyForm());
    setFormStep(1);
    setFormError('');
    setCustSearch('');
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setFormStep(1);
    setFormError('');
  };

  const selectedCustomer = customers.find(c => c.id === form.customerId);
  const selectedPlan = plans.find(p => p.id === form.planId);
  const filteredCustomers = customers.filter(c =>
    c.name.toLowerCase().includes(custSearch.toLowerCase()) ||
    c.email.toLowerCase().includes(custSearch.toLowerCase()) ||
    (c.company || '').toLowerCase().includes(custSearch.toLowerCase())
  );

  const addLine = () => {
    setForm(f => ({ ...f, lines: [...f.lines, { productId: '', variantId: null, quantity: 1, unitPrice: 0 }] }));
  };

  const removeLine = (idx: number) => {
    setForm(f => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }));
  };

  const updateLine = (idx: number, patch: Partial<SubLine>) => {
    setForm(f => ({
      ...f,
      lines: f.lines.map((l, i) => {
        if (i !== idx) return l;
        const updated = { ...l, ...patch };
        // Auto-fill unit price when product changes
        if (patch.productId !== undefined) {
          const prod = products.find(p => p.id === patch.productId);
          updated.unitPrice = prod ? prod.base_price : 0;
          updated.variantId = null;
        }
        if (patch.variantId !== undefined && patch.variantId) {
          const prod = products.find(p => p.id === updated.productId);
          const v = variants.find(v => v.id === patch.variantId);
          updated.unitPrice = (prod?.base_price || 0) + (v?.extra_price || 0);
        }
        return updated;
      })
    }));
  };

  const lineTotal = form.lines.reduce((acc, l) => acc + l.unitPrice * l.quantity, 0);

  const handleSubmit = async () => {
    setFormError('');
    if (!form.customerId) { setFormError('Please select a customer.'); return; }
    if (!form.planId) { setFormError('Please select a billing plan.'); return; }
    if (!form.startDate) { setFormError('Please set a start date.'); return; }

    setFormLoading(true);
    try {
      const payload: Record<string, unknown> = {
        customerId: form.customerId,
        planId: form.planId,
        startDate: form.startDate,
        notes: form.notes || undefined,
        expiryDate: form.expiryDate || undefined,
        lines: form.lines.filter(l => l.productId).map(l => ({
          productId: l.productId,
          variantId: l.variantId || undefined,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
        })),
      };
      await api.post('/subscriptions', payload);
      closeModal();
      load();
    } catch (e: any) {
      const data = e?.response?.data;
      const msg = data?.detail || Object.values(data?.errors || {}).flat().join(', ') || 'Failed to create subscription.';
      setFormError(msg);
    } finally {
      setFormLoading(false);
    }
  };

  const handleAction = async () => {
    if (!actionModal) return;
    setActionLoading(true);
    try {
      const { sub, action } = actionModal;
      if (action === 'confirm') {
        await api.post(`/subscriptions/${sub.id}/transition`, { to: 'confirmed' });
      } else if (action === 'activate') {
        await api.post(`/subscriptions/${sub.id}/transition`, { to: 'active' });
      } else if (action === 'close') {
        await api.post(`/subscriptions/${sub.id}/close`);
      } else if (action === 'pause') {
        const pauseUntil = new Date();
        pauseUntil.setDate(pauseUntil.getDate() + 30);
        await api.post(`/subscriptions/${sub.id}/pause`, {
          pausedUntil: pauseUntil.toISOString().slice(0, 10)
        });
      } else if (action === 'resume') {
        await api.post(`/subscriptions/${sub.id}/resume`);
      }
      setActionModal(null);
      load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Action failed');
    } finally {
      setActionLoading(false);
    }
  };

  const getActions = (sub: Subscription) => {
    const actions: string[] = [];
    if (!isAdmin) return actions;
    if (sub.status === 'draft') actions.push('confirm');
    if (sub.status === 'confirmed') actions.push('activate');
    if (sub.status === 'active') { actions.push('pause'); actions.push('close'); }
    if (sub.status === 'paused') { actions.push('resume'); actions.push('close'); }
    return actions;
  };

  const pages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Subscriptions</h1>
          <p className="page-subtitle">{total} total subscriptions</p>
        </div>
        {isAdmin && (
          <button className="btn btn-primary" onClick={openModal} id="new-subscription-btn">
            + New Subscription
          </button>
        )}
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
                placeholder="Search subscriptions…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                id="sub-search"
              />
            </div>
            <select
              className="form-control"
              style={{ width: 160 }}
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              id="sub-status-filter"
            >
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="quotation">Quotation</option>
              <option value="confirmed">Confirmed</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="closed">Closed</option>
            </select>
            <button className="btn btn-secondary btn-sm" onClick={load}>↻ Refresh</button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="table-container">
          {loading ? (
            <div className="loading-overlay"><div className="spinner" /></div>
          ) : subs.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">♻</div>
              <div className="empty-title">No subscriptions found</div>
              <div className="empty-desc">Create your first subscription to get started</div>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Customer</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Start Date</th>
                  <th>Next Billing</th>
                  {isAdmin && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {subs.map((sub) => (
                  <tr key={sub.id}>
                    <td className="text-primary font-mono" style={{ fontSize: 12.5 }}>
                      {sub.subscription_number}
                    </td>
                    <td>{sub.customer_name || '—'}</td>
                    <td className="text-secondary">{sub.plan_name || '—'}</td>
                    <td><StatusBadge status={sub.status} /></td>
                    <td className="text-sm text-muted">{formatDate(sub.start_date)}</td>
                    <td className="text-sm text-muted">{formatDate(sub.next_billing_date)}</td>
                    {isAdmin && (
                      <td>
                        <div className="flex gap-2">
                          {getActions(sub).map((action) => (
                            <button
                              key={action}
                              className={`btn btn-sm ${action === 'close' ? 'btn-danger' : 'btn-secondary'}`}
                              onClick={() => { setActionModal({ sub, action }); setActionNote(''); }}
                              id={`${action}-sub-${sub.id}`}
                            >
                              {action.charAt(0).toUpperCase() + action.slice(1)}
                            </button>
                          ))}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
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

      {/* Action Confirmation Modal */}
      {actionModal && (
        <div className="modal-overlay" onClick={() => setActionModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                Confirm: {actionModal.action.charAt(0).toUpperCase() + actionModal.action.slice(1)} Subscription
              </span>
              <button className="btn-icon" onClick={() => setActionModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
                Are you sure you want to{' '}
                <strong style={{ color: 'var(--text-primary)' }}>{actionModal.action}</strong>{' '}
                subscription <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-primary)' }}>
                  {actionModal.sub.subscription_number}
                </code>?
              </p>
              {actionModal.action === 'close' && (
                <div className="form-group">
                  <label className="form-label">Reason / Notes (optional)</label>
                  <textarea
                    className="form-control"
                    rows={3}
                    value={actionNote}
                    onChange={(e) => setActionNote(e.target.value)}
                    placeholder="Reason for closing…"
                  />
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setActionModal(null)}>Cancel</button>
              <button
                className={`btn ${actionModal.action === 'close' ? 'btn-danger' : 'btn-primary'}`}
                onClick={handleAction}
                disabled={actionLoading}
                id="confirm-action-btn"
              >
                {actionLoading ? 'Processing…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── New Subscription Modal ─────────────────────────────────────────── */}
      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" style={{ maxWidth: 640, width: '95%' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">New Subscription</span>
              <button className="btn-icon" onClick={closeModal}>✕</button>
            </div>

            {/* Step indicator */}
            <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border-subtle)', background: 'var(--surface-secondary)' }}>
              {['Basics', 'Line Items'].map((label, i) => (
                <div key={label} style={{
                  flex: 1, padding: '10px 0', textAlign: 'center', fontSize: 13, fontWeight: 600,
                  color: formStep === i + 1 ? 'var(--accent-primary)' : 'var(--text-muted)',
                  borderBottom: formStep === i + 1 ? '2px solid var(--accent-primary)' : '2px solid transparent',
                  cursor: 'pointer',
                }} onClick={() => setFormStep(i + 1)}>
                  {i + 1}. {label}
                </div>
              ))}
            </div>

            <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
              {formError && <div className="alert alert-error mb-4"><span>⚠</span> {formError}</div>}

              {/* ── Step 1: Basics ─────────────────────────────────────────── */}
              {formStep === 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

                  {/* Customer selector */}
                  <div className="form-group" ref={custRef}>
                    <label className="form-label">Customer <span style={{ color: 'var(--accent-danger)' }}>*</span></label>
                    <div style={{ position: 'relative' }}>
                      <input
                        className="form-control"
                        placeholder="Search customers…"
                        value={custSearch || selectedCustomer?.name || ''}
                        onChange={e => { setCustSearch(e.target.value); setCustDropOpen(true); setForm(f => ({ ...f, customerId: '' })); }}
                        onFocus={() => setCustDropOpen(true)}
                        autoComplete="off"
                      />
                      {custDropOpen && filteredCustomers.length > 0 && (
                        <div style={{
                          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 999,
                          background: 'var(--surface-card)', border: '1px solid var(--border-default)',
                          borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', maxHeight: 220, overflowY: 'auto',
                        }}>
                          {filteredCustomers.slice(0, 15).map(c => (
                            <div key={c.id}
                              style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)' }}
                              onMouseDown={() => {
                                setForm(f => ({ ...f, customerId: c.id }));
                                setCustSearch('');
                                setCustDropOpen(false);
                              }}
                            >
                              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{c.name}</div>
                              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{c.email}{c.company ? ` · ${c.company}` : ''}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {selectedCustomer && (
                      <div style={{ marginTop: 6, fontSize: 12, color: 'var(--accent-success)' }}>
                        ✓ {selectedCustomer.name} ({selectedCustomer.email})
                      </div>
                    )}
                  </div>

                  {/* Plan selector */}
                  <div className="form-group">
                    <label className="form-label">Billing Plan <span style={{ color: 'var(--accent-danger)' }}>*</span></label>
                    <select
                      className="form-control"
                      value={form.planId}
                      onChange={e => setForm(f => ({ ...f, planId: e.target.value }))}
                    >
                      <option value="">Select a plan…</option>
                      {plans.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name} — ${p.price}/{p.period}
                        </option>
                      ))}
                    </select>
                    {selectedPlan && (
                      <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                        Billing cycle: <strong style={{ color: 'var(--text-secondary)' }}>{selectedPlan.period}</strong> · Base price: <strong style={{ color: 'var(--accent-primary)' }}>${selectedPlan.price}</strong>
                      </div>
                    )}
                  </div>

                  {/* Dates */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                    <div className="form-group">
                      <label className="form-label">Start Date <span style={{ color: 'var(--accent-danger)' }}>*</span></label>
                      <input type="date" className="form-control" value={form.startDate}
                        onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Expiry Date <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
                      <input type="date" className="form-control" value={form.expiryDate}
                        onChange={e => setForm(f => ({ ...f, expiryDate: e.target.value }))}
                        min={form.startDate} />
                    </div>
                  </div>

                  {/* Notes */}
                  <div className="form-group">
                    <label className="form-label">Notes <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
                    <textarea className="form-control" rows={2} value={form.notes}
                      onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                      placeholder="Internal notes about this subscription…" />
                  </div>
                </div>
              )}

              {/* ── Step 2: Line Items ─────────────────────────────────────── */}
              {formStep === 2 && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      Add products to this subscription. Leave empty to use plan pricing only.
                    </div>
                    <button className="btn btn-sm btn-secondary" onClick={addLine}>+ Add Line</button>
                  </div>

                  {form.lines.length === 0 ? (
                    <div style={{
                      textAlign: 'center', padding: '32px 20px', border: '2px dashed var(--border-subtle)',
                      borderRadius: 'var(--radius-lg)', color: 'var(--text-muted)', fontSize: 13,
                    }}>
                      <div style={{ fontSize: 28, marginBottom: 8 }}>📦</div>
                      No line items yet. Click <strong>+ Add Line</strong> to add products.
                      <br /><span style={{ fontSize: 11.5 }}>Or skip to create a plan-only subscription.</span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {form.lines.map((line, idx) => {
                        const lineVariants = variants.filter(v => v.product_id === line.productId);
                        return (
                          <div key={idx} style={{
                            background: 'var(--surface-secondary)', borderRadius: 'var(--radius-md)',
                            padding: '12px 14px', border: '1px solid var(--border-subtle)',
                          }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr 80px 90px 32px', gap: 8, alignItems: 'center' }}>
                              {/* Product */}
                              <select className="form-control" style={{ fontSize: 12.5 }}
                                value={line.productId}
                                onChange={e => updateLine(idx, { productId: e.target.value })}>
                                <option value="">Select product…</option>
                                {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                              </select>
                              {/* Variant */}
                              <select className="form-control" style={{ fontSize: 12.5 }}
                                value={line.variantId || ''}
                                onChange={e => updateLine(idx, { variantId: e.target.value || null })}
                                disabled={!line.productId || lineVariants.length === 0}>
                                <option value="">No variant</option>
                                {lineVariants.map(v => <option key={v.id} value={v.id}>{v.attribute}: {v.value} (+${v.extra_price})</option>)}
                              </select>
                              {/* Qty */}
                              <input type="number" className="form-control" style={{ fontSize: 12.5, textAlign: 'center' }}
                                min={1} value={line.quantity}
                                onChange={e => updateLine(idx, { quantity: Math.max(1, parseInt(e.target.value) || 1) })} />
                              {/* Unit Price */}
                              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>$</span>
                                <input type="number" className="form-control" style={{ fontSize: 12.5 }}
                                  min={0} step={0.01} value={line.unitPrice}
                                  onChange={e => updateLine(idx, { unitPrice: parseFloat(e.target.value) || 0 })} />
                              </div>
                              {/* Remove */}
                              <button className="btn-icon" style={{ color: 'var(--accent-danger)' }}
                                onClick={() => removeLine(idx)}>✕</button>
                            </div>
                            <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                              Line total: <strong style={{ color: 'var(--text-primary)' }}>
                                ${(line.unitPrice * line.quantity).toFixed(2)}
                              </strong>
                            </div>
                          </div>
                        );
                      })}

                      {/* Grand total */}
                      <div style={{
                        textAlign: 'right', padding: '10px 14px',
                        borderTop: '1px solid var(--border-subtle)', marginTop: 4,
                        fontSize: 14, fontWeight: 700, color: 'var(--accent-primary)',
                      }}>
                        Line Items Total: ${lineTotal.toFixed(2)}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="modal-footer">
              {formStep === 2 && (
                <button className="btn btn-secondary" onClick={() => setFormStep(1)}>← Back</button>
              )}
              <button className="btn btn-secondary" onClick={closeModal}>Cancel</button>
              {formStep === 1 ? (
                <button className="btn btn-primary"
                  onClick={() => {
                    if (!form.customerId) { setFormError('Please select a customer.'); return; }
                    if (!form.planId) { setFormError('Please select a billing plan.'); return; }
                    setFormError('');
                    setFormStep(2);
                  }}>
                  Next: Line Items →
                </button>
              ) : (
                <button className="btn btn-primary" onClick={handleSubmit} disabled={formLoading} id="create-sub-btn">
                  {formLoading ? <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Creating…</> : '✓ Create Subscription'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
