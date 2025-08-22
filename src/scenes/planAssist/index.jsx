import React, { useState, useEffect, useRef } from "react";
import {
  Box,
  Typography,
  Paper,
  CircularProgress,
  Divider,
  useTheme,
} from "@mui/material";
import Header from "../../components/Header";
import ChatHistory from "../../components/agent/ChatHistory";
import ChatInput from "../../components/agent/ChatInput";
import SimResultCard from "../../components/agent/SimResultCard";
import SimulationVisualizer from "../../components/agent/SimulationVisualizer";
import SuggestionChips from "../../components/agent/SuggestionChips";
import { getAgentResponse, getSimulationResults } from "../../services/agentService";
import { tokens } from "../../theme";
import { useAppContext } from "../../context/AppContext";


const PlanAssist = () => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  const chatEndRef = useRef(null);
  
  // Chat state
  const [messages, setMessages] = useState([
    { id: 1, role: 'assistant', content: 'Hello! I\'m your Planning Assistant. I can help you optimize machine settings, gate assignments, and weight ranges. What would you like to know?' }
  ]);
  const [loading, setLoading] = useState(false);
  
  // Simulation results state
  const [simulationData, setSimulationData] = useState(null);
  const [simulationLoading, setSimulationLoading] = useState(false);
  
  // Suggestions based on current context
  const [suggestions, setSuggestions] = useState([
    'How do I optimize for minimum give-away?',
    'What settings should I use for Product A?',
    'Show me throughput predictions',
    'How can I reduce rejects?'
  ]);

  // Get context with more explicit error handling and logging
  const context = useAppContext();
  

  // Scroll to bottom of chat when new messages arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle user message submission
  const handleSendMessage = async (message) => {
    if (!message.trim()) return;
    
    // Add user message to chat
    const userMessage = { id: Date.now(), role: 'user', content: message };
    setMessages(prev => [...prev, userMessage]);
    
    // Show loading state
    setLoading(true);
    
    try {
      // Get response from agent service
      const response = await getAgentResponse(message);
      
      // Add assistant response to chat
      setMessages(prev => [
        ...prev, 
        { id: Date.now(), role: 'assistant', content: response.message }
      ]);
      
      // If simulation results are available, fetch and display them
      if (response.hasSimulationResults) {
        setSimulationLoading(true);
        const simResults = await getSimulationResults(response.simulationId);
        setSimulationData(simResults);
        setSimulationLoading(false);
      }
      
      // Update suggestions based on context
      if (response.suggestions && response.suggestions.length > 0) {
        setSuggestions(response.suggestions);
      }
    } catch (error) {
      console.error('Error getting response:', error);
      setMessages(prev => [
        ...prev,
        { id: Date.now(), role: 'assistant', content: 'Sorry, I encountered an error while processing your request. Please try again.' }
      ]);
    } finally {
      setLoading(false);
    }
  };

  // Handle suggestion click
  const handleSuggestionClick = (suggestion) => {
    handleSendMessage(suggestion);
  };

  return (
    <Box 
      m="20px" 
      height="calc(100vh - 200px)" 
      maxHeight="calc(100vh - 200px)" 
      sx={{ 
        overflow: "visible",
        display: "flex",
        flexDirection: "column"
      }}
    > 
      {/* Header section aligned with sidebar logo */}
      <Box 
        display="flex" 
        justifyContent="space-between" 
        alignItems="center" 
        mb="20px" 
        sx={{ m: "0px 0 0 0" }}
      >
        <Header title="PlanAssist" subtitle="Production planner assistant" />
      </Box>
      
      {/* Main content - takes remaining height */}
      <Box 
        sx={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0, // Important for proper flex behavior
          overflow: 'hidden'
        }}
      >
        {/* Chat and simulation container */}
        <Box sx={{ 
          display: 'flex', 
          gap: 1.5, // Slightly reduced gap
          height: '100%',
          overflow: 'hidden',
          // Add padding to ensure child elements don't touch the edges
          p: 0.5,
        }}>
          {/* Left side - Chat */}
          <Paper 
            elevation={3} 
            sx={{ 
              flexGrow: 1,
              display: 'flex',
              flexDirection: 'column',
              maxWidth: '60%',
              height: '100%',
              overflow: 'hidden',
              // Ensure borders are visible
              border: `1px solid ${theme.palette.mode === 'dark' ? colors.primary[200] : colors.grey[300]}`,
              borderRadius: '8px',
              // Add some margin to prevent being cut off at edges
              m: 0.5,
              // Ensure proper box sizing
              boxSizing: 'border-box',
            }}
          >
            {/* Chat messages area - scrollable */}
            <Box sx={{ flexGrow: 1, overflow: 'auto' }}>
              <ChatHistory 
                messages={messages} 
                loading={loading} 
                ref={chatEndRef}
              />
            </Box>
            
            <Divider />
            
            {/* Fixed height for suggestions */}
            <Box sx={{ flexShrink: 0 }}>
              <SuggestionChips 
                suggestions={suggestions} 
                onSuggestionClick={handleSuggestionClick} 
              />
            </Box>
            
            {/* Fixed height for input */}
            <Box sx={{ flexShrink: 0 }}>
              <ChatInput 
                onSendMessage={handleSendMessage} 
                disabled={loading} 
              />
            </Box>
          </Paper>
          
          {/* Right side - Simulation Results & Visualizations */}
          <Paper 
            elevation={3} 
            sx={{ 
              width: '40%',
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              overflow: 'hidden',
              // Ensure borders are visible
              border: `1px solid ${theme.palette.mode === 'dark' ? colors.primary[200] : colors.grey[300]}`,
              borderRadius: '8px',
              // Add some margin to prevent being cut off at edges
              m: 0.5,
              // Ensure proper box sizing
              boxSizing: 'border-box',
            }}
          >
            {/* Fixed height header */}
            <Typography 
              variant="h4" 
              sx={{ 
                padding: 1.5, 
                borderBottom: `1px solid ${theme.palette.divider}`,
                flexShrink: 0
              }}
            >
              Simulation Results
            </Typography>
            
            {/* Scrollable content area */}
            <Box sx={{ 
              flexGrow: 1, 
              padding: 2, 
              overflow: 'auto' 
            }}>
              {simulationLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                  <CircularProgress />
                </Box>
              ) : simulationData ? (
                <>
                  <SimResultCard data={simulationData} />
                  <Box sx={{ height: 300, marginTop: 2 }}>
                    <SimulationVisualizer data={simulationData} />
                  </Box>
                </>
              ) : (
                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                  <Typography variant="body1" color="textSecondary">
                    Ask a question to get simulation results
                  </Typography>
                </Box>
              )}
            </Box>
          </Paper>
        </Box>
      </Box>
    </Box>
  );
};

export default PlanAssist;