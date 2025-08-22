import React, { forwardRef } from 'react';
import { Box, Typography, CircularProgress, useTheme } from '@mui/material';
import ChatMessage from './ChatMessage';
import { tokens } from '../../theme';

const ChatHistory = forwardRef(({ messages, loading }, ref) => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  
  return (
    <Box
      sx={{
        p: 2,
        flexGrow: 1,
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
        // Ensure the Box doesn't overflow its container and borders are visible
        height: '100%',
        boxSizing: 'border-box',
        // Add explicit borders for visibility
        borderRadius: '4px',
        // Add subtle background for better visual separation
        backgroundColor: theme.palette.mode === 'dark' ? 
          colors.primary[200] : 
          colors.primary[100],
      }}
    >
      {messages.map((message) => (
        <ChatMessage key={message.id} message={message} />
      ))}
      
      {loading && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, my: 1 }}>
          <CircularProgress size={20} />
          <Typography variant="body2" color="text.secondary">
            Planning Assistant is thinking...
          </Typography>
        </Box>
      )}
      
      <div ref={ref} style={{ height: '1px' }} />
    </Box>
  );
});

ChatHistory.displayName = 'ChatHistory';

export default ChatHistory;
