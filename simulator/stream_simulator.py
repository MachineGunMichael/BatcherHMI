#!/usr/bin/env python3
"""
Real-Time Data Stream Simulator

Simulates the C# algorithm by streaming piece data to the server in real-time.
Mimics actual production timing with configurable speed multipliers.
"""

import os
import json
import time
import requests
from datetime import datetime, timedelta
from typing import List, Dict, Optional
import argparse
import sys

# Add parent directory to path to import assignment algorithm
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "python-worker"))
from assignment_algorithm import AssignmentAlgorithm  # type: ignore

# Configuration
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
PIECES_JSON = os.path.join(DATA_DIR, "pieces_stream.json")
ASSIGNMENTS_JSON = os.path.join(DATA_DIR, "program_assignments.json")

# Default server endpoint
DEFAULT_SERVER_URL = "http://localhost:5001"
INGEST_ENDPOINT = "/api/ingest/piece"

class SimulatorConfig:
    """Simulator configuration"""
    def __init__(
        self,
        pieces_per_second: float = 1.0,
        server_url: str = DEFAULT_SERVER_URL,
        start_offset: int = 0,
        max_pieces: Optional[int] = None,
        batch_size: int = 1
    ):
        self.pieces_per_second = pieces_per_second
        self.server_url = server_url
        self.start_offset = start_offset
        self.max_pieces = max_pieces
        self.batch_size = batch_size

class DataStreamSimulator:
    """Simulates real-time piece data streaming"""
    
    def __init__(self, config: SimulatorConfig):
        self.config = config
        self.pieces = []
        self.assignments = []
        self.current_assignment_idx = 0
        self.current_program_id = None
        self.pieces_sent = 0
        self.start_time = None
        self.session = requests.Session()
        self.assignment_algorithm = AssignmentAlgorithm()
        
    def load_data(self):
        """Load pieces and assignments from JSON files"""
        print(f"📂 Loading data from {DATA_DIR}...")
        
        # Load pieces
        with open(PIECES_JSON, 'r') as f:
            data = json.load(f)
            self.pieces = data['pieces']
            print(f"   ✓ Loaded {len(self.pieces):,} pieces")
            print(f"   ✓ Time range: {data['metadata']['start_time']} to {data['metadata']['end_time']}")
            print(f"   ✓ Duration: {data['metadata']['duration_seconds'] / 3600:.1f} hours")
        
        # Load assignments
        with open(ASSIGNMENTS_JSON, 'r') as f:
            data = json.load(f)
            self.assignments = data['assignments']
            print(f"   ✓ Loaded {len(self.assignments)} program configurations")
            
            # Initialize with first program's assignments
            if self.assignments:
                self._apply_program_assignment(0)
                print(f"   ✓ Initialized with program {self.current_program_id}")
        
        # Apply start offset if specified
        if self.config.start_offset > 0:
            self.pieces = self.pieces[self.config.start_offset:]
            print(f"   ✓ Starting from piece #{self.config.start_offset + 1}")
        
        # Apply max pieces limit if specified
        if self.config.max_pieces:
            self.pieces = self.pieces[:self.config.max_pieces]
            print(f"   ✓ Limited to {self.config.max_pieces:,} pieces")
    
    def _apply_program_assignment(self, index: int):
        """Apply a program assignment to the algorithm"""
        assignment = self.assignments[index]
        self.current_program_id = assignment['program_id']
        self.current_assignment_idx = index
        
        # Parse recipe names and extract bounds
        algorithm_assignments = []
        for gate_str, recipe_name in assignment['gate_assignments'].items():
            gate = int(gate_str)
            
            # Parse recipe name: R_pieceMin_pieceMax_batchMin_batchMax_countType_countVal
            try:
                parts = recipe_name.split('_')
                if parts[0] != 'R' or len(parts) < 7:
                    continue
                
                piece_min = int(parts[1])
                piece_max = int(parts[2])
                batch_min = int(parts[3])
                batch_max = int(parts[4])
                count_type = None if parts[5] == 'NA' else parts[5]
                count_val = None if parts[6] in ('NA', '0', '') else int(parts[6])
                
                algorithm_assignments.append({
                    'gate': gate,
                    'recipe_name': recipe_name,
                    'piece_min': piece_min,
                    'piece_max': piece_max,
                    'batch_min': batch_min,
                    'batch_max': batch_max,
                    'batch_count_type': count_type,
                    'batch_count_value': count_val
                })
            except Exception as e:
                print(f"⚠️  Failed to parse recipe {recipe_name}: {e}")
                continue
        
        self.assignment_algorithm.update_assignments(algorithm_assignments)
    
    def send_piece(self, piece: Dict) -> bool:
        """Send a single piece to the server"""
        try:
            weight_g = piece['weight_g']
            
            # Use assignment algorithm to determine gate
            assigned_gate = self.assignment_algorithm.assign_piece(weight_g)
            
            # Prepare payload - NO timestamp (backend uses current time for live mode)
            payload = {
                "weight_g": weight_g,
                "gate": assigned_gate
            }
            
            # Add PLC authentication header
            headers = {
                "x-plc-secret": os.getenv("PLC_SHARED_SECRET", "dev-plc-secret")
            }
            
            response = self.session.post(
                f"{self.config.server_url}{INGEST_ENDPOINT}",
                json=payload,
                headers=headers,
                timeout=5
            )
            
            if response.status_code != 200:
                print(f"⚠️  Server returned {response.status_code}: {response.text}")
                return False
            
            return True
            
        except requests.exceptions.RequestException as e:
            print(f"❌ Error sending piece: {e}")
            return False
    
    def send_batch(self, pieces: List[Dict]) -> int:
        """Send a batch of pieces to the server"""
        sent = 0
        for piece in pieces:
            if self.send_piece(piece):
                sent += 1
        return sent
    
    def get_current_assignment(self, piece_timestamp: str) -> Optional[Dict]:
        """Get the active assignment for a given timestamp"""
        # Find the most recent assignment before or at this timestamp
        piece_time = datetime.fromisoformat(piece_timestamp)
        
        for i in range(len(self.assignments) - 1, -1, -1):
            assign_time = datetime.fromisoformat(self.assignments[i]['timestamp'])
            if assign_time <= piece_time:
                return self.assignments[i]
        
        return None
    
    def print_stats(self):
        """Print current simulation statistics"""
        if not self.start_time:
            return
        
        elapsed = time.time() - self.start_time
        rate = self.pieces_sent / elapsed if elapsed > 0 else 0
        progress = (self.pieces_sent / len(self.pieces)) * 100 if self.pieces else 0
        
        print(f"\r📊 Progress: {self.pieces_sent:,}/{len(self.pieces):,} pieces ({progress:.1f}%) | "
              f"Rate: {rate:.1f} pieces/sec | Elapsed: {elapsed:.1f}s", end='', flush=True)
    
    def run(self):
        """Run the simulator"""
        print("\n" + "=" * 70)
        print("🚀 Starting Real-Time Data Stream Simulator")
        print("=" * 70)
        print(f"Server: {self.config.server_url}")
        print(f"Frequency: {self.config.pieces_per_second} pieces/sec")
        print(f"Interval: {1000/self.config.pieces_per_second:.1f}ms per piece")
        print(f"Batch size: {self.config.batch_size}")
        print("=" * 70 + "\n")
        
        if not self.pieces:
            print("❌ No pieces to send. Did you run prepare_data.py first?")
            return
        
        # Test server connection
        print("🔌 Testing server connection...")
        try:
            response = self.session.get(f"{self.config.server_url}/health", timeout=5)
            print("   ✓ Server is reachable\n")
        except requests.exceptions.RequestException:
            print(f"   ⚠️  Warning: Could not reach server at {self.config.server_url}")
            print("   Continuing anyway...\n")
        
        self.start_time = time.time()
        batch = []
        
        # Calculate sleep time between pieces (in seconds)
        sleep_interval = 1.0 / self.config.pieces_per_second
        
        try:
            for i, piece in enumerate(self.pieces):
                # Sleep to maintain desired frequency (clock-based to handle laptop sleep)
                if i > 0:  # Don't sleep before first piece
                    # Calculate expected time for this piece
                    expected_time = self.start_time + (i * sleep_interval)
                    actual_time = time.time()
                    sleep_needed = expected_time - actual_time
                    
                    if sleep_needed > 0:
                        time.sleep(sleep_needed)
                    elif sleep_needed < -5:  # More than 5 seconds behind (laptop was asleep)
                        print(f"\n⚠️  Detected time jump ({-sleep_needed:.1f}s behind schedule)")
                        print(f"   Laptop may have been asleep. Catching up...")
                        # Reset start time to catch up
                        self.start_time = actual_time - (i * sleep_interval)
                
                # Add to batch or send immediately
                batch.append(piece)
                
                if len(batch) >= self.config.batch_size:
                    sent = self.send_batch(batch)
                    self.pieces_sent += sent
                    batch = []
                    
                    # Print stats every 100 pieces
                    if self.pieces_sent % 100 == 0:
                        self.print_stats()
            
            # Send any remaining pieces in batch
            if batch:
                sent = self.send_batch(batch)
                self.pieces_sent += sent
            
            self.print_stats()
            print("\n\n" + "=" * 70)
            print("✅ Simulation complete!")
            print(f"   Pieces sent: {self.pieces_sent:,}")
            print(f"   Total time: {time.time() - self.start_time:.1f}s")
            print(f"   Avg rate: {self.pieces_sent / (time.time() - self.start_time):.1f} pieces/sec")
            print("=" * 70)
            
        except KeyboardInterrupt:
            print("\n\n⚠️  Simulation interrupted by user")
            print(f"   Pieces sent: {self.pieces_sent:,}")
            elapsed = time.time() - self.start_time
            print(f"   Total time: {elapsed:.1f}s")
            print(f"   Avg rate: {self.pieces_sent / elapsed:.1f} pieces/sec" if elapsed > 0 else "")

def main():
    parser = argparse.ArgumentParser(
        description="Real-time data stream simulator - pulls pieces from data pool at configurable frequency"
    )
    parser.add_argument(
        "--frequency",
        "-f",
        type=float,
        default=5.0,
        help="Pieces per second (default: 5.0). Examples: 1.0 = slow, 5.0 = moderate, 50.0 = fast, 100.0 = very fast"
    )
    parser.add_argument(
        "--server",
        type=str,
        default=DEFAULT_SERVER_URL,
        help=f"Server URL (default: {DEFAULT_SERVER_URL})"
    )
    parser.add_argument(
        "--start",
        type=int,
        default=0,
        help="Start from piece N in the data pool (default: 0)"
    )
    parser.add_argument(
        "--max",
        type=int,
        default=None,
        help="Maximum number of pieces to send (default: all)"
    )
    parser.add_argument(
        "--batch",
        type=int,
        default=1,
        help="Batch size for sending pieces (default: 1)"
    )
    
    args = parser.parse_args()
    
    # Create config
    config = SimulatorConfig(
        pieces_per_second=args.frequency,
        server_url=args.server,
        start_offset=args.start,
        max_pieces=args.max,
        batch_size=args.batch
    )
    
    # Create and run simulator
    simulator = DataStreamSimulator(config)
    simulator.load_data()
    simulator.run()

if __name__ == "__main__":
    main()

