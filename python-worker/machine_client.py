"""
machine_client.py
Client for communicating with the backend machine state API
"""

import time
import requests
import json
from typing import Dict, List, Optional

class MachineStateClient:
    """Client for polling and updating machine state from backend"""
    
    def __init__(self, base_url: str = "http://localhost:5001"):
        self.base_url = base_url
        self.api_url = f"{base_url}/api/machine"
        self.last_state = None
        self.poll_interval = 1.0  # seconds
        
    def get_state(self) -> Optional[Dict]:
        """
        Get current machine state from backend
        Returns: {
            'state': 'idle'|'running'|'paused'|'transitioning',
            'currentProgramId': int or None,
            'activeRecipes': [...],
            'programStartRecipes': [...],
            'lastUpdated': str
        }
        """
        try:
            response = requests.get(f"{self.api_url}/state", timeout=2)
            response.raise_for_status()
            state = response.json()
            self.last_state = state
            return state
        except requests.exceptions.RequestException as e:
            print(f"[MachineClient] Error fetching state: {e}")
            return self.last_state  # Return cached state on error
    
    def get_active_recipes(self) -> List[Dict]:
        """Get active recipes from backend"""
        try:
            response = requests.get(f"{self.api_url}/recipes", timeout=2)
            response.raise_for_status()
            data = response.json()
            return data.get('recipes', [])
        except requests.exceptions.RequestException as e:
            print(f"[MachineClient] Error fetching recipes: {e}")
            return []
    
    def notify_transition_complete(self, program_id: int, action: str):
        """
        Notify backend that batch completion is done during transition
        Args:
            program_id: The program that finished
            action: 'stop' or 'recipe_change'
        """
        try:
            payload = {
                'programId': program_id,
                'action': action
            }
            response = requests.post(
                f"{self.api_url}/transition-complete",
                json=payload,
                timeout=5
            )
            response.raise_for_status()
            result = response.json()
            print(f"[MachineClient] Transition complete acknowledged: {result}")
            return result
        except requests.exceptions.RequestException as e:
            print(f"[MachineClient] Error notifying transition complete: {e}")
            return None
    
    def wait_for_state_change(self, timeout: float = 30) -> Optional[Dict]:
        """
        Poll for state changes
        Returns new state when it differs from last_state
        """
        start_time = time.time()
        while time.time() - start_time < timeout:
            current_state = self.get_state()
            if current_state and self.last_state:
                if current_state['state'] != self.last_state['state']:
                    print(f"[MachineClient] State changed: {self.last_state['state']} → {current_state['state']}")
                    return current_state
                    
                # Also check for recipe changes
                if current_state['activeRecipes'] != self.last_state['activeRecipes']:
                    print(f"[MachineClient] Active recipes changed")
                    return current_state
                    
            time.sleep(self.poll_interval)
        
        return None
    
    def poll(self) -> Dict:
        """
        Single poll of machine state
        Returns current state
        """
        return self.get_state()
    
    def is_connected(self) -> bool:
        """Check if backend is reachable"""
        try:
            response = requests.get(f"{self.base_url}/", timeout=2)
            return response.status_code == 200
        except:
            return False
    
    def recipes_to_gate_map(self, recipes: List[Dict]) -> Dict[int, Dict]:
        """
        Convert backend recipes format to gate -> recipe map
        Input format: [
            {
                'recipeName': 'R_10_999_...',
                'gates': [1, 2],
                'params': {...}
            }
        ]
        Output format: {
            1: {'recipeName': 'R_10_999_...', 'params': {...}},
            2: {'recipeName': 'R_10_999_...', 'params': {...}},
            ...
        }
        """
        gate_map = {}
        for recipe in recipes:
            recipe_name = recipe['recipeName']
            params = recipe['params']
            for gate in recipe['gates']:
                gate_map[gate] = {
                    'recipeName': recipe_name,
                    'params': params
                }
        
        return gate_map
    
    def compare_recipes(self, recipes1: List[Dict], recipes2: List[Dict]) -> Dict:
        """
        Compare two recipe lists and return which gates changed
        Returns: {
            'changed': bool,
            'gates_changed': [1, 2, ...],
            'gates_added': [3, ...],
            'gates_removed': [4, ...],
        }
        """
        map1 = self.recipes_to_gate_map(recipes1)
        map2 = self.recipes_to_gate_map(recipes2)
        
        gates1 = set(map1.keys())
        gates2 = set(map2.keys())
        
        gates_added = list(gates2 - gates1)
        gates_removed = list(gates1 - gates2)
        
        # Check for recipe changes on same gates
        gates_changed = []
        for gate in gates1 & gates2:
            if map1[gate]['recipeName'] != map2[gate]['recipeName']:
                gates_changed.append(gate)
        
        return {
            'changed': len(gates_changed) > 0 or len(gates_added) > 0 or len(gates_removed) > 0,
            'gates_changed': gates_changed,
            'gates_added': gates_added,
            'gates_removed': gates_removed,
        }

