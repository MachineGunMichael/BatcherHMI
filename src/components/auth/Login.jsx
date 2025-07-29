import { useState } from "react";
import { Box, Typography, useTheme } from "@mui/material";
import { tokens } from "../../theme";
import RoleSelector from "./RoleSelection";
import LoginForm from "./LoginForm";
import Header from "../../components/Header";
import { useAuth } from "../../auth/AuthContext";

const Login = () => {
  console.log("Login component rendering...");
  
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  const [selectedRole, setSelectedRole] = useState(null);
  const { login, error, clearError } = useAuth();

  const handleRoleSelect = (role) => {
    setSelectedRole(role);
    clearError(); // Clear any previous login errors
  };

  const handleLogin = async (username, password) => {
    await login(username, password, selectedRole);
  };

  const handleBack = () => {
    setSelectedRole(null);
    clearError(); // Clear any login errors when going back to role selection
  };


  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      width: '100vw',
      padding: '20px'
    }}>
      <div style={{
        width: '100%', 
        maxWidth: '800px', 
        minHeight: '600px', // Fixed minimum height
        maxHeight: '600px', // Fixed maximum height
        height: '600px', // Fixed height
        padding: '32px', 
        borderRadius: '16px', 
        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
        border: '1px solid #ddd',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box' // Include padding and border in height calculation
      }}>
        <div style={{ textAlign: 'center', marginBottom: '32px', minHeight: '80px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <h1 style={{ 
            margin: '0 0 8px 0', 
            fontSize: '2rem', 
            fontWeight: 'bold',
            color: '#333'
          }}>
            BatchMind Login
          </h1>
          <p style={{ 
            margin: 0, 
            fontSize: '1rem', 
            color: '#666'
          }}>
            Please sign in to continue
          </p>
        </div>
        
        {/* Fixed height area for dynamic content headers */}
        <div style={{ 
          minHeight: '60px', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          marginBottom: '24px'
        }}>
          {!selectedRole ? (
            <h2 style={{ 
              margin: 0, 
              fontSize: '1.5rem', 
              fontWeight: 'bold',
              color: '#333',
              textAlign: 'center'
            }}>
              Select Your Role
            </h2>
          ) : (
            <h2 style={{ 
              margin: 0, 
              fontSize: '1.5rem', 
              fontWeight: 'bold',
              color: '#333',
              textAlign: 'center'
            }}>
              Login as {selectedRole.charAt(0).toUpperCase() + selectedRole.slice(1)}
            </h2>
          )}
        </div>
        
        {!selectedRole ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
            <RoleSelector onRoleSelect={handleRoleSelect} hideTitle={true} />
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
            <LoginForm 
              role={selectedRole} 
              onLogin={handleLogin} 
              onBack={handleBack}
              hideTitle={true}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default Login;