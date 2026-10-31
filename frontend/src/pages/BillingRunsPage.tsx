import React, { useState, useEffect, useCallback } from 'react';
import api from '../api/client';

interface BillingRun {
  id: string;
  run_date: string;
  status: string;
  created_count: number;
  skipped_count: number;
  failed_count: number;
  started_at: string;
  completed_at?: string;
  error_logs?: Array<{ subscriptionId: string; error: string }>;
}

function fmtDate(d: string) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function duration(start: string, end?: string) {
  if (!end) return '—';
  const s = new Date(start), e = new Date(end);
  const ms = e.getTime() - s.getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function BillingRunsPage() {
  const [runs, setRuns] = useState<BillingRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));
  const [autoCloseDate, setAutoCloseDate] = useState(new Date().toISOString().slice(0, 10));
  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/billing/runs?limit=20');
      setRuns(res.data.data || []);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to load billing runs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const triggerBillingRun = async () => {
    setRunning(true);
    setError('');
    setSuccess('');
    try {
      const res = await api.post('/billing/run', { asOfDate });
      const { createdCount, skippedCount, failedCount } = res.data;
      setSuccess(
        `✓ Billing run complete: ${createdCount} invoices created, ${skippedCount} skipped, ${failedCount} failed.`
      );
      load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Billing run failed');
    } finally {
      setRunning(false);
    }
  };

  const triggerAutoClose = async () => {
    setRunning(true);
    setError('');
    setSuccess('');
    try {
      const res = await api.post('/billing/auto-close', { asOfDate: autoCloseDate });
      setSuccess(`✓ Auto-close complete: ${res.data.closedCount || 0} subscriptions closed.`);
      load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Auto-close failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Billing Runs</h1>
          <p className="page-subtitle">Trigger and monitor automated billing cycles</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={load}>↻ Refresh</button>
      </div>

      {error && <div className="alert alert-error mb-4"><span>⚠</span> {error}</div>}
      {success && <div className="alert alert-success mb-4"><span>✓</span> {success}</div>}

      {/* Control Panel */}
      <div className="grid-2 mb-6">
        <div className="card">
          <div className="card-header">
            <span className="card-title">⚡ Run Billing Cycle</span>
          </div>
          <div className="card-body">
            <p className="text-secondary" style={{ fontSize: 13.5, marginBottom: 16 }}>
              Process all active subscriptions due on or before the selected date.
              Idempotent — safe to run multiple times.
            </p>
            <div className="form-group mb-4">
              <label className="form-label">As-of Date</label>
              <input
                type="date"
                className="form-control"
                value={asOfDate}
                onChange={(e) => setAsOfDate(e.target.value)}
                id="billing-run-date"
              />
            </div>
            <button
              className="btn btn-primary w-full"
              style={{ justifyContent: 'center' }}
              onClick={triggerBillingRun}
              disabled={running}
              id="trigger-billing-run"
            >
              {running ? (
                <><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Running…</>
              ) : (
                '▶ Trigger Billing Run'
              )}
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">🔒 Auto-Close Expired Subscriptions</span>
          </div>
          <div className="card-body">
            <p className="text-secondary" style={{ fontSize: 13.5, marginBottom: 16 }}>
              Close all active subscriptions where the expiry date has passed and the plan has auto-close enabled.
            </p>
            <div className="form-group mb-4">
              <label className="form-label">As-of Date</label>
              <input
                type="date"
                className="form-control"
                value={autoCloseDate}
                onChange={(e) => setAutoCloseDate(e.target.value)}
                id="auto-close-date"
              />
            </div>
            <button
              className="btn btn-secondary w-full"
              style={{ justifyContent: 'center' }}
              onClick={triggerAutoClose}
              disabled={running}
              id="trigger-auto-close"
            >
              {running ? '…' : '🔒 Run Auto-Close'}
            </button>
          </div>
        </div>
      </div>

      {/* History */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Run History</span>
          <span className="text-muted text-sm">{runs.length} recent runs</span>
        </div>
        <div className="table-container">
          {loading ? (
            <div className="loading-overlay"><div className="spinner" /></div>
          ) : runs.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">⚡</div>
              <div className="empty-title">No billing runs yet</div>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Run Date</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Skipped</th>
                  <th>Failed</th>
                  <th>Duration</th>
                  <th>Started</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <React.Fragment key={run.id}>
                    <tr
                      onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td className="text-primary font-mono" style={{ fontSize: 12.5 }}>
                        {run.run_date?.slice(0, 10) || '—'}
                      </td>
                      <td>
                        <span className={`badge badge-${run.status === 'completed' ? 'paid' : run.status === 'running' ? 'confirmed' : 'cancelled'}`}>
                          {run.status}
                        </span>
                      </td>
                      <td style={{ color: 'var(--accent-success)', fontWeight: 600 }}>{run.created_count}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{run.skipped_count}</td>
                      <td style={{ color: run.failed_count > 0 ? 'var(--accent-danger)' : 'var(--text-muted)', fontWeight: run.failed_count > 0 ? 600 : 400 }}>
                        {run.failed_count}
                      </td>
                      <td className="text-sm text-muted">{duration(run.started_at, run.completed_at)}</td>
                      <td className="text-sm text-muted">{fmtDate(run.started_at)}</td>
                    </tr>
                    {expandedRun === run.id && run.error_logs && run.error_logs.length > 0 && (
                      <tr>
                        <td colSpan={7} style={{ background: 'rgba(248,113,113,0.04)', padding: '12px 16px' }}>
                          <div style={{ fontSize: 12, color: 'var(--accent-danger)', marginBottom: 6, fontWeight: 600 }}>
                            Failed Subscriptions:
                          </div>
                          {run.error_logs.map((e, i) => (
                            <div key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: 4 }}>
                              <strong>{e.subscriptionId}</strong>: {e.error}
                            </div>
                          ))}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
