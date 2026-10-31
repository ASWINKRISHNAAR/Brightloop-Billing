import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';

import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import SubscriptionsPage from './pages/SubscriptionsPage';
import InvoicesPage from './pages/InvoicesPage';
import PaymentsPage from './pages/PaymentsPage';
import CustomersPage from './pages/CustomersPage';
import CatalogPage from './pages/CatalogPage';
import PlansPage from './pages/PlansPage';
import DiscountsPage from './pages/DiscountsPage';
import TaxesPage from './pages/TaxesPage';
import StaffPage from './pages/StaffPage';
import BillingRunsPage from './pages/BillingRunsPage';
import ReportsPage from './pages/ReportsPage';
import MySubscriptionsPage from './pages/MySubscriptionsPage';

export function App() {
  return (
    <Routes>
      {/* Public Authentication routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      {/* Protected Application routes */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Layout>
              <DashboardPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/subscriptions"
        element={
          <ProtectedRoute requiredRoles={['admin', 'staff']}>
            <Layout>
              <SubscriptionsPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/invoices"
        element={
          <ProtectedRoute>
            <Layout>
              <InvoicesPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/payments"
        element={
          <ProtectedRoute>
            <Layout>
              <PaymentsPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/customers"
        element={
          <ProtectedRoute requiredRoles={['admin', 'staff']}>
            <Layout>
              <CustomersPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/catalog"
        element={
          <ProtectedRoute requiredRoles={['admin', 'staff']}>
            <Layout>
              <CatalogPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/plans"
        element={
          <ProtectedRoute requiredRoles={['admin', 'staff']}>
            <Layout>
              <PlansPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/discounts"
        element={
          <ProtectedRoute requiredRoles={['admin', 'staff']}>
            <Layout>
              <DiscountsPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/taxes"
        element={
          <ProtectedRoute requiredRoles={['admin']}>
            <Layout>
              <TaxesPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/staff"
        element={
          <ProtectedRoute requiredRoles={['admin']}>
            <Layout>
              <StaffPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/billing-runs"
        element={
          <ProtectedRoute requiredRoles={['admin', 'staff']}>
            <Layout>
              <BillingRunsPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports"
        element={
          <ProtectedRoute requiredRoles={['admin', 'staff']}>
            <Layout>
              <ReportsPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/my-subscriptions"
        element={
          <ProtectedRoute>
            <Layout>
              <MySubscriptionsPage />
            </Layout>
          </ProtectedRoute>
        }
      />

      {/* Fallback & Redirects */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default App;
