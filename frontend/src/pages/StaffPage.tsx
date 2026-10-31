import React, { useState, useEffect, useCallback } from 'react';
import api from '../api/client';

interface StaffUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'staff';
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt?: string;
  createdAt: string;
}

function fmtDate(d?: string) {
  if (!d) return 'Never';
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function StaffPage() {
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    name: '',
    email: '',
    role: 'staff' as 'admin' | 'staff',
    password: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/staff');
      setStaff(res.data.data || []);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to load staff members');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleStatus = async (user: StaffUser) => {
    try {
      await api.patch(`/staff/${user.id}`, { isActive: !user.isActive });
      load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to update staff status');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await api.post('/staff', form);
      setShowModal(false);
      setForm({ name: '', email: '', role: 'staff', password: '' });
      load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to create staff member');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Staff & User Management</h1>
          <p className="page-subtitle">{staff.length} administrative team members</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary btn-sm" onClick={load}>↻ Refresh</button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)} id="new-staff-btn">
            + New Staff Member
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error mb-4"><span>⚠</span> {error}</div>}

      <div className="card">
        <div className="table-container">
          {loading ? (
            <div className="loading-overlay"><div className="spinner" /></div>
          ) : staff.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🧑‍💼</div>
              <div className="empty-title">No staff accounts found</div>
              <div className="empty-desc">Create your team members with role-based access control</div>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last Login</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="font-bold text-primary">{u.name}</div>
                    </td>
                    <td className="font-mono text-sm text-secondary">
                      {u.email}
                    </td>
                    <td>
                      <span className={`badge badge-${u.role === 'admin' ? 'active' : 'secondary'}`}>
                        {u.role.toUpperCase()}
                      </span>
                    </td>
                    <td>
                      <span className={`badge badge-${u.isActive ? 'active' : 'closed'}`}>
                        {u.isActive ? 'Active' : 'Suspended'}
                      </span>
                    </td>
                    <td className="text-sm text-muted">
                      {fmtDate(u.lastLoginAt)}
                    </td>
                    <td className="text-sm text-muted">
                      {fmtDate(u.createdAt)}
                    </td>
                    <td>
                      <button
                        className={`btn btn-sm ${u.isActive ? 'btn-danger' : 'btn-success'}`}
                        onClick={() => toggleStatus(u)}
                      >
                        {u.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
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
              <span className="modal-title">Create New Staff User</span>
              <button className="btn-icon" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Full Name *</label>
                  <input
                    className="form-control"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                    placeholder="e.g. Sarah Jenkins"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Email Address *</label>
                  <input
                    type="email"
                    className="form-control"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    required
                    placeholder="sarah@brightloop.io"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Role *</label>
                  <select
                    className="form-control"
                    value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value as any })}
                  >
                    <option value="staff">Staff (Billing & Customer Ops)</option>
                    <option value="admin">Administrator (Full Access)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Temporary Password *</label>
                  <input
                    type="password"
                    className="form-control"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    required
                    minLength={8}
                    placeholder="Min 8 chars with uppercase, lowercase & symbol"
                  />
                  <div className="text-sm text-muted" style={{ marginTop: 4 }}>
                    User will be flagged with <code>must_change_password=true</code> on initial sign-in.
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={submitting}>
                  {submitting ? 'Creating…' : 'Create Staff Member'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

