const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001';

// Send user message to the agent and get a response
export const getAgentResponse = async (message) => {
  try {
    const response = await fetch(`${API_URL}/api/agent/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify({ message }),
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });

    if (!response.ok) {
      throw new Error(`Error ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Agent service error:', error);
    throw error;
  }
};

// Get simulation results by ID
export const getSimulationResults = async (simulationId) => {
  try {
    const response = await fetch(`${API_URL}/api/simulations/${simulationId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      },
      signal: AbortSignal.timeout(5000) // 5 second timeout
    });

    if (!response.ok) {
      throw new Error(`Error ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Simulation service error:', error);
    throw error;
  }
};

// Get conversation history
export const getConversationHistory = async () => {
  try {
    const response = await fetch(`${API_URL}/api/agent/history`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });

    if (!response.ok) {
      throw new Error(`Error ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('History service error:', error);
    throw error;
  }
};

// Additional methods as needed
