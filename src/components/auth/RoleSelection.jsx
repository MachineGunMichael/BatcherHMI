import { Box, Button, Typography, useTheme } from "@mui/material";
import { tokens } from "../../theme";
import AdminPanelSettingsOutlinedIcon from "@mui/icons-material/AdminPanelSettingsOutlined";
import SecurityOutlinedIcon from "@mui/icons-material/SecurityOutlined";
import EngineeringOutlinedIcon from "@mui/icons-material/EngineeringOutlined";
import StorefrontOutlinedIcon from "@mui/icons-material/StorefrontOutlined";

const RoleSelector = ({ onRoleSelect, hideTitle = false }) => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);

  // Internal roles (admin, manager, operator)
  const internalRoles = [
    {
      title: "Admin",
      value: "admin",
      icon: <AdminPanelSettingsOutlinedIcon sx={{ fontSize: "36px" }} />,
      description: "Full system access and control",
      color: colors.redAccent[500]
    },
    {
      title: "Manager",
      value: "manager",
      icon: <SecurityOutlinedIcon sx={{ fontSize: "36px" }} />,
      description: "Reporting and configuration access",
      color: colors.tealAccent[500]
    },
    {
      title: "Operator",
      value: "operator",
      icon: <EngineeringOutlinedIcon sx={{ fontSize: "36px" }} />,
      description: "Machine operation access only",
      color: colors.orangeAccent[500]
    }
  ];

  // External role (customer)
  const customerRole = {
    title: "Customer",
    value: "customer",
    icon: <StorefrontOutlinedIcon sx={{ fontSize: "36px" }} />,
    description: "Place and manage orders",
    color: colors.purpleAccent[500]
  };

  const RoleButton = ({ role }) => (
    <Button
      onClick={() => onRoleSelect(role.value)}
      sx={{
        backgroundColor: "transparent",
        border: `2px solid ${colors.grey[300]}`,
        padding: "20px",
        minWidth: "160px",
        maxWidth: "180px",
        height: "200px",
        borderRadius: "12px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
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
          width: 56,
          height: 56,
          marginBottom: "12px",
          color: "#fff",
        }}
      >
        {role.icon}
      </Box>
      
      <Typography 
        variant="h5" 
        fontWeight="bold" 
        color={colors.grey[900] || "#333"}
        textAlign="center"
        sx={{ marginBottom: "6px" }}
      >
        {role.title}
      </Typography>
      
      <Typography 
        variant="body2" 
        color={colors.grey[600] || "#666"} 
        textAlign="center"
        sx={{ lineHeight: 1.3, fontSize: "12px" }}
      >
        {role.description}
      </Typography>
    </Button>
  );

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
        alignItems="flex-start"
      >
        {/* Internal roles - left group */}
        <Box display="flex" gap={2}>
          {internalRoles.map((role) => (
            <RoleButton key={role.value} role={role} />
          ))}
        </Box>

        {/* Divider */}
        <Box 
          sx={{ 
            width: "1px", 
            height: "180px", 
            bgcolor: colors.grey[300],
            alignSelf: "center",
          }} 
        />

        {/* Customer role - right side */}
        <Box>
          <RoleButton role={customerRole} />
        </Box>
      </Box>
    </Box>
  );
};

export default RoleSelector;
