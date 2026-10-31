import React, { useState, useEffect, useCallback } from 'react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';

interface TaxRule {
  id: string;
  name: string;
  rate: string;
  description?: string;
  is_active: boolean;
  created_at: string;
}

export default function TaxesPage() {
  const { user } = useAuth();
  const [taxes, setTaxes] = useState<TaxRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<TaxRule | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const isAdmin = user?.role === 'admin';

  const [form, setForm] = useState({
    name: '',
    rate: '',
    description: '',
    is_active: true,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/taxes');
      setTaxes(res.data.data || []);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to load taxes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditItem(null);
    setForm({ name: '', rate: '', description: '', is_active: true });
    setShowModal(true);
  };

  const openEdit = (t: TaxRule) => {
    setEditItem(t);
    setForm({
      name: t.name,
      rate: t.rate,
      description: t.description || '',
      is_active: t.is_active,
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const payload = {
        name: form.name,
        rate: parseFloat(form.rate),
        description: form.description || undefined,
        is_active: form.is_active,
      };

      if (editItem) {
        await api.patch(`/taxes/${editItem.id}`, payload);
      } else {
        await api.post('/taxes', payload);
      }
      setShowModal(false);
      load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to save tax rule');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Tax Rules</h1>
          <p className="page-subtitle">{taxes.length} jurisdiction tax definitions</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary btn-sm" onClick={load}>↻ Refresh</button>
          {isAdmin && (
            <button className="btn btn-primary btn-sm" onClick={openCreate} id="new-tax-btn">
              + New Tax Rule
            </button>
          )}
        </div>
      </div>

      {error && <div className="alert alert-error mb-4"><span>⚠</span> {error}</div>}

      <div className="card">
        <div className="table-container">
          {loading ? (
            <div className="loading-overlay"><div className="spinner" /></div>
          ) : taxes.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">💹</div>
              <div className="empty-title">No tax rules configured</div>
              <div className="empty-desc">Create your first tax rate for products and line items</div>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Jurisdiction / Rule Name</th>
                  <th>Rate</th>
                  <th>Description</th>
                  <th>Status</th>
                  {isAdmin && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {taxes.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <div className="font-bold text-primary">{t.name}</div>
                    </td>
                    <td className="amount font-bold text-secondary" style={{ fontSize: 15 }}>
                      {t.rate}%
                    </td>
                    <td className="text-sm text-muted">
                      {t.description || '—'}
                    </td>
                    <td>
                      <span className={`badge badge-${t.is_active ? 'active' : 'closed'}`}>
                        {t.is_active ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    {isAdmin && (
                      <td>
                        <button className="btn btn-sm btn-secondary" onClick={() => openEdit(t)}>
                          Edit
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{editItem ? 'Edit Tax Rule' : 'New Tax Rule'}</span>
              <button className="btn-icon" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Tax Name *</label>
                  <input
                    className="form-control"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                    placeholder="e.g. California State Tax"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Percentage Rate (%) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    className="form-control"
                    value={form.rate}
                    onChange={(e) => setForm({ ...form, rate: e.target.value })}
                    required
                    placeholder="e.g. 7.25"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Description (Optional)</label>
                  <textarea
                    className="form-control"
                    rows={2}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Jurisdiction notes or applicability criteria"
                  />
                </div>

                <div className="form-group">
                  <label className="flex items-center gap-2" style={{ cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={form.is_active}
                      onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                    />
                    <span>Active tax rule</span>
                  </label>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Saving…' : editItem ? 'Update Tax' : 'Create Tax'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

