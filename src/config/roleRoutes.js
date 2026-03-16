import Dashboard from "../scenes/dashboard";
import Setup from "../scenes/setup";
import PlanAssist from "../scenes/planAssist";
import Stats from "../scenes/stats";
import Orders from "../scenes/orders";
import Admin from "../scenes/admin";

// Define all available routes with their metadata
export const ROUTES = {
  DASHBOARD: {
    path: "/dashboard",
    name: "Dashboard",
    component: Dashboard,
    icon: "dashboard"
  },
  SETUP: {
    path: "/setup",
    name: "Setup", 
    component: Setup,
    icon: "setup"
  },
  PLAN_ASSIST: {
    path: "/planAssist",
    name: "PlanAssist",
    component: PlanAssist,
    icon: "planAssist"
  },
  STATS: {
    path: "/stats",
    name: "Stats",
    component: Stats,
    icon: "stats"
  },
  ORDERS: {
    path: "/orders",
    name: "Orders",
    component: Orders,
    icon: "orders"
  },
  ADMIN: {
    path: "/admin",
    name: "Admin",
    component: Admin,
    icon: "admin"
  }
};

// Define which routes each role can access
export const ROLE_ROUTES = {
  admin: [
    ROUTES.DASHBOARD,
    ROUTES.SETUP,
    ROUTES.STATS,
    ROUTES.PLAN_ASSIST,
    ROUTES.ORDERS,
    ROUTES.ADMIN,
  ],
  manager: [
    ROUTES.DASHBOARD,
    ROUTES.STATS,
  ],
  operator: [
    ROUTES.DASHBOARD,
    ROUTES.SETUP
  ],
  customer: [
    ROUTES.ORDERS,
  ]
};

// Get routes for a specific role
export const getRoutesForRole = (role) => {
  return ROLE_ROUTES[role] || [];
};

// Check if a role has access to a specific route
export const hasRouteAccess = (role, routePath) => {
  const roleRoutes = getRoutesForRole(role);
  return roleRoutes.some(route => route.path === routePath);
};

// Get default route for a role
export const getDefaultRouteForRole = (role) => {
  const routes = getRoutesForRole(role);
  return routes.length > 0 ? routes[0].path : "/dashboard";
};
