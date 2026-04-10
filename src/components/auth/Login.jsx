import { useState } from "react";
import {
  Box,
  TextField,
  Button,
  Typography,
  InputAdornment,
  IconButton,
  useTheme,
  Alert,
} from "@mui/material";
import { Formik } from "formik";
import * as yup from "yup";
import { tokens } from "../../theme";
import { useAuth } from "../../auth/AuthContext";
import PersonOutlineOutlinedIcon from "@mui/icons-material/PersonOutlineOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";

const loginSchema = yup.object().shape({
  username: yup.string().required("Username is required"),
  password: yup.string().required("Password is required"),
});

const Login = () => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  const authContext = useAuth();
  const login = authContext?.login || (() => {});
  const loading = authContext?.loading || false;
  const error = authContext?.error;
  const clearError = authContext?.clearError || (() => {});
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (values) => {
    clearError();
    await login(values.username, values.password);
  };

  const accentColor = colors.tealAccent[500];

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        width: "100vw",
        padding: "20px",
      }}
    >
      <Box
        sx={{
          width: "100%",
          maxWidth: "400px",
          padding: "32px 36px 28px",
          borderRadius: "16px",
          boxShadow: "0 4px 24px rgba(0, 0, 0, 0.08)",
          border: `1px solid ${colors.grey[300]}`,
          backgroundColor: theme.palette.mode === "dark" ? colors.primary[400] : "#fff",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <Box sx={{ mb: 2 }}>
          <img
            alt="AG Automation logo"
            src="/assets/agautomation_big.png"
            style={{ width: "130px", objectFit: "contain" }}
          />
        </Box>

        <Typography
          variant="h4"
          fontWeight="bold"
          sx={{ mb: 0.5, color: theme.palette.mode === "dark" ? colors.grey[100] : "#333" }}
        >
          Welcome
        </Typography>
        <Typography
          variant="body2"
          sx={{ mb: 3, color: colors.grey[500] }}
        >
          Please sign in to continue
        </Typography>

        <Formik
          initialValues={{ username: "", password: "" }}
          validationSchema={loginSchema}
          onSubmit={handleSubmit}
        >
          {({ values, errors, touched, handleBlur, handleChange, handleSubmit: formSubmit }) => (
            <form onSubmit={formSubmit} style={{ width: "100%" }}>
              <Box display="flex" flexDirection="column" gap={2} width="100%">
                <TextField
                  fullWidth
                  variant="outlined"
                  label="Username"
                  color="secondary"
                  onBlur={handleBlur}
                  onChange={handleChange}
                  value={values.username}
                  name="username"
                  error={!!touched.username && !!errors.username}
                  helperText={touched.username && errors.username}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <PersonOutlineOutlinedIcon sx={{ color: accentColor }} />
                      </InputAdornment>
                    ),
                  }}
                />
                <TextField
                  fullWidth
                  variant="outlined"
                  type={showPassword ? "text" : "password"}
                  label="Password"
                  color="secondary"
                  onBlur={handleBlur}
                  onChange={handleChange}
                  value={values.password}
                  name="password"
                  error={!!touched.password && !!errors.password}
                  helperText={touched.password && errors.password}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <LockOutlinedIcon sx={{ color: accentColor }} />
                      </InputAdornment>
                    ),
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          onClick={() => setShowPassword(!showPassword)}
                          edge="end"
                          sx={{ color: accentColor }}
                        >
                          {showPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />

                <Button
                  type="submit"
                  variant="contained"
                  color="secondary"
                  disabled={loading}
                  sx={{
                    padding: "12px 20px",
                    fontWeight: "bold",
                    fontSize: "15px",
                    borderRadius: "8px",
                    mt: 0.5,
                  }}
                >
                  {loading ? "Signing in..." : "Sign In"}
                </Button>

                {error && (
                  <Alert severity="error" sx={{ mt: 1 }}>
                    {error}
                  </Alert>
                )}
              </Box>
            </form>
          )}
        </Formik>

        <Typography
          variant="caption"
          sx={{ mt: 3, color: colors.grey[500] }}
        >
          AG Automation &copy; {new Date().getFullYear()}
        </Typography>
      </Box>
    </Box>
  );
};

export default Login;
