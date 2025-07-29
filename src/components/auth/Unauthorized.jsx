import { Box, Button, Typography, useTheme } from "@mui/material";
import { tokens } from "../../theme";
import Header from "../../components/Header";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import { useNavigate } from "react-router-dom";

const Unauthorized = () => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  const navigate = useNavigate();

  return (
    <Box
      display="flex"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      height="100vh"
      width="100%"
      sx={{
        background: colors.primary[400],
      }}
    >
      <Box
        width="100%"
        maxWidth="600px"
        p={4}
        borderRadius="16px"
        bgcolor={colors.primary[400]}
        boxShadow={3}
        textAlign="center"
      >
        <ErrorOutlineIcon sx={{ fontSize: 80, color: colors.redAccent[500], mb: 2 }} />
        <Header title="Access Denied" subtitle="You don't have permission to access this page" />
        
        <Typography variant="body1" color={colors.grey[100]} my={3}>
          Your current role does not have sufficient privileges to view this content.
          Please contact an administrator if you believe this is an error.
        </Typography>
        
        <Box mt={4} display="flex" justifyContent="center" gap={2}>
          <Button
            variant="contained"
            sx={{ 
              bgcolor: colors.tealAccent[500],
              '&:hover': { bgcolor: colors.tealAccent[700] }
            }}
            onClick={() => navigate("/")}
          >
            Go to Dashboard
          </Button>
          <Button
            variant="outlined"
            sx={{ 
              color: colors.grey[100],
              borderColor: colors.grey[100],
              '&:hover': { borderColor: colors.grey[300] }
            }}
            onClick={() => window.history.back()}
          >
            Go Back
          </Button>
        </Box>
      </Box>
    </Box>
  );
};

export default Unauthorized;