import {
  NotFound,
  RedirectIfAuthenticated,
  RequireAuth,
  RequirePermission,
  RouteErrorBoundary,
} from '@arabat/web-core';
import type { ReactNode } from 'react';
import type { RouteObject } from 'react-router';
import { ManagerLayout } from './layouts/ManagerLayout.js';
import { AuditLogPage } from './features/audit/AuditLogPage.js';
import { BranchesPage } from './features/branches/BranchesPage.js';
import { CategoriesPage } from './features/catalog/CategoriesPage.js';
import { ProductEditorPage } from './features/catalog/ProductEditorPage.js';
import { ProductsPage } from './features/catalog/ProductsPage.js';
import { CashCustodyPage } from './features/cash/CashCustodyPage.js';
import { PaymentsPage } from './features/cash/PaymentsPage.js';
import { DevicesPage } from './features/cash/DevicesPage.js';
import { PrintersPage } from './features/cash/PrintersPage.js';
import { RegistersPage } from './features/cash/RegistersPage.js';
import { ShiftDetailPage, ShiftsPage } from './features/cash/ShiftsPage.js';
import { SaleDetailPage, SalesPage } from './features/sales/SalesPage.js';
import { RefundsPage } from './features/refunds/RefundsPage.js';
import { CustomerDetailPage, CustomersPage } from './features/customers/CustomersPage.js';
import { ReportsPage } from './features/reports/ReportsPage.js';
import { RestaurantPage } from './features/restaurant/RestaurantPage.js';
import { OnlineRedirect } from './features/online/OnlineRedirect.js';
import { SubscriptionPage } from './features/subscription/SubscriptionPage.js';
import { PurchaseOrderPage, PurchaseOrdersPage } from './features/purchasing/PurchaseOrdersPage.js';
import { AccountPage } from './features/account/AccountPage.js';
import { PeriodsPage } from './features/periods/PeriodsPage.js';
import { SuppliersPage } from './features/purchasing/SuppliersPage.js';
import {
  NewTransferPage,
  TransferDetailPage,
  TransfersPage,
} from './features/transfers/TransfersPage.js';
import { CompanySettingsPage } from './features/company/CompanySettingsPage.js';
import { DashboardPage } from './features/dashboard/DashboardPage.js';
import { EmployeeDetailPage } from './features/employees/EmployeeDetailPage.js';
import { EmployeesPage } from './features/employees/EmployeesPage.js';
import { AdjustmentEditorPage } from './features/inventory/AdjustmentEditorPage.js';
import { AdjustmentDetailPage, AdjustmentsPage } from './features/inventory/AdjustmentsPage.js';
import { InventoryPage } from './features/inventory/InventoryPage.js';
import { MovementsPage } from './features/inventory/MovementsPage.js';
import { DamagedReturnsPage } from './features/inventory/DamagedReturnsPage.js';
import { RolesPage } from './features/roles/RolesPage.js';
import {
  ForgotPasswordPage,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
  AcceptInvitePage,
} from './pages/LoginPage.js';

/** Route tree of /manager (paths are relative to the /manager basename). See docs/ROUTES.md. */
export const routes: RouteObject[] = [
  {
    path: '/login',
    errorElement: <RouteErrorBoundary />,
    element: (
      <RedirectIfAuthenticated>
        <LoginPage />
      </RedirectIfAuthenticated>
    ),
  },
  {
    path: '/register',
    errorElement: <RouteErrorBoundary />,
    element: (
      <RedirectIfAuthenticated>
        <RegisterPage />
      </RedirectIfAuthenticated>
    ),
  },
  {
    path: '/forgot-password',
    errorElement: <RouteErrorBoundary />,
    element: <ForgotPasswordPage />,
  },
  { path: '/reset-password', errorElement: <RouteErrorBoundary />, element: <ResetPasswordPage /> },
  { path: '/accept-invite', errorElement: <RouteErrorBoundary />, element: <AcceptInvitePage /> },
  {
    path: '/',
    errorElement: <RouteErrorBoundary />,
    element: (
      <RequireAuth>
        <ManagerLayout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'products', element: guard('catalog.read', <ProductsPage />) },
      { path: 'products/new', element: guard('catalog.manage', <ProductEditorPage />) },
      { path: 'products/:productId', element: guard('catalog.read', <ProductEditorPage />) },
      { path: 'categories', element: guard('catalog.read', <CategoriesPage />) },
      { path: 'inventory', element: guard('inventory.read', <InventoryPage />) },
      { path: 'inventory/adjustments', element: guard('inventory.read', <AdjustmentsPage />) },
      {
        path: 'inventory/adjustments/new',
        element: guard('inventory.adjust', <AdjustmentEditorPage />),
      },
      {
        path: 'inventory/adjustments/:adjustmentId',
        element: guard('inventory.read', <AdjustmentDetailPage />),
      },
      { path: 'inventory/movements', element: guard('inventory.read', <MovementsPage />) },
      { path: 'inventory/returns', element: guard('inventory.read', <DamagedReturnsPage />) },
      { path: 'sales', element: guard('sales.read', <SalesPage />) },
      { path: 'sales/:saleId', element: guard('sales.read', <SaleDetailPage />) },
      { path: 'refunds', element: guard('sales.read', <RefundsPage />) },
      // Any of the report permissions; the page shows only the permitted report tabs.
      { path: 'reports', element: <ReportsPage /> },
      { path: 'restaurant', element: guard('restaurant.manage', <RestaurantPage />) },
      // Either permission; the page shows only the permitted tabs.
      { path: 'online', element: <OnlineRedirect /> },
      { path: 'subscription', element: guard('merchant.settings.read', <SubscriptionPage />) },
      { path: 'customers', element: guard('customers.read', <CustomersPage />) },
      { path: 'customers/:customerId', element: guard('customers.read', <CustomerDetailPage />) },
      { path: 'suppliers', element: guard('purchasing.read', <SuppliersPage />) },
      { path: 'purchasing', element: guard('purchasing.read', <PurchaseOrdersPage />) },
      { path: 'purchasing/new', element: guard('purchasing.manage', <PurchaseOrderPage />) },
      { path: 'purchasing/:orderId', element: guard('purchasing.read', <PurchaseOrderPage />) },
      { path: 'transfers', element: guard('inventory.read', <TransfersPage />) },
      { path: 'transfers/new', element: guard('inventory.transfer', <NewTransferPage />) },
      { path: 'transfers/:transferId', element: guard('inventory.read', <TransferDetailPage />) },
      { path: 'cash', element: guard('cash.custody', <CashCustodyPage />) },
      { path: 'audit', element: guard('audit.read', <AuditLogPage />) },
      { path: 'periods', element: guard('reports.financial', <PeriodsPage />) },
      { path: 'account', element: <AccountPage /> },
      { path: 'payments', element: guard('payments.settings', <PaymentsPage />) },
      {
        path: 'accounts',
        element: guard('payments.settings', <PaymentsPage view="accounts" />),
      },
      { path: 'registers', element: guard('registers.manage', <RegistersPage />) },
      { path: 'printers', element: guard('registers.manage', <PrintersPage />) },
      { path: 'devices', element: guard('registers.manage', <DevicesPage />) },
      { path: 'shifts', element: guard('shifts.view_all', <ShiftsPage />) },
      { path: 'shifts/:shiftId', element: guard('shifts.view_all', <ShiftDetailPage />) },
      { path: 'branches', element: guard('branches.read', <BranchesPage />) },
      { path: 'employees', element: guard('employees.read', <EmployeesPage />) },
      { path: 'employees/:membershipId', element: guard('employees.read', <EmployeeDetailPage />) },
      { path: 'roles', element: guard('employees.read', <RolesPage />) },
      { path: 'settings', element: guard('merchant.settings.read', <CompanySettingsPage />) },
      { path: '*', element: <NotFound /> },
    ],
  },
];

/** UX guard only: the API enforces the same permission on every request. */
function guard(permission: string, page: ReactNode) {
  return <RequirePermission permission={permission}>{page}</RequirePermission>;
}
