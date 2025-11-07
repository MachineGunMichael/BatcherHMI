"""
Simple Weight-Based Gate Assignment Algorithm

Mimics the C# algorithm logic:
1. Check piece weight against recipe bounds on each gate
2. Find all eligible gates (where weight falls within min/max bounds)
3. Randomly select one eligible gate
4. If no eligible gates, send to reject gate (gate 0)
"""

import random
from typing import Dict, List, Optional


class AssignmentAlgorithm:
    """
    Simple weight-based gate assignment algorithm.
    
    Assigns pieces to gates based on:
    - Piece weight
    - Recipe weight bounds (piece_min, piece_max) on each gate
    - Random selection among eligible gates
    """
    
    def __init__(self):
        self.current_assignments = {}  # gate -> recipe info
        
    def update_assignments(self, assignments: List[Dict]):
        """
        Update the current gate assignments from program data.
        
        Args:
            assignments: List of dicts with keys:
                - gate (int)
                - recipe_name (str)
                - piece_min (float): Min piece weight in grams
                - piece_max (float): Max piece weight in grams
                - batch_min (float): Min batch weight in grams
                - batch_max (float): Max batch weight in grams
                - batch_count_type (str): 'exact', 'min', or None
                - batch_count_value (int): Target count or None
        """
        self.current_assignments = {}
        
        for assign in assignments:
            gate = int(assign['gate'])
            self.current_assignments[gate] = {
                'recipe_name': assign['recipe_name'],
                'piece_min': float(assign.get('piece_min', 0)),
                'piece_max': float(assign.get('piece_max', 999999)),
                'batch_min': float(assign.get('batch_min', 0)),
                'batch_max': float(assign.get('batch_max', 999999)),
                'batch_count_type': assign.get('batch_count_type'),
                'batch_count_value': assign.get('batch_count_value')
            }
    
    def assign_piece(self, weight_g: float) -> int:
        """
        Assign a piece to a gate based on its weight.
        
        Algorithm:
        1. Check weight against each gate's recipe bounds
        2. Collect all eligible gates (weight within piece_min and piece_max)
        3. Randomly select one eligible gate
        4. If no eligible gates, return 0 (reject gate)
        
        Args:
            weight_g: Piece weight in grams
            
        Returns:
            gate: Gate number (0 = reject, 1-8 = production gates)
        """
        eligible_gates = []
        
        # Check each gate's recipe bounds
        for gate, recipe in self.current_assignments.items():
            piece_min = recipe['piece_min']
            piece_max = recipe['piece_max']
            
            # Check if weight falls within this recipe's piece bounds
            if piece_min <= weight_g <= piece_max:
                eligible_gates.append(gate)
        
        # If no eligible gates, send to reject (gate 0)
        if not eligible_gates:
            return 0
        
        # Randomly select one eligible gate
        return random.choice(eligible_gates)
    
    def get_current_recipes(self) -> Dict[int, str]:
        """
        Get current recipe assignments for display/logging.
        
        Returns:
            Dict mapping gate number to recipe name
        """
        return {
            gate: recipe['recipe_name'] 
            for gate, recipe in self.current_assignments.items()
        }
    
    def get_recipe_info(self, gate: int) -> Optional[Dict]:
        """
        Get full recipe info for a specific gate.
        
        Args:
            gate: Gate number
            
        Returns:
            Recipe info dict or None if gate not assigned
        """
        return self.current_assignments.get(gate)

