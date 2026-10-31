import React, { useState, useEffect, useCallback } from 'react';
import api from '../api/client';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend
} from 'recharts';

interface SummaryData {
  activeSubscriptions: number;
  mrr: number;
  totalRevenueCollected: number;
  totalOutstanding: number;
  overdueCount: number;
  monthlyRevenue: Array<{
    month: string;
    total_invoices: number;
    billed_revenue: string | number;
    collected_revenue: string | number;
    outstanding_revenue: string | number;
  }>;
  overdueInvoices: Array<{
    id: string;
    invoice_number: string;
    customer_name: string;
    customer_email: string;
    due_date: string;
    days_overdue: number;
    total: string;
    amount_paid: string;
    outstanding_amount: string;
  }>;
}

function fmtMoney(cents: number | string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(cents));
}

function fmtDate(d: string) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function ReportsPage() {
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/billing/reports/summary');
      setData(res.data.data);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to load financial reports');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const chartData = (data?.monthlyRevenue || []).map((m) => ({
    month: m.month,
    Billed: parseFloat(String(m.billed_revenue)),
    Collected: parseFloat(String(m.collected_revenue)),
    Outstanding: parseFloat(String(m.outstanding_revenue)),
  }));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Financial & Revenue Analytics</h1>
          <p className="page-subtitle">Real-time revenue realization, aging, and cash flow</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={load}>↻ Refresh</button>
      </div>

      {error && <div className="alert alert-error mb-4"><span>⚠</span> {error}</div>}

      {/* KPI Cards */}
      <div className="stats-grid mb-6">
        <div className="stat-card" style={{ '--gradient': 'linear-gradient(135deg, #4f8ef7, #2563eb)' } as any}>
          <div className="stat-icon" style={{ background: '#4f8ef718' }}>⬡</div>
          <div className="stat-content">
            <div className="stat-label">Monthly Recurring Revenue</div>
            <div className="stat-value">{fmtMoney(data?.mrr || 0)}</div>
            <div className="text-sm text-muted">Normalized active subscriptions</div>
          </div>
        </div>

        <div className="stat-card" style={{ '--gradient': 'linear-gradient(135deg, #34d399, #059669)' } as any}>
          <div className="stat-icon" style={{ background: '#34d39918' }}>💵</div>
          <div className="stat-content">
            <div className="stat-label">Total Cash Collected</div>
            <div className="stat-value text-success">{fmtMoney(data?.totalRevenueCollected || 0)}</div>
            <div className="text-sm text-muted">Settled via verified payments</div>
          </div>
        </div>

        <div className="stat-card" style={{ '--gradient': 'linear-gradient(135deg, #fbbf24, #d97706)' } as any}>
          <div className="stat-icon" style={{ background: '#fbbf2418' }}>⏳</div>
          <div className="stat-content">
            <div className="stat-label">Outstanding Receivables</div>
            <div className="stat-value text-warning">{fmtMoney(data?.totalOutstanding || 0)}</div>
            <div className="text-sm text-muted">Confirmed invoices awaiting payment</div>
          </div>
        </div>

        <div className="stat-card" style={{ '--gradient': 'linear-gradient(135deg, #f87171, #dc2626)' } as any}>
          <div className="stat-icon" style={{ background: '#f8717118' }}>🚨</div>
          <div className="stat-content">
            <div className="stat-label">Overdue Invoices</div>
            <div className="stat-value text-danger">{data?.overdueCount || 0}</div>
            <div className="text-sm text-muted">Past net payment due date</div>
          </div>
        </div>
      </div>

      {/* Revenue Trajectory Chart */}
      <div className="card mb-6">
        <div className="card-header">
          <span className="card-title">Monthly Revenue Realization</span>
          <span className="badge badge-secondary">Past 12 Months</span>
        </div>
        <div className="card-body" style={{ height: 320 }}>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorBilled" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4f8ef7" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#4f8ef7" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorCollected" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#34d399" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="month" stroke="var(--text-muted)" fontSize={12} />
                <YAxis stroke="var(--text-muted)" fontSize={12} tickFormatter={(v) => `$${v}`} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-glass)',
                    borderRadius: 8,
                    color: 'var(--text-primary)',
                  }}
                  formatter={(val: any) => [fmtMoney(val), '']}
                />
                <Area type="monotone" dataKey="Billed" stroke="#4f8ef7" fillOpacity={1} fill="url(#colorBilled)" />
                <Area type="monotone" dataKey="Collected" stroke="#34d399" fillOpacity={1} fill="url(#colorCollected)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-state" style={{ padding: '60px 0' }}>
              <div className="empty-icon">📈</div>
              <div className="empty-title">No billing revenue history recorded yet</div>
              <div className="empty-desc">Revenue charts populate after billing runs execute</div>
            </div>
          )}
        </div>
      </div>

      {/* Overdue Aging Table */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Delinquent & Overdue Aging Invoices</span>
          <span className="badge badge-danger">{data?.overdueInvoices?.length || 0} overdue</span>
        </div>
        <div className="table-container">
          {!data || data.overdueInvoices.length === 0 ? (
            <div className="empty-state" style={{ padding: '40px 0' }}>
              <div className="empty-icon">✓</div>
              <div className="empty-title">All accounts in good standing</div>
              <div className="empty-desc">No invoices are past their maturity due dates</div>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Due Date</th>
                  <th>Days Overdue</th>
                  <th className="text-right">Total</th>
                  <th className="text-right">Paid</th>
                  <th className="text-right">Outstanding Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.overdueInvoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="font-mono text-primary font-bold">{inv.invoice_number}</td>
                    <td>
                      <div>{inv.customer_name}</div>
                      <div className="text-sm text-muted">{inv.customer_email}</div>
                    </td>
                    <td className="text-sm text-muted">{fmtDate(inv.due_date)}</td>
                    <td>
                      <span className="badge badge-danger">
                        {inv.days_overdue} days
                      </span>
                    </td>
                    <td className="amount text-right">{fmtMoney(inv.total)}</td>
                    <td className="amount text-right text-success">{fmtMoney(inv.amount_paid)}</td>
                    <td className="amount text-right font-bold text-danger">
                      {fmtMoney(inv.outstanding_amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

