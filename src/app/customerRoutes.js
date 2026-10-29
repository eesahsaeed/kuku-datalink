import React from 'react';

import Home from 'views/customer/Home.js';
import Wallet from 'views/customer/Wallet';
import Profile from 'views/customer/Profile.js';
import ContactUs from 'views/customer/ContactUs';
import AboutUs from 'views/customer/AboutUs';
import Support from 'views/customer/Support';
import WalletTest from 'views/customer/WalletTest';
import { isDev } from '../lib/helper';

var routes = [
  {
    path: '/',
    name: 'Dashboard',
    icon: 'tim-icons icon-chart-pie-36',
    component: <Home />,
    layout: '',
    requiresAuth: false,
  },
  {
    path: '/wallet',
    name: 'Wallet',
    icon: 'tim-icons icon-wallet-43',
    component: <Wallet />,
    layout: '',
    requiresAuth: true,
  },
  {
    path: '/profile',
    name: 'Profile',
    icon: 'tim-icons icon-single-02',
    component: <Profile />,
    layout: '',
    requiresAuth: true,
  },
  {
    path: '/contact-us',
    name: 'Contact Us',
    icon: 'tim-icons icon-single-02',
    component: <ContactUs />,
    layout: '',
    requiresAuth: false,
    showInSidebar: false,
  },
  {
    path: '/about-us',
    name: 'About Us',
    icon: 'tim-icons icon-single-02',
    component: <AboutUs />,
    layout: '',
    requiresAuth: true,
    showInSidebar: false,
  },
  {
    path: '/support',
    name: 'Support',
    icon: 'tim-icons icon-single-02',
    component: <Support />,
    layout: '',
    requiresAuth: true,
    showInSidebar: false,
  },
  {
    path: '/ticket/:id',
    name: 'Ticket',
    icon: 'tim-icons icon-single-02',
    component: <Support />,
    layout: '',
    requiresAuth: true,
    showInSidebar: false,
  },
  {
    path: '/wallet-test',
    name: 'Wallet Test',
    icon: 'tim-icons icon-settings-gear-63',
    component: <WalletTest />,
    layout: '',
    requiresAuth: true,
    showInSidebar: isDev(),
  },
];

export default routes;
