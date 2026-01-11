"""
Centralized Logging Configuration for Python Workers

Provides structured JSON logging with daily rotation and 30-day retention.
Logs are written to the shared logs/ directory at the project root.

Log Files:
- worker.log      - Live worker activities and KPI calculations
- simulator.log   - Simulator progress and events
- error.log       - All Python errors consolidated

Usage:
    from logger import get_logger, Logger
    
    log = Logger('worker')
    log.info('Starting processing')
    log.startup_banner('Live Worker', '4.0', {'db': 'connected'})
"""

import os
import sys
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional

# Determine log directory (shared with Node.js)
BASE_DIR = Path(__file__).parent.parent
LOG_DIR = BASE_DIR / 'logs'
LOG_DIR.mkdir(exist_ok=True)

# Console output is disabled by default (all logging goes to files only)
# Set PYTHON_CONSOLE=1 to enable console output for debugging
ENABLE_CONSOLE = os.getenv('PYTHON_CONSOLE') == '1'


class JsonFormatter(logging.Formatter):
    """JSON formatter for structured logging to files (unified with Node.js format)"""
    
    def __init__(self, service_name: str = 'python-worker'):
        super().__init__()
        self.service_name = service_name
    
    def format(self, record):
        # Use local time with timezone offset (matches Node.js format)
        now = datetime.now().astimezone()
        timestamp = now.strftime('%Y-%m-%dT%H:%M:%S.') + f'{now.microsecond // 1000:03d}' + now.strftime('%z')
        # Insert colon in timezone offset (e.g., +0100 -> +01:00)
        timestamp = timestamp[:-2] + ':' + timestamp[-2:]
        
        # Build log entry with consistent order (matches Node.js)
        log_entry = {
            'timestamp': timestamp,
            'level': record.levelname.lower(),
            'service': self.service_name,
            'category': getattr(record, 'category', 'system'),
            'action': getattr(record, 'action', None),
        }
        
        # Add message if present
        msg = record.getMessage()
        if msg:
            log_entry['message'] = msg
        
        # Add extra fields (excluding standard logging attributes)
        skip_keys = {'msg', 'args', 'created', 'filename', 'funcName', 
                    'levelname', 'levelno', 'lineno', 'module', 'msecs',
                    'name', 'pathname', 'process', 'processName', 'relativeCreated',
                    'stack_info', 'exc_info', 'exc_text', 'thread', 'threadName',
                    'service', 'category', 'action', 'message', 'taskName'}
        
        for key, value in record.__dict__.items():
            if key not in skip_keys and value is not None:
                log_entry[key] = value
        
        if record.exc_info:
            log_entry['error'] = {
                'type': record.exc_info[0].__name__ if record.exc_info[0] else None,
                'message': str(record.exc_info[1]) if record.exc_info[1] else None,
                'traceback': self.formatException(record.exc_info) if record.exc_info else None,
            }
        
        return json.dumps(log_entry)


class CleanConsoleFormatter(logging.Formatter):
    """Clean, professional console formatter without emojis"""
    
    LEVEL_PREFIXES = {
        'DEBUG': '[DEBUG]',
        'INFO': '[INFO] ',
        'WARNING': '[WARN] ',
        'ERROR': '[ERROR]',
        'CRITICAL': '[CRIT] ',
    }
    
    def format(self, record):
        timestamp = datetime.now().strftime('%H:%M:%S')
        prefix = self.LEVEL_PREFIXES.get(record.levelname, '[????] ')
        message = record.getMessage()
        return f"{timestamp} {prefix} {message}"


class DailyDatedFileHandler(logging.FileHandler):
    """
    File handler that automatically switches to a new dated file at midnight.
    Format: {base_name}-YYYY-MM-DD.log
    
    Checks on each emit() if the date has changed and opens a new file if needed.
    """
    
    def __init__(self, log_dir, base_name, **kwargs):
        self.log_dir = Path(log_dir)
        self.base_name = base_name
        self._current_date = None
        
        # Initialize with today's file
        filename = self._get_filename_for_today()
        super().__init__(filename, encoding='utf-8', **kwargs)
    
    def _get_filename_for_today(self):
        """Get the log filename for today's date"""
        from datetime import date
        today = date.today().strftime('%Y-%m-%d')
        return str(self.log_dir / f"{self.base_name}-{today}.log")
    
    def emit(self, record):
        """Emit a log record, switching files if date has changed"""
        from datetime import date
        today = date.today()
        
        # Check if we need to switch to a new file
        if self._current_date != today:
            self._current_date = today
            new_filename = self._get_filename_for_today()
            
            # Only switch if filename actually changed
            if new_filename != self.baseFilename:
                # Close current stream
                if self.stream:
                    self.stream.close()
                    self.stream = None
                
                # Update to new filename
                self.baseFilename = new_filename
                self.stream = self._open()
        
        super().emit(record)


def create_dated_file_handler(base_name, service_name, level=logging.INFO):
    """
    Create a file handler that automatically rotates to new dated files daily.
    Format: {base_name}-YYYY-MM-DD.log
    """
    handler = DailyDatedFileHandler(LOG_DIR, base_name)
    handler.setLevel(level)
    handler.setFormatter(JsonFormatter(service_name=service_name))
    return handler


class Logger:
    """
    Professional logging wrapper for Python workers.
    
    Provides:
    - Structured JSON logging to files
    - Console output only in development mode (silent in production)
    - Startup banners
    - Progress reporting
    """
    
    def __init__(self, name: str = 'worker'):
        self.name = name
        self._logger = logging.getLogger(f'batching.{name}')
        self._logger.setLevel(logging.DEBUG)
        self._logger.propagate = False
        self._logger.handlers = []
        
        # Service name for log entries (matches Node.js naming)
        service_name = name  # 'worker' or 'simulator'
        
        # File handler (JSON format) - creates worker-2026-01-07.log or simulator-2026-01-07.log
        log_filename = name if name in ('worker', 'simulator') else 'system'
        self._logger.addHandler(create_dated_file_handler(log_filename, service_name))
        
        # Error file handler - creates error-2026-01-07.log
        self._logger.addHandler(create_dated_file_handler('error', service_name, level=logging.ERROR))
        
        # Console handler - ONLY if explicitly enabled (silent by default)
        if ENABLE_CONSOLE:
            console_handler = logging.StreamHandler(sys.stdout)
            console_handler.setLevel(logging.DEBUG)
            console_handler.setFormatter(CleanConsoleFormatter())
            self._logger.addHandler(console_handler)
    
    def info(self, message: str, **extra):
        self._logger.info(message, extra=extra)
    
    def debug(self, message: str, **extra):
        self._logger.debug(message, extra=extra)
    
    def warning(self, message: str, **extra):
        self._logger.warning(message, extra=extra)
    
    def error(self, message: str, exc: Optional[Exception] = None, **extra):
        self._logger.error(message, exc_info=exc, extra=extra)
    
    def critical(self, message: str, exc: Optional[Exception] = None, **extra):
        self._logger.critical(message, exc_info=exc, extra=extra)
    
    # =========================================================
    # PROFESSIONAL OUTPUT HELPERS (silent in production)
    # =========================================================
    
    def startup_banner(self, title: str, version: str = '', details: Dict[str, Any] = None):
        """Print a clean startup banner (dev only, logged to file always)"""
        # Always log to file
        self.info(f"{title} v{version} starting", category='system', action='startup', **({} if not details else details))
        
        # Console output only in development
        if not ENABLE_CONSOLE:
            return
            
        width = 70
        print()
        print("=" * width)
        print(f"  {title}" + (f" v{version}" if version else ""))
        print("=" * width)
        
        if details:
            for key, value in details.items():
                print(f"  {key}: {value}")
        
        print("=" * width)
        print()
    
    def section(self, title: str):
        """Print a section header (dev only)"""
        self.info(title, category='system', action='section')
        
        if not ENABLE_CONSOLE:
            return
            
        print()
        print("-" * 50)
        print(f"  {title}")
        print("-" * 50)
    
    def item(self, label: str, value: Any = None, indent: int = 2):
        """Print an item (key-value or just label) - dev only"""
        if not ENABLE_CONSOLE:
            return
            
        spaces = " " * indent
        if value is not None:
            print(f"{spaces}{label}: {value}")
        else:
            print(f"{spaces}{label}")
    
    def success(self, message: str):
        """Log success (INFO level)"""
        self.info(f"OK: {message}", category='system', action='success')
    
    def progress(self, current: int, total: int, label: str = ''):
        """Print progress (overwrites line) - dev only"""
        if not ENABLE_CONSOLE:
            return
            
        pct = (current / total * 100) if total > 0 else 0
        bar_len = 30
        filled = int(bar_len * current / total) if total > 0 else 0
        bar = '#' * filled + '-' * (bar_len - filled)
        suffix = f" {label}" if label else ""
        print(f"\r  [{bar}] {pct:5.1f}% ({current}/{total}){suffix}", end='', flush=True)
        if current >= total:
            print()  # Newline when complete
    
    def table_row(self, *columns, widths: list = None):
        """Print a table row with optional column widths - dev only"""
        if not ENABLE_CONSOLE:
            return
            
        if widths is None:
            print("  " + "  ".join(str(c) for c in columns))
        else:
            formatted = []
            for i, col in enumerate(columns):
                w = widths[i] if i < len(widths) else 15
                formatted.append(str(col).ljust(w)[:w])
            print("  " + "  ".join(formatted))


# =========================================================
# MODULE-LEVEL CONVENIENCE FUNCTIONS (backwards compatibility)
# =========================================================

_loggers: Dict[str, Logger] = {}

def get_logger(name: str = 'worker') -> Logger:
    """Get or create a logger instance"""
    if name not in _loggers:
        _loggers[name] = Logger(name)
    return _loggers[name]


def log_operations(logger: Logger, action: str, message: str = '', **details):
    """Log business operations"""
    logger.info(message, category='operations', action=action, **details)


def log_system(logger: Logger, action: str, message: str = '', **details):
    """Log system events"""
    logger.info(message, category='system', action=action, **details)


def log_error(logger: Logger, action: str, error: Exception, message: str = '', **details):
    """Log errors with exception info"""
    logger.error(message, exc=error, category='error', action=action, **details)


def log_debug(logger: Logger, action: str, message: str = '', **details):
    """Log debug information"""
    logger.debug(message, category='debug', action=action, **details)


# Pre-configured loggers
worker_logger = get_logger('worker')
simulator_logger = get_logger('simulator')
