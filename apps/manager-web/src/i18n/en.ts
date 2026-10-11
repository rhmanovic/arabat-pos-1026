export const managerEn = {
  title: 'Business Management',
  navLabel: 'Manager navigation',
  nav: {
    dashboard: 'Dashboard',
    branches: 'Branches',
    staff: 'Employees',
    roles: 'Roles & permissions',
    products: 'Products',
    inventory: 'Inventory',
    sales: 'Sales',
    reports: 'Reports',
    settings: 'Settings',
  },
  login: {
    title: 'Sign in to management',
    subtitle: 'Manage branches, employees, products and reports.',
  },
  register: {
    title: 'Create your company account',
    subtitle: 'You will be the owner. You can add branches and employees afterwards.',
    companyName: 'Company name',
    submit: 'Create account',
  },
  dashboard: {
    title: 'Dashboard',
    emptyTitle: 'Your business overview will appear here',
    emptyBody: 'Branches, employees and sales are added in the next milestones.',
  },
};
export type ManagerResources = typeof managerEn;
