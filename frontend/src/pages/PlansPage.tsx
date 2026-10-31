import React, { useState, useEffect, useCallback } from 'react';
import api from '../api/client';

interface Plan {
  id: string;
  name: string;
  period: string;
  price: string;
  min_quantity: number;
  auto_close: boolean;
  closable: boolean;
  pausable: boolean;
  renewable: boolean;
  is_active: boolean;
  version: number;
  available_from?: string;
  available_until?: string;
}

function fmtMoney(v: string | number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(v));
}

const PERIODS = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editPlan, setEditPlan] = useState<Plan | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    name: '', period: 'monthly', price: '', min_quantity: '1',
    auto_close: false, closable: true, pausable: true, renewable: true,
    available_from: '', available_until: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/plans?includeInactive=true');
      setPlans(res.data.data || res.data || []);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to load plans');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditPlan(null);
    setForm({ name: '', period: 'monthly', price: '', min_quantity: '1', auto_close: false, closable: true, pausable: true, renewable: true, available_from: '', available_until: '' });
    setShowModal(true);
  };

  const openEdit = (p: Plan) => {
    setEditPlan(p);
    setForm({
      name: p.name, period: p.period, price: p.price, min_quantity: String(p.min_quantity),
      auto_close: p.auto_close, closable: p.closable, pausable: p.pausable, renewable: p.renewable,
      available_from: p.available_from || '', available_until: p.available_until || '',
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const payload = {
        ...form,
        price: parseFloat(form.price),
        min_quantity: parseInt(form.min_quantity),
        available_from: form.available_from || undefined,
        available_until: form.available_until || undefined,
        ...(editPlan ? { version: editPlan.version } : {}),
      };
      if (editPlan) {
        await api.put(`/plans/${editPlan.id}`, payload);
      } else {
        await api.post('/plans', payload);
      }
      setShowModal(false);
      load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to save plan');
    } finally {
      setSubmitting(false);
    }
  };

  const periodIcon: Record<string, string> = { daily: '📅', weekly: '📆', monthly: '📊', quarterly: '📈', yearly: '🗓' };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Plans</h1>
          <p className="page-subtitle">Billing plans and pricing tiers</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate} id="add-plan-btn">+ Add Plan</button>
      </div>

      {error && <div className="alert alert-error mb-4"><span>⚠</span> {error}</div>}

      {loading ? (
        <div className="loading-overlay"><div className="spinner" /></div>
      ) : plans.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📋</div>
          <div className="empty-title">No plans yet</div>
          <div className="empty-desc">Create billing plans to attach to subscriptions</div>
          <button className="btn btn-primary mt-4" onClick={openCreate}>+ Add Plan</button>
        </div>
      ) : (
        <div className="grid-3">
          {plans.map((plan) => (
            <div className="card" key={plan.id}>
              <div className="card-body">
                <div className="flex items-center gap-3 mb-4">
                  <div style={{ fontSize: 28 }}>{periodIcon[plan.period] || '📋'}</div>
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 15 }}>{plan.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'capitalize' }}>{plan.period}</div>
                  </div>
                  <div className="spacer" />
                  <span className={`badge ${plan.is_active ? 'badge-active' : 'badge-closed'}`}>
                    {plan.is_active ? 'Active' : 'Off'}
                  </span>
                </div>

                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 800, color: 'var(--accent-primary)', marginBottom: 16 }}>
                  {fmtMoney(plan.price)}
                  <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>
                    /{plan.period}
                  </span>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
                  {plan.auto_close && <span className="badge badge-draft">Auto-close</span>}
                  {plan.pausable && <span className="badge badge-confirmed">Pausable</span>}
                  {plan.renewable && <span className="badge badge-active">Renewable</span>}
                  {!plan.closable && <span className="badge badge-cancelled">Non-closable</span>}
                </div>

                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
                  Min qty: {plan.min_quantity} · v{plan.version}
                </div>

                <button className="btn btn-secondary btn-sm w-full" onClick={() => openEdit(plan)} id={`edit-plan-${plan.id}`}>
                  ✎ Edit Plan
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Plan Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" style={{ maxWidth: 580 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{editPlan ? 'Edit Plan' : 'New Plan'}</span>
              <button className="btn-icon" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Plan Name *</label>
                    <input type="text" className="form-control" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Professional Monthly" required id="plan-name" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Billing Period *</label>
                    <select className="form-control" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} id="plan-period">
                      {PERIODS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Price (USD) *</label>
                    <input type="number" className="form-control" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} step="0.01" min="0" placeholder="0.00" required id="plan-price" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Min Quantity</label>
                    <input type="number" className="form-control" value={form.min_quantity} onChange={(e) => setForm({ ...form, min_quantity: e.target.value })} min="1" id="plan-min-qty" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Available From</label>
                    <input type="date" className="form-control" value={form.available_from} onChange={(e) => setForm({ ...form, available_from: e.target.value })} id="plan-avail-from" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Available Until</label>
                    <input type="date" className="form-control" value={form.available_until} onChange={(e) => setForm({ ...form, available_until: e.target.value })} id="plan-avail-until" />
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 8 }}>
                  {(['auto_close', 'closable', 'pausable', 'renewable'] as const).map((flag) => (
                    <label key={flag} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13.5 }}>
                      <input type="checkbox" checked={form[flag]} onChange={(e) => setForm({ ...form, [flag]: e.target.checked })} id={`plan-${flag}`} />
                      {flag.replace('_', ' ').charAt(0).toUpperCase() + flag.replace('_', ' ').slice(1)}
                    </label>
                  ))}
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submitting} id="save-plan-btn">
                  {submitting ? '…' : editPlan ? 'Save Changes' : 'Create Plan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
