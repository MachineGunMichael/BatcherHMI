// server/routes/config.js
const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");

const CONFIG_FILE = path.join(__dirname, "..", ".runtime-config.json");

/**
 * GET /api/config/mode
 * Returns the current runtime mode configuration
 */
router.get("/mode", (req, res) => {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return res.status(404).json({ 
        error: "No configuration set. Run start_replay_mode.sh or start_live_mode_simple.sh" 
      });
    }
    
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    res.json(config);
  } catch (err) {
    console.error("Error reading config:", err);
    res.status(500).json({ error: "Failed to read configuration" });
  }
});

/**
 * POST /api/config/mode
 * Sets the runtime mode (used by scripts)
 * Body: { mode: "replay" | "live" }
 */
router.post("/mode", (req, res) => {
  try {
    const { mode } = req.body;
    
    if (!mode || !["replay", "live"].includes(mode)) {
      return res.status(400).json({ error: "Invalid mode. Must be 'replay' or 'live'" });
    }
    
    const config = {
      mode,
      timestamp: new Date().toISOString()
    };
    
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    res.json({ success: true, config });
  } catch (err) {
    console.error("Error writing config:", err);
    res.status(500).json({ error: "Failed to write configuration" });
  }
});

module.exports = router;

