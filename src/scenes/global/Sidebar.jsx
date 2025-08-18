import { useState } from "react";
import { Sidebar as ProSidebar, Menu, MenuItem } from "react-pro-sidebar";
import { Box, Typography, useTheme } from "@mui/material";
import { Link } from "react-router-dom";
import { tokens } from "../../theme";
import SettingsIcon from "@mui/icons-material/TuneOutlined";
import SimulationIcon from '@mui/icons-material/ShapeLineOutlined';
import DashboardIcon from '@mui/icons-material/DashboardOutlined';
import PlanAssistIcon from '@mui/icons-material/MoreTimeOutlined';
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

  // Get routes available for current role
  const availableRoutes = getRoutesForRole(currentRole);

  // Map route icons to MUI icons
  const getIcon = (iconName) => {
    switch (iconName) {
      case 'dashboard':
        return <DashboardIcon />;
      case 'planAssist':
        return <PlanAssistIcon />;
      case 'settings':
        return <SettingsIcon />;
      case 'simulation':
        return <SimulationIcon />;
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
        {/* Toggle collapse button */}
            <MenuItem
            onClick={() => setIsCollapsed(!isCollapsed)}
            icon={isCollapsed ? <HomeOutlinedIcon /> : undefined}
            style={{
              margin: "30px 0 50px 0",
              color: colors.tealAccent[500],
            }}
          >
            {!isCollapsed && (
              <Box 
                display="flex" 
                justifyContent="center" 
                alignItems="center"
                width="100%" // Ensure the Box takes full width
              >
                <Box display="flex" alignItems="center">
                  <img
                    alt="logo"
                    height="40px"
                    src={`../../assets/atlas4.png`}
                    style={{ cursor: "pointer" }}
                  />
                </Box>
              </Box>
            )}
          </MenuItem>

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