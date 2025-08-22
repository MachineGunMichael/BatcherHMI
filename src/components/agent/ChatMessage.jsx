import React from 'react';
import { Box, Paper, Typography, Avatar, useTheme } from '@mui/material';
import AgentIcon from '@mui/icons-material/PrecisionManufacturing';
import PersonIcon from '@mui/icons-material/Person';
import { tokens } from "../../theme";

const ChatMessage = ({ message }) => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  const isAssistant = message.role === 'assistant';
  const isDarkMode = theme.palette.mode === 'dark';
  
  // Define icon color based on theme mode
  const iconColor = isDarkMode ? colors.primary[900] : colors.primary[100];
  
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        mb: 2,
        flexDirection: isAssistant ? 'row' : 'row-reverse',
      }}
    >
      <Avatar
        sx={{
          bgcolor: isAssistant ? colors.tealAccent[500] : colors.redAccent[500],
          mr: isAssistant ? 1 : 0,
          ml: isAssistant ? 0 : 1,
        }}
      >
        {isAssistant ? 
          <AgentIcon sx={{ color: iconColor }} /> : 
          <PersonIcon sx={{ color: iconColor }} />
        }
      </Avatar>
      
      <Paper
        elevation={1}
        sx={{
          p: 2,
          maxWidth: '70%',
          backgroundColor: isAssistant 
            ? colors.primary[300]
            : colors.primary[200],
          color: isAssistant 
            ? theme.palette.text.primary 
            : theme.palette.primary.contrastText,
          borderRadius: '16px',
          borderTopLeftRadius: isAssistant ? 0 : '16px',
          borderTopRightRadius: isAssistant ? '16px' : 0,
        }}
      >
        <Typography variant="body1">
          {message.content}
        </Typography>
      </Paper>
    </Box>
  );
};

export default ChatMessage;
