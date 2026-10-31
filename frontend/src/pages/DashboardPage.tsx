import React, { useState, useEffect } from 'react';
import api from '../api/client';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';

interface DashboardStats {
  activeSubscriptions: number;
  mrr: number;
  invoicesThisMonth: number;
  overdueAmount: number;
  recentInvoices: any[];
  revenueData: Array<{ month: string; revenue: number }>;
}

const PALETTE = {
  primary: '#4f8ef7',
  secondary: '#a78bfa',
  success: '#34d399',
  warning: '#fbbf24',
  danger: '#f87171',
};

function fmtMoney(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents);
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

const StatCard = ({
  label, value, change, icon, color, gradient
}: {
  label: string;
  value: string;
  change?: string;
  icon: string;
  color: string;
  gradient: string;
}) => (
  <div className="stat-card" style={{ '--gradient': gradient } as React.CSSProperties}>
    <div className="stat-icon" style={{ background: `${color}18`, fontSize: 22 }}>
      {icon}
    </div>
    <div className="stat-content">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {change && (
        <div className={`stat-change ${change.startsWith('-') ? 'down' : 'up'}`}>
          {change.startsWith('-') ? '↓' : '↑'} {change}
        </div>
      )}
    </div>
  </div>
);

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    setLoading(true);
    try {
      // Fetch data from multiple endpoints concurrently
      const [subsRes, invRes] = await Promise.allSettled([
        api.get('/subscriptions?status=active&limit=5'),
        api.get('/billing/invoices?limit=5'),
      ]);

      // Build synthetic stats from available data
      const subs = subsRes.status === 'fulfilled' ? subsRes.value.data : { data: [], total: 0 };
      const invs = invRes.status === 'fulfilled' ? invRes.value.data : { data: [], total: 0 };

      const activeCount = subs.total ?? subs.data?.length ?? 0;
      const recentInvoices = (invs.data ?? []).slice(0, 5);

      // Compute overdue (status=confirmed && due_date < today)
      const today = new Date().toISOString().slice(0, 10);
      const overdueDue = recentInvoices
        .filter((i: any) => i.status === 'confirmed' && i.due_date < today)
        .reduce((sum: number, i: any) => sum + parseFloat(i.total || '0'), 0);

      // Revenue chart: synthesize from invoices
      const revenueMap: Record<string, number> = {};
      recentInvoices.forEach((inv: any) => {
        const m = (inv.invoice_date || inv.created_at || '').slice(0, 7);
        if (m) revenueMap[m] = (revenueMap[m] || 0) + parseFloat(inv.total || '0');
      });

      const revenueData = Object.entries(revenueMap)
        .sort()
        .map(([month, revenue]) => ({ month, revenue }));

      setStats({
        activeSubscriptions: activeCount,
        mrr: revenueData.reduce((s, d) => s + d.revenue, 0),
        invoicesThisMonth: invs.total ?? invs.data?.length ?? 0,
        overdueAmount: overdueDue,
        recentInvoices,
        revenueData,
      });
    } catch {
      // Show empty dashboard on error
      setStats({
        activeSubscriptions: 0,
        mrr: 0,
        invoicesThisMonth: 0,
        overdueAmount: 0,
        recentInvoices: [],
        revenueData: [],
      });
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="loading-overlay">
        <div className="spinner" />
        <span>Loading dashboard…</span>
      </div>
    );
  }

  return (
    <div>
      {/* Welcome */}
      <div className="welcome-banner">
        <div className="welcome-icon">⬡</div>
        <div>
          <div className="welcome-title">Brightloop Billing Dashboard</div>
          <div className="welcome-sub">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </div>
        <div className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={loadDashboard} id="refresh-dashboard">
          ↻ Refresh
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid-4 mb-6">
        <StatCard
          label="Active Subscriptions"
          value={String(stats?.activeSubscriptions || 0)}
          icon="♻"
          color={PALETTE.primary}
          gradient="linear-gradient(135deg, #4f8ef7, #3b77e8)"
        />
        <StatCard
          label="Revenue (Invoiced)"
          value={fmtMoney(stats?.mrr || 0)}
          icon="💰"
          color={PALETTE.success}
          gradient="linear-gradient(135deg, #34d399, #059669)"
        />
        <StatCard
          label="Invoices This Month"
          value={String(stats?.invoicesThisMonth || 0)}
          icon="🧾"
          color={PALETTE.secondary}
          gradient="linear-gradient(135deg, #a78bfa, #7c3aed)"
        />
        <StatCard
          label="Overdue Amount"
          value={fmtMoney(stats?.overdueAmount || 0)}
          icon="⚠"
          color={PALETTE.danger}
          gradient="linear-gradient(135deg, #f87171, #dc2626)"
        />
      </div>

      {/* Charts & Recent */}
      <div className="grid-2">
        {/* Revenue Chart */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Revenue Trend</span>
          </div>
          <div className="card-body">
            {(stats?.revenueData?.length ?? 0) > 0 ? (
              <div className="chart-wrapper">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={stats!.revenueData}>
                    <defs>
                      <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={PALETTE.primary} stopOpacity={0.25} />
                        <stop offset="95%" stopColor={PALETTE.primary} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      dataKey="month"
                      tick={{ fill: '#4d6380', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: '#4d6380', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => `$${v}`}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border-glass)',
                        borderRadius: 8,
                        color: 'var(--text-primary)',
                        fontSize: 13,
                      }}
                      formatter={(v: number) => [fmtMoney(v), 'Revenue']}
                    />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      stroke={PALETTE.primary}
                      strokeWidth={2}
                      fill="url(#colorRev)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-icon">📊</div>
                <div className="empty-title">No revenue data yet</div>
                <div className="empty-desc">Run your first billing cycle to see trends</div>
              </div>
            )}
          </div>
        </div>

        {/* Recent Invoices */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Recent Invoices</span>
            <a href="/invoices" className="btn btn-secondary btn-sm" style={{ textDecoration: 'none' }}>
              View all →
            </a>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {(stats?.recentInvoices?.length ?? 0) === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🧾</div>
                <div className="empty-title">No invoices yet</div>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Invoice #</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {stats!.recentInvoices.map((inv: any) => (
                    <tr key={inv.id}>
                      <td className="text-primary" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                        {inv.invoice_number}
                      </td>
                      <td className="amount">{fmtMoney(parseFloat(inv.total || '0'))}</td>
                      <td><StatusBadge status={inv.status} /></td>
                      <td className="text-sm text-muted">
                        {(inv.invoice_date || inv.created_at || '').slice(0, 10)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
