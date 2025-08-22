import React from 'react';
import { Box, Chip, useTheme } from '@mui/material';
import { tokens } from '../../theme';

const SuggestionChips = ({ 
  suggestions, 
  onSuggestionClick,
}) => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);

  return (
    <Box 
      sx={{ 
        display: 'flex', 
        flexWrap: 'wrap', 
        p: 1.5,
        gap: 1,
        borderTop: '1px solid',
        borderColor: 'divider'
      }}
    >
      {suggestions.map((suggestion, index) => (
        <Chip
          key={index}
          label={suggestion}
          onClick={() => onSuggestionClick(suggestion)}
          // Remove any default Material UI styling behaviors
          variant="filled" // explicitly set to filled (default)
          
          sx={{
            // Text color
            color: theme.palette.mode === 'dark' ? colors.primary[800] : colors.primary[700],
            
            // Background color
            backgroundColor: theme.palette.mode === 'dark' ? colors.primary[300] : colors.primary[100],
            
            // Border styling - needs !important to override Material UI defaults
            border: `1px solid ${theme.palette.mode === 'dark' ? colors.primary[300] : colors.primary[500]} !important`,
            
            cursor: 'pointer',
            
            // Explicitly define the hover state
            '&:hover': {
              backgroundColor: theme.palette.mode === 'dark' ? 
                colors.tealAccent[400] : colors.tealAccent[200],
              color: theme.palette.mode === 'dark' ? 
                colors.grey[900] : colors.primary[100],
              // Use !important to ensure our border color is applied
              border: `1px solid ${theme.palette.mode === 'dark' ? colors.tealAccent[400] : colors.tealAccent[600]} !important`,
            },
            
            // Add active state for when clicking
            '&:active': {
              backgroundColor: theme.palette.mode === 'dark' ? 
                colors.tealAccent[700] : colors.tealAccent[300],
              transform: 'scale(0.98)',
            },
            
            transition: 'all 0.2s',
            fontWeight: 500,
          }}
        />
      ))}
    </Box>
  );
};

export default SuggestionChips;
