import React from 'react';

import Dashboard from 'views/admin/Dashboard.js';
import Plans from 'views/admin/plans-dashboard/Plans.js';
import Complains from 'views/admin/Complains.js';
import RoleManager from 'views/admin/UserManager.js';
import Transactions from 'views/admin/Transactions.js';
import Ticket from 'views/admin/Ticket.js';

var routes = [
  {
    path: '/dashboard',
    name: 'Dashboard',
    icon: 'tim-icons icon-chart-pie-36',
    component: <Dashboard />,
    layout: '/admin',
  },
  {
    path: '/plans',
    name: 'Plans',
    icon: 'tim-icons icon-chart-bar-32',
    component: <Plans />,
    layout: '/admin',
  },
  {
    path: '/complains',
    name: 'Complains',
    icon: 'tim-icons icon-bell-55',
    component: <Complains />,
    layout: '/admin',
  },
  {
    path: '/role-manager',
    name: 'User Manager',
    icon: 'tim-icons icon-single-02',
    component: <RoleManager />,
    layout: '/admin',
    requiresPrimaryAdmin: true,
  },
  {
    path: '/transactions',
    name: 'Transactions',
    icon: 'tim-icons icon-coins',
    component: <Transactions />,
    layout: '/admin',
    requiresPrimaryAdmin: true,
  },
  {
    path: '/ticket',
    name: 'Ticket',
    icon: 'tim-icons icon-bell-55',
    component: <Ticket />,
    layout: '/admin',
    showInSidebar: false,
  },
];
export default routes;
