// src/components/MachineControls.jsx
// Shared machine controls component for Dashboard and Setup pages

import React from "react";
import { Box, Typography, Button, useTheme } from "@mui/material";
import { tokens } from "../theme";
import useMachineState from "../hooks/useMachineState";
import { useAppContext } from "../context/AppContext";
import api from "../services/api";

/**
 * MachineControls component
 * @param {Object} props
 * @param {string} props.layout - 'vertical' (Dashboard) or 'horizontal' (Setup)
 * @param {number} props.activeRecipesCount - Number of active recipes (for disabling Start)
 * @param {Function} props.onStop - Optional callback after stop (for Setup to move recipes back)
 * @param {Object} props.styles - Custom styling options
 * @param {string} props.styles.titleVariant - Typography variant for title (default: 'h4')
 * @param {string} props.styles.buttonHeight - Button height (default: '40px')
 * @param {string} props.styles.buttonFontSize - Button font size (default: '1.0rem')
 * @param {Object} props.styles.stateBadge - State badge styling
 * @param {number} props.styles.buttonGap - Gap between buttons
 */
const MachineControls = ({ 
  layout = 'vertical', 
  activeRecipesCount = 0, 
  onStop,
  styles = {},
  showTitle = true
}) => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  const isDark = theme.palette.mode === "dark";
  
  const { state: machineState, activeRecipes, isConnected } = useMachineState();
  const { assignedRecipes, setAssignedRecipes } = useAppContext();
  
  // Use prop or hook for recipe count
  const recipeCount = activeRecipesCount || activeRecipes?.length || 0;
  
  // Default styles with overrides
  const {
    titleVariant = 'h4',
    buttonHeight = '40px',
    buttonFontSize = '1.0rem',
    buttonGap = layout === 'vertical' ? 1.5 : 3,
    stateBadge = {},
    recipesTextVariant = 'body2',
  } = styles;
  
  // State badge defaults
  const {
    px: badgePx = 2,
    py: badgePy = 0.5,
    borderRadius: badgeBorderRadius = 0.5,
    fontSize: badgeFontSize = '0.875rem',
  } = stateBadge;

  // Machine control handlers
  const handleStart = async () => {
    if (recipeCount === 0) {
      console.error('Cannot start: No active recipes');
      return;
    }
    if (machineState === "running") {
      console.error('Machine is already running');
      return;
    }
    
    try {
      console.log('[MachineControls] Starting machine...');
      const response = await api.post('/machine/control', { action: 'start' });
      console.log('[MachineControls] Machine started:', response.data);
    } catch (error) {
      console.error('[MachineControls] Failed to start machine:', error);
    }
  };

  const handlePause = async () => {
    if (machineState !== "running") {
      console.error('Cannot pause: Machine is not running');
      return;
    }
    
    try {
      console.log('[MachineControls] Pausing machine...');
      const response = await api.post('/machine/control', { action: 'pause' });
      console.log('[MachineControls] Machine paused:', response.data);
    } catch (error) {
      console.error('[MachineControls] Failed to pause machine:', error);
    }
  };

  const handleStop = async () => {
    if (machineState === "idle") {
      console.error('Machine is already stopped');
      return;
    }
    
    try {
      console.log('[MachineControls] Stopping machine...');
      
      // Save current active recipes before stopping
      const recipesToRestore = [...(activeRecipes || [])];
      
      const response = await api.post('/machine/control', { action: 'stop' });
      console.log('[MachineControls] Machine stopped:', response.data);
      
      // Call optional callback with the recipes that were active (for Setup to restore them)
      if (onStop) {
        onStop(recipesToRestore);
      } else {
        // Default behavior: move active recipes back to assigned recipes via context
        // This ensures consistent behavior across Dashboard and Setup pages
        const existingRecipeNames = new Set(assignedRecipes.map(r => r.recipeName));
        const uniqueRecipesToRestore = recipesToRestore.filter(r => !existingRecipeNames.has(r.recipeName));
        setAssignedRecipes([...assignedRecipes, ...uniqueRecipesToRestore]);
        console.log('[MachineControls] Moved', uniqueRecipesToRestore.length, 'recipes back to assigned');
      }
    } catch (error) {
      console.error('[MachineControls] Failed to stop machine:', error);
    }
  };

  // Get state display info
  const getStateInfo = () => {
    switch (machineState) {
      case 'running':
        return { label: 'RUNNING', color: colors.tealAccent[500], text: 'Machine Running' };
      case 'paused':
        return { label: 'PAUSED', color: colors.orangeAccent[500], text: 'Machine Halted' };
      case 'transitioning':
        return { label: 'TRANSITIONING', color: colors.purpleAccent[500], text: 'Transitioning' };
      default:
        return { label: 'IDLE', color: colors.redAccent[500], text: 'Machine Idle' };
    }
  };

  const stateInfo = getStateInfo();

  const isVertical = layout === 'vertical';
  
  // Button styles with customizable dimensions
  const buttonBaseStyle = {
    color: '#fff',
    height: buttonHeight,
    fontSize: buttonFontSize,
    borderRadius: 1,
    fontWeight: 'bold',
  };

  return (
    <Box 
      sx={{ 
        display: 'flex', 
        flexDirection: 'column',
        height: '100%',
      }}
    >
      {/* Title */}
      {showTitle && (
        <Typography
          variant={titleVariant}
          fontWeight="bold"
          sx={{ mb: 2, color: colors.tealAccent[500] }}
        >
          Machine Controls
        </Typography>
      )}

      {/* Machine State Indicator */}
      <Box sx={{ mb: 2 }}>
        <Box display="flex" alignItems="center" gap={1.5} flexWrap="wrap">
          {/* State Badge */}
          <Box
            sx={{
              backgroundColor: stateInfo.color,
              color: '#fff',
              px: badgePx,
              py: badgePy,
              borderRadius: badgeBorderRadius,
              fontWeight: 'bold',
              fontSize: badgeFontSize,
            }}
          >
            {stateInfo.label}
          </Box>
          
          {/* Recipes Count */}
          <Typography 
            variant={recipesTextVariant}
            sx={{ 
              color: isDark ? '#fff' : '#000',
            }}
          >
            {recipeCount} {recipeCount === 1 ? 'recipe' : 'recipes'} active
          </Typography>
          
          {/* Offline Indicator */}
          {!isConnected && (
            <Box
              sx={{
                backgroundColor: colors.redAccent[600],
                color: '#fff',
                px: badgePx * 0.75,
                py: badgePy,
                borderRadius: badgeBorderRadius,
                fontWeight: 'bold',
                fontSize: parseFloat(badgeFontSize) * 0.85 + 'rem',
              }}
            >
              OFFLINE
            </Box>
          )}
        </Box>
      </Box>

      {/* Control Buttons */}
      <Box 
        display="flex" 
        flexDirection={isVertical ? 'column' : 'row'}
        gap={buttonGap}
        sx={{ flex: isVertical ? 1 : 'none' }}
      >
        {/* Start Button */}
        <Button
          variant="contained"
          onClick={handleStart}
          disabled={recipeCount === 0 || machineState === "running" || machineState === "transitioning"}
          sx={{
            ...buttonBaseStyle,
            flex: isVertical ? 'none' : 1,
            width: isVertical ? '100%' : 'auto',
            backgroundColor: colors.tealAccent[500],
            '&:hover': {
              backgroundColor: colors.tealAccent[600],
            },
            '&.Mui-disabled': {
              backgroundColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)',
              color: isDark ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.26)',
            },
          }}
        >
          START
        </Button>

        {/* Pause Button */}
        <Button
          variant="contained"
          onClick={handlePause}
          disabled={machineState !== "running"}
          sx={{
            ...buttonBaseStyle,
            flex: isVertical ? 'none' : 1,
            width: isVertical ? '100%' : 'auto',
            backgroundColor: colors.orangeAccent[500],
            '&:hover': {
              backgroundColor: colors.orangeAccent[600],
            },
            '&.Mui-disabled': {
              backgroundColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)',
              color: isDark ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.26)',
            },
          }}
        >
          PAUSE
        </Button>

        {/* Stop Button */}
        <Button
          variant="contained"
          onClick={handleStop}
          disabled={machineState === "idle"}
          sx={{
            ...buttonBaseStyle,
            flex: isVertical ? 'none' : 1,
            width: isVertical ? '100%' : 'auto',
            backgroundColor: colors.redAccent[500],
            '&:hover': {
              backgroundColor: colors.redAccent[600],
            },
            '&.Mui-disabled': {
              backgroundColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)',
              color: isDark ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.26)',
            },
          }}
        >
          STOP
        </Button>
      </Box>
    </Box>
  );
};

export default MachineControls;

