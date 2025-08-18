import Dashboard from "../scenes/dashboard";
import Settings from "../scenes/settings";
import Simulation from "../scenes/simulation";
import PlanAssist from "../scenes/planAssist";

// Define all available routes with their metadata
export const ROUTES = {
  DASHBOARD: {
    path: "/dashboard",
    name: "Dashboard",
    component: Dashboard,
    icon: "dashboard"
  },
  SIMULATION: {
    path: "/simulation", 
    name: "Simulation",
    component: Simulation,
    icon: "simulation"
  },
  SETTINGS: {
    path: "/settings",
    name: "Settings", 
    component: Settings,
    icon: "settings"
  },
  PLAN_ASSIST: {
    path: "/planAssist",
    name: "PlanAssist",
    component: PlanAssist,
    icon: "planAssist"
  }
};

// Define which routes each role can access
export const ROLE_ROUTES = {
  admin: [
    ROUTES.DASHBOARD,
    ROUTES.PLAN_ASSIST,
    ROUTES.SETTINGS,
    ROUTES.SIMULATION
  ],
  manager: [
    ROUTES.DASHBOARD,
    ROUTES.SIMULATION
  ],
  operator: [
    ROUTES.DASHBOARD,
    ROUTES.SETTINGS
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
