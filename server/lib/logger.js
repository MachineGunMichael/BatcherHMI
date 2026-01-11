/**
 * Centralized Logging System
 * 
 * Provides structured JSON logging with daily rotation and 30-day retention.
 * 
 * Log Files:
 * - audit.log     - User activity (login, recipe changes, button presses)
 * - operations.log - Business operations (batch completions, gate assignments)
 * - system.log    - Server health, API calls, database status
 * - error.log     - All errors consolidated
 * 
 * Log Levels:
 * - error: Failures requiring attention (always captured)
 * - warn: Potential issues, recoverable errors (always captured)
 * - info: Normal operations (always captured)
 * - debug: Verbose details (dev only, disabled in production)
 */

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');

// Console output is disabled by default (all logging goes to files only)
// Set NODE_CONSOLE=1 to enable console output for debugging
const ENABLE_CONSOLE = process.env.NODE_CONSOLE === '1';

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Custom JSON format for structured logs (unified structure)
const jsonFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
  winston.format.errors({ stack: true }),
  winston.format.printf((info) => {
    // Flatten structure: timestamp first, then level, service, category, action, message, then details
    const { timestamp, level, message: rawMessage, service, ...rest } = info;
    
    // Extract category, action, and message from the info object or nested message
    let category, action, message, details;
    if (typeof rawMessage === 'object' && rawMessage !== null) {
      category = rawMessage.category;
      action = rawMessage.action;
      message = rawMessage.message;
      const { category: _, action: __, message: ___, ...msgRest } = rawMessage;
      details = msgRest;
    } else {
      category = rest.category;
      action = rest.action;
      message = rest.message || rawMessage;
      details = {};
    }
    
    // Build flat log entry with consistent order
    const entry = {
      timestamp,
      level,
      service: service || 'batching-hmi',
      category,
      action,
      message,
      ...details,
      ...rest,
    };
    
    // Remove undefined values and internal winston fields
    const cleanEntry = {};
    for (const [key, value] of Object.entries(entry)) {
      if (value !== undefined && !['splat', 'category', 'action', 'message'].includes(key)) {
        cleanEntry[key] = value;
      }
    }
    
    // Build ordered entry: timestamp, level, service, category, action, message, then rest
    const orderedEntry = {
      timestamp: cleanEntry.timestamp,
      level: cleanEntry.level,
      service: cleanEntry.service,
      category,
      action,
      message,
    };
    delete cleanEntry.timestamp;
    delete cleanEntry.level;
    delete cleanEntry.service;
    
    return JSON.stringify({ ...orderedEntry, ...cleanEntry });
  })
);

// Simple format for console (dev only)
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, category, action, ...meta }) => {
    const catStr = category ? `[${category}]` : '';
    const actStr = action ? ` ${action}:` : '';
    const msgStr = typeof message === 'string' ? message : JSON.stringify(message);
    return `${timestamp} ${level} ${catStr}${actStr} ${msgStr}`;
  })
);

// Temp directory for audit files (keeps logs/ clean)
const TEMP_DIR = require('os').tmpdir();

// Daily rotation configuration (base settings)
const rotationConfig = {
  datePattern: 'YYYY-MM-DD',
  maxFiles: '30d',
  zippedArchive: false,
  format: jsonFormat,
};

// Category filter - only log messages matching specific category
function categoryFilter(targetCategory) {
  return winston.format((info) => {
    const msgCategory = info.message?.category || info.category;
    return msgCategory === targetCategory ? info : false;
  })();
}

// Create transport for a specific category
function createCategoryTransport(filename, category, level = 'info') {
  return new DailyRotateFile({
    ...rotationConfig,
    filename: path.join(LOG_DIR, `${filename}-%DATE%.log`),
    level,
    format: winston.format.combine(
      categoryFilter(category),
      jsonFormat
    ),
    // Store audit file in temp directory (keeps logs/ clean)
    auditFile: path.join(TEMP_DIR, `batching-hmi-${filename}-audit.json`),
  });
}

// Create error transport (captures all errors regardless of category)
function createErrorTransport() {
  return new DailyRotateFile({
    ...rotationConfig,
    filename: path.join(LOG_DIR, 'error-%DATE%.log'),
    level: 'error',
    auditFile: path.join(TEMP_DIR, 'batching-hmi-error-audit.json'),
  });
}

// Main logger with category-filtered transports
const logger = winston.createLogger({
  level: 'debug',  // All levels captured to file; console filtering is separate
  format: jsonFormat,
  defaultMeta: { service: 'batching-hmi' },
  transports: [
    // Audit log - only audit category
    createCategoryTransport('audit', 'audit'),
    // Operations log - only operations category
    createCategoryTransport('operations', 'operations'),
    // System log - only system category
    createCategoryTransport('system', 'system'),
    // Error log - all errors from all categories
    createErrorTransport(),
  ],
});

// Add console transport only if explicitly enabled (silent by default)
if (ENABLE_CONSOLE) {
  logger.add(new winston.transports.Console({
    level: 'debug',
    format: consoleFormat,
  }));
}

// =====================================================
// SPECIALIZED LOGGING FUNCTIONS
// =====================================================

/**
 * Log user activity (audit trail)
 * Use for: login/logout, recipe changes, button presses, page views
 */
function audit(action, message, details = {}, user = null) {
  logger.info({
    category: 'audit',
    action,
    message,
    user: user?.username || user || 'anonymous',
    ...details,
  });
}

/**
 * Log business operations
 * Use for: batch completions, gate assignments, program transitions
 */
function operations(action, message, details = {}) {
  logger.info({
    category: 'operations',
    action,
    message,
    ...details,
  });
}

/**
 * Log system events
 * Use for: server health, database status, API timing
 */
function system(action, message, details = {}) {
  logger.info({
    category: 'system',
    action,
    message,
    ...details,
  });
}

/**
 * Log errors (captured in both category log and error.log)
 */
function error(category, action, err, details = {}) {
  logger.error({
    category,
    action,
    error: {
      name: err?.name || 'Error',
      message: err?.message || String(err),
      stack: err?.stack,
    },
    ...details,
  });
}

/**
 * Log warnings
 */
function warn(category, action, message, details = {}) {
  logger.warn({
    category,
    action,
    message,
    ...details,
  });
}

/**
 * Log debug information (dev only, filtered in production)
 */
function debug(category, action, message, details = {}) {
  logger.debug({
    category,
    action,
    message,
    ...details,
  });
}

// =====================================================
// CONVENIENCE METHODS FOR COMMON LOGGING SCENARIOS
// =====================================================

const log = {
  // ==================== AUDIT - User activities ====================
  // Messages are kept minimal; structured fields carry the details
  userLogin: (username, role, ip) => 
    audit('user_login', 'User logged in', { role, ip }, username),
  
  userLogout: (username) => 
    audit('user_logout', 'User logged out', {}, username),
  
  loginFailed: (username, reason, ip) => 
    audit('login_failed', 'Login failed', { reason, ip }, username),
  
  recipeCreated: (recipeName, details, user) => {
    // Only include gates for auto-created recipes
    const logDetails = { recipe: recipeName };
    if (details.autoCreated) {
      logDetails.autoCreated = true;
      if (details.gates) logDetails.gates = details.gates;
    }
    if (details.recipeId) logDetails.recipeId = details.recipeId;
    return audit('recipe_created', 'Recipe created', logDetails, user);
  },
  
  recipeEdited: (recipeName, changes, user) => 
    audit('recipe_edited', 'Recipe edited', { recipe: recipeName, changes }, user),
  
  recipeRemoved: (recipeName, user) => 
    audit('recipe_removed', 'Recipe removed', { recipe: recipeName }, user),
  
  recipeAssigned: (recipeName, gate, user) => 
    audit('recipe_assigned', 'Recipe assigned to gate', { recipe: recipeName, gate }, user),
  
  // Moved to operations - see recipesConfigured below
  
  programAssigned: (programId, programName, user) => 
    audit('program_assigned', 'Program assigned', { programId, program: programName }, user),
  
  programActivated: (programId, programName, user) => 
    audit('program_activated', 'Program activated', { programId, program: programName }, user),
  
  savedProgramCreated: (programId, displayName, recipes, user) => {
    // Build gate assignments summary: { "R_100_200...": [1,2], "R_50_100...": [3,4] }
    const assignments = {};
    for (const r of recipes) {
      assignments[r.recipeName] = r.gates;
    }
    audit('saved_program_created', 'Saved program created', { 
      programId, 
      program: displayName,
      recipeCount: recipes.length,
      assignments 
    }, user);
  },
  
  machineControl: (action, user, details = {}) => 
    audit('machine_control', action, details, user),
  
  pageViewed: (page, user, details = {}) => {
    const safeDetails = typeof details === 'object' && details !== null ? details : {};
    const { page: _, ...rest } = safeDetails; // Remove duplicate page from details
    audit('page_viewed', 'Page viewed', { page, ...rest }, user);
  },
  
  settingsChanged: (setting, oldValue, newValue, user) => 
    audit('settings_changed', 'Setting changed', { setting, from: oldValue, to: newValue }, user),
  
  legendToggled: (series, visible, user) => 
    audit('legend_toggled', visible ? 'Legend shown' : 'Legend hidden', { series }, user),
  
  statsPageSelection: (programId, programName, user) =>
    audit('stats_program_selected', 'Stats program selected', { programId, program: programName }, user),
  
  recipeToggled: (recipeName, visible, user) =>
    audit('recipe_toggled', visible ? 'Recipe shown' : 'Recipe hidden', { recipe: recipeName }, user),

  statsProgramSelected: (programId, programName, user) =>
    audit('stats_program_selected', 'Stats program selected', { programId, program: programName }, user),
  
  statsRecipeToggled: (recipeId, recipeName, visible, user) =>
    audit('stats_recipe_toggled', visible ? 'Recipe shown' : 'Recipe hidden', { recipeId, recipe: recipeName }, user),
  
  simulationSelected: (simulationId, user) =>
    audit('simulation_selected', 'Simulation selected', { simulationId }, user),

  // ==================== OPERATIONS - Business events ====================
  // Compact format: message is action summary, fields have data
  // Helper: Convert recipes to compact format { "R_100_199...": [1, 2], "R_50_150...": [3, 4] }
  _toCompactAssignments: (recipes) => {
    const recipeToGates = {};
    for (const r of recipes) {
      const name = r.recipeName || r.name || r;
      const gates = r.gates || [];
      if (!recipeToGates[name]) recipeToGates[name] = [];
      recipeToGates[name].push(...gates);
    }
    // Sort gates for each recipe
    for (const name of Object.keys(recipeToGates)) {
      recipeToGates[name].sort((a, b) => a - b);
    }
    return recipeToGates;
  },
  
  batchCompleted: (gate, recipe, pieces, weightG, programId) => 
    operations('batch_completed', 'Batch completed', { gate, recipe, pieces, weightG, programId }),
  
  programStarted: (programId, programName, recipes) => {
    // Compact format: { "R_100_199...": [1, 2], "R_50_150...": [3, 4] }
    const assignments = module.exports._toCompactAssignments(recipes);
    return operations('program_started', 'Program started', { programId, program: programName, assignments });
  },
  
  programStopped: (programId, stats) => 
    operations('program_stopped', 'Program stopped', { programId, ...stats }),
  
  transitionStarted: (oldProgramId, newProgramId, affectedGates) => 
    operations('transition_started', 'Transition started', { from: oldProgramId, to: newProgramId, gates: affectedGates }),
  
  transitionCompleted: (gatesCompleted) => 
    operations('transition_completed', 'Transition completed', { gates: gatesCompleted }),
  
  gateSkipped: (gate, pieces, weightG) => 
    operations('gate_skipped', 'Gate skipped', { gate, pieces, weightG }),
  
  programStatsCreated: (programId, programName) =>
    operations('program_stats_created', 'Program stats created', { programId, program: programName }),
  
  programStatsFinalized: (programId, stats = {}) =>
    operations('program_stats_finalized', 'Program stats finalized', { programId, ...stats }),
  
  programCreated: (programId, programName) =>
    operations('program_created', 'New program created', { programId, program: programName }),
  
  // Log recipes added to empty gates (during transition or setup)
  recipesAdded: (gates, recipes, programId) => {
    // gates: array of gate numbers that received new recipes
    // recipes: the recipes that were added { recipeName, gates }
    const additions = {};
    for (const r of recipes) {
      const name = r.recipeName || r.name;
      const addedGates = (r.gates || []).filter(g => gates.includes(g));
      if (addedGates.length > 0) {
        additions[name] = addedGates.sort((a, b) => a - b);
      }
    }
    return operations('recipes_added', 'Recipes added to empty gates', { programId, additions });
  },
  
  // Log recipe changes during transition (gate by gate)
  transitionRecipeChanges: (changes, fromProgramId, toProgramId) => {
    // changes: array of { gate, from, to }
    return operations('transition_recipe_changes', `Recipe changes for ${changes.length} gates`, { 
      from: fromProgramId, 
      to: toProgramId, 
      changes 
    });
  },
  
  // Final recipe assignments after transition completes
  transitionsFinalized: (programId, recipes) => {
    const assignments = module.exports._toCompactAssignments(recipes);
    return operations('transitions_finalized', `Transitions finalized`, { programId, assignments });
  },
  
  // DEPRECATED - use recipesAdded or transitionRecipeChanges instead
  recipesConfigured: (recipes, programId) => {
    const assignments = module.exports._toCompactAssignments(recipes);
    return operations('recipes_configured', 'Recipes configured', { programId, assignments });
  },
  
  transitionRecipeChange: (gate, oldRecipe, newRecipe) =>
    operations('transition_recipe_change', `Gate ${gate} recipe change`, { gate, from: oldRecipe, to: newRecipe }),

  // ==================== SYSTEM - Infrastructure ====================
  serverStarted: (port) => 
    system('server_started', 'Server started', { port }),
  
  serverShutdown: (reason) => 
    system('server_shutdown', 'Server shutdown', { reason }),
  
  databaseConnected: (type, database) => 
    system('database_connected', 'Database connected', { type, database }),
  
  databaseError: (type, err) => 
    error('system', 'database_error', err, { type }),
  
  influxHealth: (ok, host, database) => 
    system('influx_health', ok ? 'InfluxDB healthy' : 'InfluxDB unhealthy', { ok, host, database }),
  
  sqliteHealth: (ok, path) => 
    system('sqlite_health', ok ? 'SQLite healthy' : 'SQLite unhealthy', { ok, path }),
  
  // SSE events - DEBUG level only (not logged in production)
  sseClientConnected: (clientId) => 
    debug('system', 'sse_client_connected', 'SSE client connected', { clientId }),
  
  sseClientDisconnected: (clientId) => 
    debug('system', 'sse_client_disconnected', 'SSE client disconnected', { clientId }),
  
  apiRequest: (method, path, statusCode, durationMs) => 
    debug('system', 'api_request', 'API request', { method, path, statusCode, durationMs }),
  
  workerCall: (action, details = {}) => 
    system('worker_call', 'Worker called', { action, ...details }),
  
  simulatorProgress: (loopCount, piecesSent, rate) => 
    system('simulator_progress', 'Simulator progress', { loop: loopCount, pieces: piecesSent, rate }),

  // ==================== Base logging functions ====================
  audit: (action, message, details = {}, user = null) => 
    audit(action, message, details, user),
  
  operations: (action, message, details = {}) => 
    operations(action, message, details),
  
  system: (action, message, details = {}) => 
    system(action, message, details),

  // ==================== Error logging ====================
  error: (category, action, err, details = {}) => 
    error(category, action, err, details),
  
  warn: (category, action, message, details = {}) => 
    warn(category, action, message, details),
  
  debug: (category, action, message, details = {}) => 
    debug(category, action, message, details),
};

module.exports = log;
module.exports.logger = logger;
module.exports.LOG_DIR = LOG_DIR;
