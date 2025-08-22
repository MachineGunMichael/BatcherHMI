import React, { useState } from 'react';
import { Box, TextField, IconButton, CircularProgress} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';

const ChatInput = ({ onSendMessage, disabled }) => {
    const [message, setMessage] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        if (message.trim() && !disabled) {
        onSendMessage(message);
        setMessage('');
        }
    };

    return (
        <Box
        component="form"
        onSubmit={handleSubmit}
        sx={{
            p: 2,
            display: 'flex',
            alignItems: 'center',
            borderTop: '1px solid',
            borderTopColor: 'divider',
        }}
        >
        <TextField
            fullWidth
            variant="outlined"
            placeholder="Ask a question about machine setup or settings..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={disabled}
            color="secondary"
            sx={{ mr: 1 }}
            autoComplete="off"
        />
        <IconButton 
            color="secondary" 
            type="submit" 
            disabled={disabled || !message.trim()}
        >
            {disabled ? <CircularProgress size={24} color="secondary" /> : <SendIcon />}
        </IconButton>
        </Box>
    );
};

export default ChatInput;
