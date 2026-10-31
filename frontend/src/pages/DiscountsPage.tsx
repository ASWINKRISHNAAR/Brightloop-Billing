import React, { useState, useEffect, useCallback } from 'react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';

interface Discount {
  id: string;
  name: string;
  code?: string;
  type: 'fixed' | 'percentage';
  value: string;
  scope: 'product' | 'subscription';
  min_purchase?: string;
  min_quantity?: number;
  start_date: string;
  end_date: string;
  usage_limit?: number;
  used_count: number;
  is_active: boolean;
}

function fmtDate(d: string) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function DiscountsPage() {
  const { user } = useAuth();
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<Discount | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const isAdmin = user?.role === 'admin';

  const [form, setForm] = useState({
    name: '',
    code: '',
    type: 'percentage' as 'fixed' | 'percentage',
    value: '',
    scope: 'subscription' as 'product' | 'subscription',
    min_purchase: '0',
    min_quantity: '0',
    start_date: new Date().toISOString().slice(0, 10),
    end_date: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
    usage_limit: '',
    is_active: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/discounts');
      setDiscounts(res.data.data || []);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to load discounts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditItem(null);
    setForm({
      name: '',
      code: '',
      type: 'percentage',
      value: '',
      scope: 'subscription',
      min_purchase: '0',
      min_quantity: '0',
      start_date: new Date().toISOString().slice(0, 10),
      end_date: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
      usage_limit: '',
      is_active: true,
    });
    setShowModal(true);
  };

  const openEdit = (d: Discount) => {
    setEditItem(d);
    setForm({
      name: d.name,
      code: d.code || '',
      type: d.type,
      value: d.value,
      scope: d.scope,
      min_purchase: d.min_purchase || '0',
      min_quantity: String(d.min_quantity || 0),
      start_date: d.start_date.slice(0, 10),
      end_date: d.end_date.slice(0, 10),
      usage_limit: d.usage_limit ? String(d.usage_limit) : '',
      is_active: d.is_active,
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const payload: any = {
        name: form.name,
        code: form.code || undefined,
        type: form.type,
        value: parseFloat(form.value),
        scope: form.scope,
        min_purchase: parseFloat(form.min_purchase) || 0,
        min_quantity: parseInt(form.min_quantity) || 0,
        start_date: form.start_date,
        end_date: form.end_date,
        usage_limit: form.usage_limit ? parseInt(form.usage_limit) : undefined,
        is_active: form.is_active,
      };

      if (editItem) {
        await api.patch(`/discounts/${editItem.id}`, payload);
      } else {
        await api.post('/discounts', payload);
      }
      setShowModal(false);
      load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to save discount');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this discount?')) return;
    try {
      await api.delete(`/discounts/${id}`);
      load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to delete discount');
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Discounts & Promotions</h1>
          <p className="page-subtitle">{discounts.length} promotional rules active</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary btn-sm" onClick={load}>↻ Refresh</button>
          {isAdmin && (
            <button className="btn btn-primary btn-sm" onClick={openCreate} id="new-discount-btn">
              + New Discount
            </button>
          )}
        </div>
      </div>

      {error && <div className="alert alert-error mb-4"><span>⚠</span> {error}</div>}

      <div className="card">
        <div className="table-container">
          {loading ? (
            <div className="loading-overlay"><div className="spinner" /></div>
          ) : discounts.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🏷</div>
              <div className="empty-title">No discounts configured</div>
              <div className="empty-desc">Create your first percentage or fixed discount coupon</div>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name & Code</th>
                  <th>Type</th>
                  <th>Value</th>
                  <th>Scope</th>
                  <th>Validity Window</th>
                  <th>Redemptions</th>
                  <th>Status</th>
                  {isAdmin && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {discounts.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <div className="font-bold text-primary">{d.name}</div>
                      {d.code && (
                        <div className="font-mono text-sm text-secondary" style={{ marginTop: 2 }}>
                          {d.code}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="badge badge-secondary" style={{ textTransform: 'uppercase', fontSize: 11 }}>
                        {d.type}
                      </span>
                    </td>
                    <td className="amount font-bold">
                      {d.type === 'percentage' ? `${d.value}%` : `$${d.value}`}
                    </td>
                    <td className="text-sm text-muted" style={{ textTransform: 'capitalize' }}>
                      {d.scope}
                    </td>
                    <td className="text-sm text-muted">
                      {fmtDate(d.start_date)} → {fmtDate(d.end_date)}
                    </td>
                    <td className="font-mono text-sm">
                      {d.used_count} {d.usage_limit ? `/ ${d.usage_limit}` : 'uses'}
                    </td>
                    <td>
                      <span className={`badge badge-${d.is_active ? 'active' : 'closed'}`}>
                        {d.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {isAdmin && (
                      <td>
                        <div className="flex gap-2">
                          <button className="btn btn-sm btn-secondary" onClick={() => openEdit(d)}>Edit</button>
                          <button className="btn btn-sm btn-danger" onClick={() => handleDelete(d.id)}>Delete</button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{editItem ? 'Edit Discount' : 'New Discount Rule'}</span>
              <button className="btn-icon" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="grid-2 gap-3">
                  <div className="form-group">
                    <label className="form-label">Discount Name *</label>
                    <input
                      className="form-control"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      required
                      placeholder="e.g. Summer Promo"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Promo Code (Optional)</label>
                    <input
                      className="form-control font-mono"
                      value={form.code}
                      onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                      placeholder="e.g. SUMMER26"
                    />
                  </div>
                </div>

                <div className="grid-2 gap-3">
                  <div className="form-group">
                    <label className="form-label">Type</label>
                    <select
                      className="form-control"
                      value={form.type}
                      onChange={(e) => setForm({ ...form, type: e.target.value as any })}
                    >
                      <option value="percentage">Percentage (%)</option>
                      <option value="fixed">Fixed Amount ($)</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Discount Value *</label>
                    <input
                      type="number"
                      step="0.01"
                      className="form-control"
                      value={form.value}
                      onChange={(e) => setForm({ ...form, value: e.target.value })}
                      required
                      placeholder={form.type === 'percentage' ? 'e.g. 15' : 'e.g. 25.00'}
                    />
                  </div>
                </div>

                <div className="grid-2 gap-3">
                  <div className="form-group">
                    <label className="form-label">Scope</label>
                    <select
                      className="form-control"
                      value={form.scope}
                      onChange={(e) => setForm({ ...form, scope: e.target.value as any })}
                    >
                      <option value="subscription">Subscription (Whole Order)</option>
                      <option value="product">Line Items (Per Product)</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Usage Limit (Blank = Unlimited)</label>
                    <input
                      type="number"
                      className="form-control"
                      value={form.usage_limit}
                      onChange={(e) => setForm({ ...form, usage_limit: e.target.value })}
                      placeholder="Unlimited"
                    />
                  </div>
                </div>

                <div className="grid-2 gap-3">
                  <div className="form-group">
                    <label className="form-label">Start Date *</label>
                    <input
                      type="date"
                      className="form-control"
                      value={form.start_date}
                      onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">End Date *</label>
                    <input
                      type="date"
                      className="form-control"
                      value={form.end_date}
                      onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div className="form-group" style={{ marginTop: 12 }}>
                  <label className="flex items-center gap-2" style={{ cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={form.is_active}
                      onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                    />
                    <span>Active and redeemable</span>
                  </label>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Saving…' : editItem ? 'Update Discount' : 'Create Discount'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

