import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';

interface Invoice {
  id: string;
  invoice_number: string;
  subscription_id: string | null;
  subscription_number?: string | null;
  status: string;
  invoice_date: string;
  total: string;
}

interface SubscriptionGroup {
  subscription_id: string | null;
  subscription_number: string | null;
  invoiceCount: number;
  totalBilled: number;
  latestStatus: string;
  earliestDate: string;
  latestDate: string;
}

function fmtMoney(v: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);
}

function fmtDate(d: string) {
  if (!d) return '—';
  const date = new Date(d);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

export default function MySubscriptionsPage() {
  const [groups, setGroups] = useState<SubscriptionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        // Load all invoices (customer gets auto-filtered to their own)
        const res = await api.get('/billing/invoices?limit=200&offset=0');
        const invoices: Invoice[] = res.data.data || [];

        // Group by subscription_id
        const map = new Map<string, SubscriptionGroup>();

        invoices.forEach((inv) => {
          const key = inv.subscription_id ?? '__none__';
          if (!map.has(key)) {
            map.set(key, {
              subscription_id: inv.subscription_id,
              subscription_number: inv.subscription_number ?? null,
              invoiceCount: 0,
              totalBilled: 0,
              latestStatus: inv.status,
              earliestDate: inv.invoice_date,
              latestDate: inv.invoice_date,
            });
          }
          const group = map.get(key)!;
          group.invoiceCount += 1;
          group.totalBilled += Number(inv.total);
          // Track most recent invoice date for latest status
          if (inv.invoice_date > group.latestDate) {
            group.latestDate = inv.invoice_date;
            group.latestStatus = inv.status;
          }
          if (inv.invoice_date < group.earliestDate) {
            group.earliestDate = inv.invoice_date;
          }
        });

        setGroups(Array.from(map.values()));
      } catch (e: any) {
        setError(e?.response?.data?.detail || 'Failed to load subscriptions');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Subscriptions</h1>
          <p className="page-subtitle">Your active and past subscription summaries</p>
        </div>
      </div>

      {error && (
        <div className="alert alert-error mb-4">
          <span>⚠</span> {error}
        </div>
      )}

      {loading ? (
        <div className="loading-overlay">
          <div className="spinner" />
        </div>
      ) : groups.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📄</div>
          <div className="empty-title">No subscriptions found</div>
          <div className="empty-desc">You don't have any invoices associated with subscriptions yet.</div>
        </div>
      ) : (
        <div className="grid-2 gap-4">
          {groups.map((g) => {
            const subLabel = g.subscription_number ?? (g.subscription_id ? g.subscription_id.slice(0, 8) + '…' : 'Subscription');
            return (
              <div className="card" key={g.subscription_id ?? '__none__'}>
                <div className="card-header">
                  <span className="card-title" style={{ fontFamily: 'monospace', fontSize: 14 }}>
                    📄 {subLabel}
                  </span>
                  <span className="badge" style={{ fontSize: 11 }}>
                    {g.invoiceCount} invoice{g.invoiceCount !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="card-body">
                  <div className="grid-2 gap-4" style={{ marginBottom: 16 }}>
                    <div>
                      <div className="text-muted text-sm mb-1">Total Billed</div>
                      <div className="amount font-bold" style={{ fontSize: 18, color: 'var(--accent-primary)' }}>
                        {fmtMoney(g.totalBilled)}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted text-sm mb-1">Latest Status</div>
                      <StatusBadge status={g.latestStatus} />
                    </div>
                    <div>
                      <div className="text-muted text-sm mb-1">First Invoice</div>
                      <div className="text-sm">{fmtDate(g.earliestDate)}</div>
                    </div>
                    <div>
                      <div className="text-muted text-sm mb-1">Latest Invoice</div>
                      <div className="text-sm">{fmtDate(g.latestDate)}</div>
                    </div>
                  </div>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => navigate('/invoices')}
                  >
                    🧾 View Invoices
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
