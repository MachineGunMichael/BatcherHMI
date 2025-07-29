import {Box, IconButton, useTheme, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button} from "@mui/material";
import {useContext, useState} from "react";
import {ColorModeContext, tokens} from "../../theme";
import { useAuth } from "../../auth/AuthContext";
// import InputBase from "@mui/material/InputBase";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import NotificationsOutlinedIcon from "@mui/icons-material/NotificationsOutlined";
import LogoutOutlinedIcon from "@mui/icons-material/LogoutOutlined";

const Topbar = () => {
    const theme = useTheme();
    const colors = tokens(theme.palette.mode);
    const colorMode = useContext(ColorModeContext);
    const { logout } = useAuth();
    const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);

    const handleLogoutClick = () => {
        setLogoutDialogOpen(true);
    };

    const handleLogoutConfirm = () => {
        setLogoutDialogOpen(false);
        logout();
    };

    const handleLogoutCancel = () => {
        setLogoutDialogOpen(false);
    };
  
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
          <IconButton 
            onClick={handleLogoutClick}
            sx={{ color: colors.primary[800] }}
            title="Logout"
          >
            <LogoutOutlinedIcon />
          </IconButton>
        </Box>

        {/* Logout Confirmation Dialog */}
        <Dialog
          open={logoutDialogOpen}
          onClose={handleLogoutCancel}
          aria-labelledby="logout-dialog-title"
          aria-describedby="logout-dialog-description"
        >
          <DialogTitle id="logout-dialog-title">
            Confirm Logout
          </DialogTitle>
          <DialogContent>
            <DialogContentText id="logout-dialog-description">
              Are you sure you want to log out? You will be returned to the login screen.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button 
              onClick={handleLogoutCancel} 
              sx={{ 
                color: colors.grey[500],
                '&:hover': {
                  backgroundColor: colors.grey[200]
                }
              }}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleLogoutConfirm} 
              autoFocus
              sx={{ 
                color: colors.redAccent[500],
                '&:hover': {
                  backgroundColor: colors.redAccent[300]
                }
              }}
            >
              Logout
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    );
  };
  
  export default Topbar;
  