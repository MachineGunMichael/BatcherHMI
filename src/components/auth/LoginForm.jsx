import { useState } from "react";
import {
  Box,
  TextField,
  Button,
  Typography,
  InputAdornment,
  IconButton,
  useTheme,
} from "@mui/material";
import { Formik } from "formik";
import * as yup from "yup";
import { tokens } from "../../theme";
import { useAuth } from "../../auth/AuthContext";
import PersonOutlineOutlinedIcon from "@mui/icons-material/PersonOutlineOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";

// Validation schema
const loginSchema = yup.object().shape({
  username: yup.string().required("Username is required"),
  password: yup.string().required("Password is required"),
});

const LoginForm = ({ role, onBack, onLogin, isLoading, hideTitle = false }) => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  const [showPassword, setShowPassword] = useState(false);
  const { error } = useAuth();

  // Get role-specific data
  const roleData = {
    admin: {
      title: "Administrator",
      color: colors.redAccent[600],
      icon: <PersonOutlineOutlinedIcon />,
    },
    manager: {
      title: "Manager",
      color: colors.tealAccent[600],
      icon: <PersonOutlineOutlinedIcon />,
    },
    operator: {
      title: "Operator",
      color: colors.orangeAccent[600],
      icon: <PersonOutlineOutlinedIcon />,
    },
  }[role];

  const handleSubmit = async (values) => {
    onLogin(values.username, values.password, role);
  };

  // Add safety check for roleData
  if (!roleData) {
    return (
      <Box>
        <Typography color="error">
          Invalid role: {role}. Please go back and select a valid role.
        </Typography>
        <Button onClick={onBack} sx={{ mt: 2 }}>
          Go Back
        </Button>
      </Box>
    );
  }

  return (
    <Box>
      {!hideTitle && (
        <Box display="flex" alignItems="center" mb={3}>
          <IconButton onClick={onBack} sx={{ mr: 1 }}>
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h4" fontWeight="bold">
            Login as{" "}
            <Typography
              component="span"
              variant="h4"
              fontWeight="bold"
              color={roleData.color}
            >
              {roleData.title}
            </Typography>
          </Typography>
        </Box>
      )}

      {hideTitle && (
        <Box display="flex" alignItems="center" mb={2}>
          <IconButton onClick={onBack} sx={{ mr: 1 }}>
            <ArrowBackIcon />
          </IconButton>
        </Box>
      )}

      <Formik
        initialValues={{
          username: "",
          password: "",
        }}
        validationSchema={loginSchema}
        onSubmit={handleSubmit}
      >
        {({
          values,
          errors,
          touched,
          handleBlur,
          handleChange,
          handleSubmit,
        }) => (
          <form onSubmit={handleSubmit}>
            <Box display="flex" flexDirection="column" gap={3} width="100%">
              <TextField
                fullWidth
                variant="filled"
                type="text"
                label="Username"
                onBlur={handleBlur}
                onChange={handleChange}
                value={values.username}
                name="username"
                error={!!touched.username && !!errors.username}
                helperText={touched.username && errors.username}
                sx={{ 
                  gridColumn: "span 2",
                  "& .MuiInputLabel-root": {
                    color: colors.grey[600] || "#666",
                    "&.Mui-focused": {
                      color: roleData.color,
                    }
                  },
                  "& .MuiFilledInput-root": {
                    "&:before": {
                      borderBottomColor: colors.grey[400] || "#999",
                    },
                    "&:after": {
                      borderBottomColor: roleData.color,
                    },
                    "&.Mui-focused": {
                      backgroundColor: "rgba(0, 0, 0, 0.06)",
                    }
                  }
                }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <PersonOutlineOutlinedIcon sx={{ color: roleData.color }} />
                    </InputAdornment>
                  ),
                }}
              />
              <TextField
                fullWidth
                variant="filled"
                type={showPassword ? "text" : "password"}
                label="Password"
                onBlur={handleBlur}
                onChange={handleChange}
                value={values.password}
                name="password"
                error={!!touched.password && !!errors.password}
                helperText={touched.password && errors.password}
                sx={{
                  "& .MuiInputLabel-root": {
                    color: colors.grey[600] || "#666",
                    "&.Mui-focused": {
                      color: roleData.color,
                    }
                  },
                  "& .MuiFilledInput-root": {
                    "&:before": {
                      borderBottomColor: colors.grey[400] || "#999",
                    },
                    "&:after": {
                      borderBottomColor: roleData.color,
                    },
                    "&.Mui-focused": {
                      backgroundColor: "rgba(0, 0, 0, 0.06)",
                    }
                  }
                }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <LockOutlinedIcon sx={{ color: roleData.color }} />
                    </InputAdornment>
                  ),
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowPassword(!showPassword)}
                        edge="end"
                        sx={{ color: roleData.color }}
                      >
                        {showPassword ? (
                          <VisibilityOffIcon />
                        ) : (
                          <VisibilityIcon />
                        )}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />

              <Button
                type="submit"
                color="secondary"
                variant="contained"
                disabled={isLoading}
                sx={{
                  padding: "10px 20px",
                  backgroundColor: roleData.color,
                  color: colors.grey[100],
                  fontWeight: "bold",
                  "&:hover": {
                    backgroundColor: theme.palette.mode === "dark"
                      ? `${roleData.color}80` // Add transparency
                      : roleData.color,
                  },
                }}
              >
                {isLoading ? "Logging in..." : "Login"}
              </Button>

              {error && (
                <Box 
                  sx={{
                    padding: "12px",
                    backgroundColor: "#ffeaea",
                    border: "1px solid #d32f2f",
                    borderRadius: "8px",
                    textAlign: "center",
                    marginTop: "8px",
                    width: "100%", // Match the button width
                    boxSizing: "border-box"
                  }}
                >
                  <Typography 
                    color="#d32f2f"
                    variant="body2"
                    fontWeight="medium"
                  >
                    Login failed: {error}
                  </Typography>
                </Box>
              )}
            </Box>
          </form>
        )}
      </Formik>
    </Box>
  );
};

export default LoginForm;