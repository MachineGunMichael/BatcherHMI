import { Box, Button, Typography, useTheme } from "@mui/material";
import { tokens } from "../../theme";
import AdminPanelSettingsOutlinedIcon from "@mui/icons-material/AdminPanelSettingsOutlined";
import SecurityOutlinedIcon from "@mui/icons-material/SecurityOutlined";
import EngineeringOutlinedIcon from "@mui/icons-material/EngineeringOutlined";

const RoleSelector = ({ onRoleSelect, hideTitle = false }) => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);

  const roles = [
    {
      title: "Admin",
      value: "admin",
      icon: <AdminPanelSettingsOutlinedIcon sx={{ fontSize: "36px" }} />,
      description: "Full system access and control",
      color: colors.redAccent[600]
    },
    {
      title: "Manager",
      value: "manager",
      icon: <SecurityOutlinedIcon sx={{ fontSize: "36px" }} />,
      description: "Reporting and configuration access",
      color: colors.tealAccent[600]
    },
    {
      title: "Operator",
      value: "operator",
      icon: <EngineeringOutlinedIcon sx={{ fontSize: "36px" }} />,
      description: "Machine operation access only",
      color: colors.orangeAccent[600]
    }
  ];

  return (
    <Box>
      {!hideTitle && (
        <Typography variant="h4" mb={3} fontWeight="bold" textAlign="center">
          Select Your Role
        </Typography>
      )}
      
      <Box 
        display="flex" 
        gap={3} 
        justifyContent="center" 
        alignItems="center"
        flexWrap="wrap"
      >
        {roles.map((role) => (
          <Button
            key={role.value}
            onClick={() => onRoleSelect(role.value)}
            sx={{
              backgroundColor: "transparent",
              border: `2px solid ${colors.grey[300]}`,
              padding: "20px",
              minWidth: "180px",
              maxWidth: "200px",
              height: "220px", // Fixed height for all buttons
              borderRadius: "12px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "flex-start", // Start from top
              transition: "all 0.3s ease",
              "&:hover": {
                backgroundColor: colors.grey[200] || "#f5f5f5",
                borderColor: role.color,
                transform: "translateY(-2px)",
                boxShadow: `0 4px 12px rgba(0, 0, 0, 0.1)`,
              }
            }}
          >
            <Box
              bgcolor={role.color}
              p={2}
              borderRadius="50%"
              display="flex"
              justifyContent="center"
              alignItems="center"
              sx={{
                width: 60,
                height: 60,
                marginBottom: "16px", // Fixed margin after icon
              }}
            >
              {role.icon}
            </Box>
            
            <Box 
              display="flex" 
              flexDirection="column" 
              alignItems="center"
              sx={{ 
                height: "calc(100% - 76px)", // Remaining height after icon
                justifyContent: "space-between",
              }}
            >
              <Typography 
                variant="h5" 
                fontWeight="bold" 
                color={colors.grey[900] || "#333"}
                textAlign="center"
                sx={{ 
                  marginBottom: "8px",
                  height: "32px", // Fixed height for title
                  display: "flex",
                  alignItems: "center",
                }}
              >
                {role.title}
              </Typography>
              
              <Typography 
                variant="body2" 
                color={colors.grey[600] || "#666"} 
                textAlign="center"
                sx={{ 
                  lineHeight: 1.3,
                  flex: 1, // Take remaining space
                  display: "flex",
                  alignItems: "flex-start", // Align text to top of available space
                }}
              >
                {role.description}
              </Typography>
            </Box>
          </Button>
        ))}
      </Box>
    </Box>
  );
};

export default RoleSelector;