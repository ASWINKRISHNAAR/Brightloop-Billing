import React, { useState, useEffect, useCallback } from 'react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';

interface CatalogItem {
  id: string;
  name: string;
  base_price: string;
  description?: string;
  is_active: boolean;
  is_archived: boolean;
  variants?: Variant[];
}

interface Variant {
  id: string;
  attribute: string;
  value: string;
  extra_price: string;
  is_active: boolean;
}

function fmtMoney(v: string | number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(v));
}

export default function CatalogPage() {
  const { user } = useAuth();
  const [products, setProducts] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editProduct, setEditProduct] = useState<CatalogItem | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const isAdmin = user?.role === 'admin' || user?.role === 'staff';

  // Form state
  const [name, setName] = useState('');
  const [basePrice, setBasePrice] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/products?includeVariants=true&includeArchived=false');
      setProducts(res.data.data || res.data || []);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to load catalog');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditProduct(null);
    setName(''); setBasePrice(''); setDescription('');
    setShowModal(true);
  };

  const openEdit = (p: CatalogItem) => {
    setEditProduct(p);
    setName(p.name); setBasePrice(p.base_price); setDescription(p.description || '');
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      if (editProduct) {
        await api.put(`/products/${editProduct.id}`, { name, base_price: parseFloat(basePrice), description });
      } else {
        await api.post('/products', { name, base_price: parseFloat(basePrice), description });
      }
      setShowModal(false);
      load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to save product');
    } finally {
      setSubmitting(false);
    }
  };

  const archive = async (id: string) => {
    if (!confirm('Archive this product? It will be hidden from new subscriptions.')) return;
    try {
      await api.patch(`/products/${id}/archive`);
      load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to archive');
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Product Catalog</h1>
          <p className="page-subtitle">Manage products and variants</p>
        </div>
        {isAdmin && (
          <button className="btn btn-primary" onClick={openCreate} id="add-product-btn">
            + Add Product
          </button>
        )}
      </div>

      {error && <div className="alert alert-error mb-4"><span>⚠</span> {error}</div>}

      {loading ? (
        <div className="loading-overlay"><div className="spinner" /></div>
      ) : products.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📦</div>
          <div className="empty-title">No products yet</div>
          <div className="empty-desc">Add your first product to the catalog</div>
          {isAdmin && <button className="btn btn-primary mt-4" onClick={openCreate}>+ Add Product</button>}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {products.map((p) => (
            <div className="card" key={p.id}>
              <div
                style={{ padding: '18px 24px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 16 }}
                onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
              >
                <div style={{
                  width: 42, height: 42, borderRadius: 10,
                  background: 'linear-gradient(135deg, rgba(79,142,247,0.15), rgba(167,139,250,0.10))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0,
                }}>
                  📦
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}</div>
                  {p.description && (
                    <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>{p.description}</div>
                  )}
                </div>
                <div style={{ textAlign: 'right', marginRight: 16 }}>
                  <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-primary)', fontWeight: 700 }}>
                    {fmtMoney(p.base_price)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>base price</div>
                </div>
                <span className={`badge ${p.is_active ? 'badge-active' : 'badge-closed'}`}>
                  {p.is_active ? 'Active' : 'Inactive'}
                </span>
                {isAdmin && (
                  <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-sm btn-secondary" onClick={() => openEdit(p)}>Edit</button>
                    <button className="btn btn-sm btn-danger" onClick={() => archive(p.id)}>Archive</button>
                  </div>
                )}
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                  {expandedId === p.id ? '▲' : '▼'}
                </span>
              </div>

              {expandedId === p.id && (
                <div style={{ borderTop: '1px solid var(--border-glass)', padding: '16px 24px' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10, letterSpacing: 0.5 }}>
                    VARIANTS ({(p.variants || []).length})
                  </div>
                  {(p.variants || []).length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No variants — base price applies</div>
                  ) : (
                    <table>
                      <thead>
                        <tr>
                          <th>Attribute</th>
                          <th>Value</th>
                          <th className="text-right">Extra Price</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(p.variants || []).map((v) => (
                          <tr key={v.id}>
                            <td className="text-secondary">{v.attribute}</td>
                            <td className="text-primary">{v.value}</td>
                            <td className="amount text-right">+{fmtMoney(v.extra_price)}</td>
                            <td><span className={`badge ${v.is_active ? 'badge-active' : 'badge-closed'}`}>{v.is_active ? 'Active' : 'Off'}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Product Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{editProduct ? 'Edit Product' : 'Add Product'}</span>
              <button className="btn-icon" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Product Name *</label>
                  <input
                    type="text"
                    className="form-control"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Cloud Hosting"
                    required
                    id="product-name"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Base Price (USD) *</label>
                  <input
                    type="number"
                    className="form-control"
                    value={basePrice}
                    onChange={(e) => setBasePrice(e.target.value)}
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    required
                    id="product-base-price"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Description</label>
                  <textarea
                    className="form-control"
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Short description of this product"
                    id="product-description"
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submitting} id="save-product-btn">
                  {submitting ? '…' : editProduct ? 'Save Changes' : 'Create Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
