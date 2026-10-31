import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

interface NavItemDef {
  path: string;
  icon: string;
  label: string;
  roles?: string[];
}

const NAV_ITEMS: NavItemDef[] = [
  { path: '/dashboard', icon: '⬡', label: 'Dashboard' },
  { path: '/my-subscriptions', icon: '📄', label: 'My Subscriptions', roles: ['customer'] },
  { path: '/subscriptions', icon: '♻', label: 'Subscriptions', roles: ['admin', 'staff'] },
  { path: '/invoices', icon: '🧾', label: 'Invoices' },
  { path: '/payments', icon: '💳', label: 'Payments' },
  { path: '/customers', icon: '👥', label: 'Customers', roles: ['admin', 'staff'] },
  { path: '/catalog', icon: '📦', label: 'Catalog', roles: ['admin', 'staff'] },
  { path: '/plans', icon: '📋', label: 'Plans', roles: ['admin', 'staff'] },
  { path: '/discounts', icon: '🏷', label: 'Discounts', roles: ['admin', 'staff'] },
  { path: '/taxes', icon: '💹', label: 'Taxes', roles: ['admin'] },
  { path: '/staff', icon: '🧑‍💼', label: 'Staff', roles: ['admin'] },
  { path: '/billing-runs', icon: '⚡', label: 'Billing Runs', roles: ['admin', 'staff'] },
  { path: '/reports', icon: '📊', label: 'Reports', roles: ['admin', 'staff'] },
];

function usePageTitle() {
  const nav = NAV_ITEMS.find((n) => window.location.pathname.startsWith(n.path));
  return nav?.label || 'Brightloop Billing';
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [dropOpen, setDropOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pageTitle = usePageTitle();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (!item.roles) return true;
    return user && item.roles.includes(user.role);
  });

  const adminItems = visibleItems.filter((i) =>
    ['Taxes', 'Staff', 'Billing Runs', 'Reports'].includes(i.label)
  );
  const mainItems = visibleItems.filter(
    (i) => !['Taxes', 'Staff', 'Billing Runs', 'Reports'].includes(i.label)
  );

  const initials = user?.name
    ? user.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : '??';

  return (
    <div className="layout">
      {/* Sidebar */}
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="brand">
          <div className="brand-logo">B</div>
          <div>
            <div className="brand-name">Brightloop</div>
            <div className="brand-sub">Billing</div>
          </div>
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          <nav className="nav-section">
            <div className="nav-section-label">Main</div>
            {mainItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                onClick={() => setSidebarOpen(false)}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </nav>

          {adminItems.length > 0 && (
            <nav className="nav-section">
              <div className="nav-section-label">Administration</div>
              {adminItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                  onClick={() => setSidebarOpen(false)}
                >
                  <span className="nav-icon">{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
            </nav>
          )}
        </div>

        <div className="sidebar-footer">
          <div className="flex items-center gap-2">
            <div className="avatar" style={{ width: 30, height: 30, fontSize: 11 }}>{initials}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="truncate" style={{ fontSize: 12.5, fontWeight: 600 }}>{user?.name}</div>
              <div className="truncate text-muted" style={{ fontSize: 11 }}>{user?.email}</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main area */}
      <div className="main-content">
        {/* Topbar */}
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="btn-icon"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              style={{ display: 'none' }}
              aria-label="Toggle sidebar"
            >
              ☰
            </button>
            <span className="topbar-page-title">{pageTitle}</span>
          </div>

          <div className="topbar-right">
            <span className={`role-chip role-${user?.role}`}>{user?.role}</span>

            <div className="dropdown">
              <button
                className="avatar"
                onClick={() => setDropOpen(!dropOpen)}
                aria-label="User menu"
                id="user-menu-btn"
              >
                {initials}
              </button>

              {dropOpen && (
                <>
                  <div
                    style={{
                      position: 'fixed',
                      inset: 0,
                      zIndex: 299,
                    }}
                    onClick={() => setDropOpen(false)}
                  />
                  <div className="dropdown-menu">
                    <div className="dropdown-item" style={{ cursor: 'default', pointerEvents: 'none' }}>
                      <span>👤</span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{user?.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{user?.email}</div>
                      </div>
                    </div>
                    <div className="dropdown-divider" />
                    <div
                      className="dropdown-item danger"
                      onClick={handleLogout}
                      id="logout-btn"
                    >
                      <span>🚪</span> Sign out
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="page-content">
          {children}
        </main>
      </div>
    </div>
  );
}
