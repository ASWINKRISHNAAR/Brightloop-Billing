import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';

export default function RegisterPage() {
  const { refetchUser } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/auth/register', {
        name: form.name,
        email: form.email,
        password: form.password,
      });
      const token = res.data.data?.accessToken || res.data.accessToken;
      if (token) localStorage.setItem('accessToken', token);
      await refetchUser();
      navigate('/dashboard', { replace: true });
    } catch (err: any) {
      const fieldErrors = err?.response?.data?.errors;
      if (fieldErrors && typeof fieldErrors === 'object') {
        const msgs = Object.values(fieldErrors).flat();
        setError(msgs.join(' • '));
      } else {
        setError(err?.response?.data?.detail || 'Registration failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 0 }}>
        <div style={{ position: 'absolute', width: 600, height: 600, borderRadius: '50%', background: 'radial-gradient(circle, rgba(167,139,250,0.12) 0%, transparent 70%)', top: '-100px', right: '-100px' }} />
      </div>
      <div className="auth-card" style={{ position: 'relative', zIndex: 1 }}>
        <div className="auth-logo">
          <div className="auth-logo-icon">B</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>Brightloop</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', letterSpacing: '0.5px' }}>BILLING PLATFORM</div>
          </div>
        </div>

        <h1 className="auth-title">Create account</h1>
        <p className="auth-subtitle">Join Brightloop Billing to manage subscriptions</p>

        <form className="auth-form" onSubmit={handleSubmit} style={{ marginTop: 28 }} id="register-form">
          {error && <div className="alert alert-error"><span>⚠</span> {error}</div>}

          <div className="form-group">
            <label className="form-label">Full name</label>
            <input id="reg-name" type="text" className="form-control" value={form.name} onChange={set('name')} placeholder="Jane Smith" required autoFocus />
          </div>
          <div className="form-group">
            <label className="form-label">Email address</label>
            <input id="reg-email" type="email" className="form-control" value={form.email} onChange={set('email')} placeholder="jane@company.com" required />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input id="reg-password" type="password" className="form-control" value={form.password} onChange={set('password')} placeholder="Min 9 chars, upper, lower, special" required />
            <div className="text-sm text-muted" style={{ marginTop: 4, fontSize: 11.5 }}>
              Must be at least 9 characters with uppercase, lowercase, and a special character (e.g. <code>MyPass123!</code>).
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Confirm password</label>
            <input id="reg-confirm-password" type="password" className="form-control" value={form.confirmPassword} onChange={set('confirmPassword')} placeholder="Repeat password" required />
          </div>

          <button type="submit" className="btn btn-primary w-full" id="register-submit" disabled={loading} style={{ justifyContent: 'center', padding: '12px' }}>
            {loading ? <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Creating account…</> : 'Create account →'}
          </button>
        </form>

        <div className="auth-footer">
          Already have an account? <Link to="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
