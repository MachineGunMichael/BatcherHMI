import {Box, IconButton, useTheme} from "@mui/material";
import {useContext} from "react";
import {ColorModeContext, tokens} from "../../theme";
// import InputBase from "@mui/material/InputBase";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import NotificationsOutlinedIcon from "@mui/icons-material/NotificationsOutlined";

const Topbar = () => {
    const theme = useTheme();
    const colors = tokens(theme.palette.mode);
    const colorMode = useContext(ColorModeContext);
  
    return (
      <Box 
        display="flex" 
        justifyContent="space-between" 
        alignItems="center"  // Add this to vertically center content
        height="140px"       // Match the height with your logo area
        px={4}               // Horizontal padding
        py={2}               // Vertical padding
      >
        {/* Left side - you could add something here */}
        <Box></Box>
  
        {/* ICONS */}
        <Box display="flex">
          <IconButton 
          onClick={colorMode.toggleColorMode}
          sx={{ color: colors.primary[800] }}>
            {theme.palette.mode === "light" ? (
              <DarkModeOutlinedIcon />
            ) : (
              <LightModeOutlinedIcon />
            )}
          </IconButton>
          <IconButton sx={{ color: colors.primary[800] }}>
            <NotificationsOutlinedIcon />
          </IconButton>
          <IconButton sx={{ color: colors.primary[800] }}>
            <SettingsOutlinedIcon />
          </IconButton>
        </Box>
      </Box>
    );
  };
  
  export default Topbar;
  