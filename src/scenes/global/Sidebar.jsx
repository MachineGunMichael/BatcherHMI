import { useState, useEffect } from "react";
import { Sidebar as ProSidebar, Menu, MenuItem } from "react-pro-sidebar";
import { Box, Typography, useTheme } from "@mui/material";
import { Link, useLocation } from "react-router-dom";
import { tokens } from "../../theme";
import SettingsIcon from "@mui/icons-material/TuneOutlined";
import SimulationIcon from '@mui/icons-material/ShapeLineOutlined';
import DashboardIcon from '@mui/icons-material/DashboardOutlined';
import PlanAssistIcon from '@mui/icons-material/MoreTimeOutlined';
import StatsIcon from '@mui/icons-material/BarChartOutlined';
// import MenuOutlinedIcon from "@mui/icons-material/MenuOutlined";
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
// import PeopleOutlinedIcon from '@mui/icons-material/PeopleOutlined';
// import ReceiptOutlinedIcon from '@mui/icons-material/ReceiptOutlined';
import { useAppContext } from "../../context/AppContext";
import { getRoutesForRole } from "../../config/roleRoutes";

const Item = ({ title, to, icon, selected, setSelected }) => {
  return (
    <MenuItem
      active={selected === title}
      onClick={() => setSelected(title)}
      icon={icon}
      component={<Link to={to} />}
    >
      <Typography variant="h4">{title}</Typography>
    </MenuItem>
  );
};

const Sidebar = () => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [selected, setSelected] = useState("Dashboard");
  const { currentRole } = useAppContext();
  const location = useLocation();

  // Get routes available for current role
  const availableRoutes = getRoutesForRole(currentRole);

  // Sync selected state with current route on mount and route change
  useEffect(() => {
    const currentRoute = availableRoutes.find(route => route.path === location.pathname);
    if (currentRoute) {
      setSelected(currentRoute.name);
    }
  }, [location.pathname, availableRoutes]);

  // Map route icons to MUI icons
  const getIcon = (iconName) => {
    switch (iconName) {
      case 'dashboard':
        return <DashboardIcon />;
      case 'stats':
        return <StatsIcon />;
      case 'planAssist':
        return <PlanAssistIcon />;
      case 'setup':
        return <SettingsIcon />;
      default:
        return <HomeOutlinedIcon />;
    }
  };

  return (
    <Box
      sx={{
        height: "100vh",
        width: isCollapsed ? "80px" : "400px",
        transition: "width 0.3s ease",
        borderRight: "none", // Remove the border from here
        backgroundColor: `${colors.primary[100]}`,
        position: "relative", // Add position relative
        // Add a pseudo-element for the border that will always be visible
        "&::after": {
          content: '""',
          position: "absolute",
          top: 0,
          right: 0,
          height: "100%",
          width: "1px", // Make it thicker for visibility
          backgroundColor: colors.primary[400], // Use a more visible color
          zIndex: 1000, // Ensure it's above other elements
        },
        "& .ps-sidebar-root": {
          borderRight: "none",
          width: "100% !important",
          height: "100% !important",
          backgroundColor: `${colors.primary[100]} !important`,
        },
        "& .ps-sidebar-container": {
          backgroundColor: `${colors.primary[100]} !important`,
          height: "100% !important",
          overflow: "hidden !important", // Force hiding overflow
        },
        "& .ps-menu-root": {
          height: "100%",
          backgroundColor: `${colors.primary[100]} !important`,
        },

        /* =============== KEY STYLES BELOW =============== */
        "& .ps-menu-button": {
          display: "flex !important",
          flexDirection: "row !important",
          alignItems: "center !important",
          justifyContent: "center !important",
          padding: "40px 20px",
          color: `${colors.primary[800]} !important`,
          backgroundColor: "transparent !important",
        },
        "& .ps-menu-button .ps-menu-icon": {
          /* Give the icon a fixed width so all icons align in one column */
          minWidth: "20px !important",
          /* Center the actual <svg> within that 40px box */
          display: "flex !important",
          alignItems: "center !important",
          justifyContent: "center !important",
          marginRight: isCollapsed ? "0 !important" : "25px !important",
          marginLeft: isCollapsed ? "0 !important" : "5px !important",
        },
        /* Optionally, force consistent icon size. 24px is typical for MUI icons. */
        "& .ps-menu-button .ps-menu-icon svg": {
          fontSize: "40px !important",
        },
        "& .ps-menu-button .ps-menu-label": {
          /* Hide the text if collapsed; otherwise, show it to the right of the icon */
          display: isCollapsed ? "none !important" : "inline-flex !important",
          textAlign: "left !important",
          padding: "0 !important",
        },
        /* ================================================ */

        "& .ps-menuitem-root": {
          width: "100%",
        },
        "& .ps-menuitem-root > div": {
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        },
        "& .ps-menu-button:hover": {
          color: `${colors.tealAccent[500]} !important`,
          backgroundColor: "transparent !important",
        },
        "& .ps-menuitem-root.ps-active .ps-menu-button": {
          color: `${colors.tealAccent[500]} !important`,
          backgroundColor: "transparent !important",
        },
      }}
    >
      {/* Logo positioned outside ProSidebar for unrestricted placement */}
      {!isCollapsed && (
        <>
          {/* Logo image - visible but not clickable */}
          <Box
            sx={{
              position: "absolute",
              top: "-30px",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 5,
              pointerEvents: "none", // Not clickable
            }}
          >
            <img
              alt="AG Automation logo"
              height="250px"
              src={theme.palette.mode === 'dark' 
                ? `/assets/agautomation_white.png`
                : `/assets/agautomation.png`
              }
            />
          </Box>
          {/* Clickable overlay - only covers the logo area above menu items */}
          <Box
            onClick={() => setIsCollapsed(!isCollapsed)}
            sx={{
              position: "absolute",
              top: "-30px",
              left: "50%",
              transform: "translateX(-50%)",
              width: "300px", // Approximate logo width
              height: "190px", // Only the part above menu items (160px spacer + some buffer)
              cursor: "pointer",
              zIndex: 100,
            }}
          />
        </>
      )}

      <ProSidebar
        collapsed={isCollapsed}
        style={{
          height: "100%",
          backgroundColor: colors.primary[800],
        }}
      >
        <Menu
          iconShape="square"
          style={{
            height: "100%",
            backgroundColor: colors.primary[800],
          }}
        >
        {/* Toggle button when collapsed - uses MenuItem for consistent alignment */}
          {isCollapsed && (
            <MenuItem
              onClick={() => setIsCollapsed(!isCollapsed)}
              icon={<HomeOutlinedIcon />}
              style={{
                margin: "30px 0 50px 0",
                color: colors.primary[800],
              }}
            />
          )}

          {/* Spacer to push menu items below the logo */}
          {!isCollapsed && (
            <Box sx={{ height: "160px" }} /> // Adjust to match logo height + desired gap
          )}

          {/* Menu Items */}
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              width: "100%",
            }}
          >
            {availableRoutes.map((route) => (
              <Item
                key={route.path}
                title={route.name}
                to={route.path}
                icon={getIcon(route.icon)}
                selected={selected}
                setSelected={setSelected}
              />
            ))}
          </Box>
        </Menu>
      </ProSidebar>
    </Box>
  );
};

export default Sidebar;