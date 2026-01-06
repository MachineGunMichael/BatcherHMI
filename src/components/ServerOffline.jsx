// src/components/ServerOffline.jsx
// Displays a user-friendly message when the backend server is not available

import React from "react";
import { Box, Typography, useTheme } from "@mui/material";
import CloudOffIcon from "@mui/icons-material/CloudOff";
import { tokens } from "../theme";

/**
 * ServerOffline component - displays when backend connection is lost
 * @param {Object} props
 * @param {string} props.title - Page title to display
 */
const ServerOffline = ({ title = "Connection Lost" }) => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);

  return (
    <Box
      m="20px"
      display="flex"
      alignItems="center"
      justifyContent="center"
      height="calc(100vh - 200px)"
    >
      <Box textAlign="center" maxWidth="500px">
        <CloudOffIcon 
          sx={{ 
            fontSize: 80, 
            color: colors.grey[500],
            mb: 3
          }} 
        />
        <Typography
          variant="h2"
          fontWeight="bold"
          sx={{ color: colors.grey[500], mb: 2 }}
        >
          {title}
        </Typography>
        <Typography
          variant="h4"
          sx={{ color: colors.tealAccent[500], mb: 4 }}
        >
          Connection to server lost
        </Typography>
        <Typography
          variant="body1"
          sx={{ color: colors.grey[300], mb: 2 }}
        >
          The application cannot connect to the backend server.
        </Typography>
        <Typography
          variant="body1"
          sx={{ color: colors.grey[300], mb: 4 }}
        >
          Please ensure the server is running and try again.
        </Typography>
        <Box
          sx={{
            backgroundColor: theme.palette.mode === 'dark' 
              ? colors.primary[600] 
              : colors.primary[200],
            borderRadius: 2,
            p: 3,
            mt: 3
          }}
        >
          <Typography
            variant="body2"
            sx={{ color: colors.grey[400], mb: 1 }}
          >
            To start the server, run:
          </Typography>
          <Typography
            variant="h6"
            fontFamily="monospace"
            sx={{ color: colors.tealAccent[400] }}
          >
            cd server && npm start
          </Typography>
        </Box>
        <Typography
          variant="body2"
          sx={{ color: colors.grey[500], mt: 4 }}
        >
          Attempting to reconnect automatically...
        </Typography>
      </Box>
    </Box>
  );
};

export default ServerOffline;

