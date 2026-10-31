import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const doLogin = async (emailVal: string, passVal: string) => {
    setError('');
    setLoading(true);
    try {
      await login(emailVal, passVal);
      navigate('/dashboard', { replace: true });
    } catch (err: any) {
      const data = err?.response?.data;
      const msg = data?.detail || data?.message || 'Invalid email or password.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await doLogin(email, password);
  };

  const fillAndLogin = async () => {
    const adminEmail = 'admin@brightloop.io';
    const adminPass = 'Admin@1234!';
    setEmail(adminEmail);
    setPassword(adminPass);
    await doLogin(adminEmail, adminPass);
  };

  return (
    <div className="auth-container">
      {/* Background glows */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 0
      }}>
        <div style={{
          position: 'absolute', width: 600, height: 600, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(79,142,247,0.12) 0%, transparent 70%)',
          top: '-100px', left: '-100px',
        }} />
        <div style={{
          position: 'absolute', width: 500, height: 500, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(167,139,250,0.10) 0%, transparent 70%)',
          bottom: '-100px', right: '-100px',
        }} />
      </div>

      <div className="auth-card" style={{ position: 'relative', zIndex: 1 }}>
        <div className="auth-logo">
          <div className="auth-logo-icon">B</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>Brightloop</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', letterSpacing: '0.5px' }}>BILLING PLATFORM</div>
          </div>
        </div>

        <h1 className="auth-title">Welcome back</h1>
        <p className="auth-subtitle">Sign in to manage subscriptions & billing</p>

        <form className="auth-form" onSubmit={handleSubmit} style={{ marginTop: 28 }} id="login-form">
          {error && (
            <div className="alert alert-error">
              <span>⚠</span> {error}
            </div>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              className="form-control"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              autoFocus
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className="form-control"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />
          </div>

          <div style={{ textAlign: 'right' }}>
            <Link to="/forgot-password" style={{ fontSize: 13, color: 'var(--accent-primary)', textDecoration: 'none' }}>
              Forgot password?
            </Link>
          </div>

          <button
            type="submit"
            className="btn btn-primary w-full"
            id="login-submit"
            disabled={loading}
            style={{ justifyContent: 'center', padding: '12px' }}
          >
            {loading ? (
              <>
                <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
                Signing in…
              </>
            ) : (
              'Sign in →'
            )}
          </button>
        </form>

        <div className="auth-footer">
          Don't have an account?{' '}
          <Link to="/register">Create account</Link>
        </div>

        {/* Demo credentials hint */}
        <div style={{
          marginTop: 24,
          padding: '12px 14px',
          background: 'rgba(79,142,247,0.06)',
          border: '1px solid rgba(79,142,247,0.12)',
          borderRadius: 'var(--radius-md)',
          fontSize: 12,
          color: 'var(--text-muted)',
          lineHeight: 1.7,
        }}>
          <div className="flex justify-between items-center mb-1">
            <strong style={{ color: 'var(--text-secondary)' }}>Demo credentials</strong>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              style={{ fontSize: 11, padding: '2px 8px' }}
              onClick={fillAndLogin}
            >
              Fill & Login
            </button>
          </div>
          Admin: <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-primary)' }}>admin@brightloop.io</code> / <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-primary)' }}>Admin@1234!</code>
        </div>
      </div>
    </div>
  );
}
