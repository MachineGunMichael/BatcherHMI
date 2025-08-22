import { useState, useCallback, useEffect, useRef } from 'react';
import { getAgentResponse, getSimulationResults, getConversationHistory } from '../services/agentService';

const useAgentChat = () => {
  // Chat state
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  
  // Simulation data
  const [simulationData, setSimulationData] = useState(null);
  const [simulationLoading, setSimulationLoading] = useState(false);
  
  // Ref for chat scrolling
  const chatEndRef = useRef(null);
  
  // Initialize chat with greeting message
  useEffect(() => {
    setMessages([
      { 
        id: 1, 
        role: 'assistant', 
        content: 'Hello! I\'m your Planning Assistant. I can help you optimize machine settings, gate assignments, and weight ranges. What would you like to know?' 
      }
    ]);
    
    setSuggestions([
      'How do I optimize for minimum give-away?',
      'What settings should I use for Product A?',
      'Show me throughput predictions',
      'How can I reduce rejects?'
    ]);
    
    // Optional: Load conversation history from backend
    // loadConversationHistory();
  }, []);
  
  // Load conversation history from the backend
  const loadConversationHistory = useCallback(async () => {
    try {
      setLoading(true);
      const history = await getConversationHistory();
      if (history && history.messages && history.messages.length > 0) {
        setMessages(history.messages);
      }
      if (history && history.suggestions && history.suggestions.length > 0) {
        setSuggestions(history.suggestions);
      }
    } catch (err) {
      console.error('Failed to load conversation history:', err);
      setError('Failed to load conversation history');
    } finally {
      setLoading(false);
    }
  }, []);
  
  // Send a message to the agent and get a response
  const sendMessage = useCallback(async (message) => {
    if (!message.trim()) return;
    
    // Add user message to chat
    const userMessage = { id: Date.now(), role: 'user', content: message };
    setMessages(prev => [...prev, userMessage]);
    
    // Reset error state
    setError(null);
    
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
        try {
          const simResults = await getSimulationResults(response.simulationId);
          setSimulationData(simResults);
        } catch (simError) {
          console.error('Error fetching simulation results:', simError);
          setError('Failed to load simulation results');
        } finally {
          setSimulationLoading(false);
        }
      }
      
      // Update suggestions based on context
      if (response.suggestions && response.suggestions.length > 0) {
        setSuggestions(response.suggestions);
      }
      
      return true;
    } catch (err) {
      console.error('Error getting agent response:', err);
      setError(err.message || 'Failed to get a response from the assistant');
      
      // Add error message to chat
      setMessages(prev => [
        ...prev,
        { 
          id: Date.now(), 
          role: 'assistant', 
          content: 'Sorry, I encountered an error while processing your request. Please try again.' 
        }
      ]);
      
      return false;
    } finally {
      setLoading(false);
    }
  }, []);
  
  // Clear chat history
  const clearChat = useCallback(() => {
    setMessages([
      { 
        id: Date.now(), 
        role: 'assistant', 
        content: 'How can I help you today?' 
      }
    ]);
    setSimulationData(null);
    setError(null);
  }, []);
  
  return {
    messages,
    loading,
    error,
    suggestions,
    simulationData,
    simulationLoading,
    chatEndRef,
    sendMessage,
    clearChat,
    loadConversationHistory
  };
};

export default useAgentChat;
