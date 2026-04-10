import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  Box,
  Typography,
  Button,
  ToggleButton,
  ToggleButtonGroup,
  useTheme,
  keyframes,
} from "@mui/material";
import Header from "../../components/Header";
import MachineControls from "../../components/MachineControls";
import { tokens } from "../../theme";

const GATE_COUNT = 8;
const TOP_ROW = [1, 2, 3, 4];
const BOTTOM_ROW = [5, 6, 7, 8];
const SIDE_WIDTH = 180;
const ARM_SECTION_W = 110;
const LAMP_SECTION_W = 50;
const COL_WIDTH = ARM_SECTION_W + LAMP_SECTION_W;

const blinkKeyframes = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.15; }
`;

const LAMP_LABELS = ["OFF", "BLINK", "ON"];

/* ------------------------------------------------------------------ */
/*  Indicator Lamp                                                     */
/* ------------------------------------------------------------------ */
const IndicatorLamp = React.memo(({ state, colors, isDark }) => {
  const isActive = state > 0;
  const isBlink = state === 1;
  return (
    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.5 }}>
      <Box
        sx={{
          width: 40, height: 40, borderRadius: 1.5,
          border: `2px solid ${isDark ? colors.primary[600] : colors.primary[400]}`,
          backgroundColor: isDark ? colors.primary[300] : colors.primary[200],
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "box-shadow 0.2s ease",
          boxShadow: isActive ? `0 0 14px ${colors.tealAccent[500]}80` : "0 1px 3px rgba(0,0,0,0.12)",
        }}
      >
        <Box
          sx={{
            width: 22, height: 22, borderRadius: "50%",
            border: `2px solid ${isDark ? colors.primary[500] : colors.primary[400]}`,
            backgroundColor: isActive ? colors.tealAccent[500] : isDark ? colors.primary[400] : colors.primary[300],
            animation: isBlink ? `${blinkKeyframes} 1s ease-in-out infinite` : "none",
            boxShadow: isActive ? `0 0 10px ${colors.tealAccent[500]}` : "inset 0 1px 3px rgba(0,0,0,0.1)",
            transition: "background-color 0.3s ease",
          }}
        />
      </Box>
      <Typography variant="caption" sx={{ color: colors.primary[600], fontWeight: "bold", fontSize: "0.55rem" }}>
        {LAMP_LABELS[state]}
      </Typography>
    </Box>
  );
});

/* ------------------------------------------------------------------ */
/*  Gate Arm                                                           */
/*  position="top":    button → arm image (mirrored, points down)      */
/*  position="bottom": arm image (points up) → button                  */
/* ------------------------------------------------------------------ */
const GateArm = ({ gate, isOpen, onToggle, colors, isDark, position, disabled }) => {
  const mirror = position === "top";
  const armImage = (
    <Box sx={{ width: 100, height: 70, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Box
        component="img" src="/assets/arm.png" alt={`Gate ${gate} arm`}
        sx={{
          width: 90, height: "auto",
          transformOrigin: "78% 42%",
          transform: `${mirror ? "scaleY(-1) " : ""}${isOpen ? "rotate(45deg)" : "rotate(0deg)"}`,
          transition: "transform 0.4s ease",
          filter: isDark ? "invert(1)" : "none",
          opacity: disabled ? 0.4 : 1,
        }}
      />
    </Box>
  );
  const btn = (
    <Button
      variant="contained" size="small"
      disabled={disabled}
      onClick={() => onToggle(gate)}
      sx={{
        minWidth: 80, fontWeight: "bold", fontSize: "0.75rem",
        backgroundColor: isOpen ? colors.redAccent[500] : colors.tealAccent[500],
        color: "#fff",
        "&:hover": { backgroundColor: isOpen ? colors.redAccent[600] : colors.tealAccent[600] },
      }}
    >
      {isOpen ? "CLOSE" : "OPEN"}
    </Button>
  );

  return (
    <Box sx={{ width: COL_WIDTH, display: "flex" }}>
      <Box sx={{ width: ARM_SECTION_W, display: "flex", flexDirection: "column", alignItems: "center" }}>
        {position === "top" && <>{btn}<Box sx={{ mt: 1.5 /* ← L109: gap: gate button ↔ arm image (top) */ }}>{armImage}</Box></>}
        {position === "bottom" && <>{armImage}<Box sx={{ mt: 1.5 /* ← L110: gap: arm image ↔ gate button (bottom) */ }}>{btn}</Box></>}
      </Box>
      <Box sx={{ width: LAMP_SECTION_W, flexShrink: 0 }} />
    </Box>
  );
};

/* ------------------------------------------------------------------ */
/*  Buffer column                                                      */
/*  position="top":    posts+lamp → button                             */
/*  position="bottom": button → posts+lamp                             */
/* ------------------------------------------------------------------ */
const BufferColumn = ({ gate, isOpen, onToggle, lampState, colors, isDark, position, disabled }) => {
  const postsAndLamp = (
    <Box sx={{ display: "flex", alignItems: "flex-start" }}>
      <Box sx={{ width: ARM_SECTION_W, display: "flex", justifyContent: "center" }}>
        <Box sx={{ width: 80, height: 50, display: "flex", alignItems: "flex-end", justifyContent: "center", position: "relative" }}>
          <Box sx={{ position: "absolute", left: 14, top: 0, width: 3, height: "100%", backgroundColor: isDark ? colors.primary[700] : colors.primary[500], borderRadius: 1 }} />
          <Box sx={{ position: "absolute", right: 14, top: 0, width: 3, height: "100%", backgroundColor: isDark ? colors.primary[700] : colors.primary[500], borderRadius: 1 }} />
          <Box
            component="img" src="/assets/arm.png" alt={`Buffer ${gate} arm`}
            sx={{
              width: 55, height: "auto",
              position: "absolute", bottom: 2,
              transformOrigin: "78% 42%",
              transform: isOpen ? "rotate(-45deg)" : "rotate(0deg)",
              transition: "transform 0.4s ease",
              filter: isDark ? "invert(1)" : "none",
              zIndex: 1,
              opacity: disabled ? 0.4 : 1,
            }}
          />
        </Box>
      </Box>
      <Box sx={{ width: LAMP_SECTION_W, display: "flex", justifyContent: "center", pt: "5px" }}>
        <IndicatorLamp state={lampState} colors={colors} isDark={isDark} />
      </Box>
    </Box>
  );
  const btn = (
    <Box sx={{ width: ARM_SECTION_W, display: "flex", justifyContent: "center" }}>
        <Button
          variant="contained" size="small"
          disabled={disabled}
          onClick={() => onToggle(gate)}
          sx={{
            minWidth: 60, fontWeight: "bold", fontSize: "0.65rem", py: 0.25,
            backgroundColor: isOpen ? colors.redAccent[500] : colors.tealAccent[500],
            color: "#fff",
            "&:hover": { backgroundColor: isOpen ? colors.redAccent[600] : colors.tealAccent[600] },
          }}
        >
          {isOpen ? "CLOSE" : "OPEN"}
        </Button>
      </Box>
  );

  return (
    <Box sx={{ width: COL_WIDTH, display: "flex", flexDirection: "column" }}>
      {position === "top" && <>{postsAndLamp}<Box sx={{ mt: 1 /* ← L168: gap: buffer posts ↔ buffer button (top) */ }}>{btn}</Box></>}
      {position === "bottom" && <>{btn}<Box sx={{ mt: 2.5 /* ← L169: gap: buffer button ↔ buffer posts (bottom) */ }}>{postsAndLamp}</Box></>}
    </Box>
  );
};

/* ------------------------------------------------------------------ */
/*  Gate label row                                                     */
/* ------------------------------------------------------------------ */
const GateLabelRow = ({ gates, colors }) => (
  <Box display="flex" flex={1} justifyContent="center">
    {gates.map((g) => (
      <Box key={`lbl-${g}`} sx={{ width: COL_WIDTH, display: "flex" }}>
        <Box sx={{ width: ARM_SECTION_W, textAlign: "center" }}>
          <Typography variant="h6" fontWeight="bold" sx={{ color: colors.primary[800] }}>G{g}</Typography>
        </Box>
        <Box sx={{ width: LAMP_SECTION_W }} />
      </Box>
    ))}
  </Box>
);

/* ------------------------------------------------------------------ */
/*  Row control button                                                 */
/* ------------------------------------------------------------------ */
const RowControlButton = ({ label, allOpen, onToggle, colors, disabled }) => (
  <Button
    variant="outlined" size="small"
    disabled={disabled}
    onClick={onToggle}
    sx={{
      width: SIDE_WIDTH - 16,
      fontWeight: "bold", fontSize: "0.65rem", whiteSpace: "nowrap",
      borderColor: allOpen ? colors.redAccent[500] : colors.tealAccent[500],
      color: allOpen ? colors.redAccent[500] : colors.tealAccent[500],
      "&:hover": {
        backgroundColor: allOpen ? `${colors.redAccent[500]}14` : `${colors.tealAccent[500]}14`,
        borderColor: allOpen ? colors.redAccent[400] : colors.tealAccent[400],
      },
    }}
  >
    {allOpen ? `Close ${label}` : `Open ${label}`}
  </Button>
);

/* ------------------------------------------------------------------ */
/*  Right-side button container                                        */
/* ------------------------------------------------------------------ */
const SideBtn = ({ children, align = "flex-end" }) => (
  <Box sx={{ width: SIDE_WIDTH, display: "flex", flexDirection: "column", justifyContent: align, alignItems: "center" }}>
    {children}
  </Box>
);

/* ================================================================== */
/*  Main Maintenance Page                                              */
/* ================================================================== */
const MAINT_REF_W = 900;
const MAINT_REF_H = 860;

const Maintenance = () => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  const isDark = theme.palette.mode === "dark";

  const observerRef = useRef(null);
  const [containerDims, setContainerDims] = useState({ w: 0, h: 0, scale: 1 });
  const containerRef = useCallback((el) => {
    if (observerRef.current) { observerRef.current.disconnect(); observerRef.current = null; }
    if (el) {
      const observer = new ResizeObserver((entries) => {
        const { width, height } = entries[0].contentRect;
        if (width < 10 || height < 10) return;
        const s = Math.max(0.5, Math.min(width / MAINT_REF_W, height / MAINT_REF_H));
        setContainerDims(prev => {
          if (Math.abs(prev.scale - s) < 0.005 && Math.abs(prev.w - width) < 2 && Math.abs(prev.h - height) < 2) return prev;
          return { w: width, h: height, scale: s };
        });
      });
      observer.observe(el);
      observerRef.current = observer;
    }
  }, []);

  const [machineRunState, setMachineRunState] = useState("idle");
  const [activeRecipeCount, setActiveRecipeCount] = useState(0);
  const isRunning = machineRunState === "running";
  const maintMachineHook = { state: machineRunState, activeRecipes: Array(activeRecipeCount).fill(null), isConnected: true };

  const [machineMode, setMachineMode] = useState("normal");
  const [gateOverlay, setGateOverlay] = useState({});

  // Single SSE connection for both gate overlay and machine state
  useEffect(() => {
    const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:5001/api";
    const baseUrl = API_BASE.replace(/\/api\/?$/, "");
    const es = new EventSource(`${baseUrl}/api/stream/dashboard?mode=live`);
    const onTick = (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (d.machineState) setMachineRunState(d.machineState);
        if (Array.isArray(d.activeRecipes)) setActiveRecipeCount(d.activeRecipes.length);
        if (Array.isArray(d.overlay)) {
          const map = {};
          d.overlay.forEach(g => { map[Number(g.gate)] = g; });
          setGateOverlay(map);
        }
      } catch {}
    };
    const onGate = (ev) => {
      try {
        const d = JSON.parse(ev.data);
        setGateOverlay(prev => ({
          ...prev,
          [Number(d.gate)]: d,
        }));
      } catch {}
    };
    es.addEventListener("tick", onTick);
    es.addEventListener("gate", onGate);
    return () => { es.close(); };
  }, []);

  const [gateOpen, setGateOpen] = useState(
    () => Object.fromEntries(Array.from({ length: GATE_COUNT }, (_, i) => [i + 1, false]))
  );
  const [bufferOpen, setBufferOpen] = useState(
    () => Object.fromEntries(Array.from({ length: GATE_COUNT }, (_, i) => [i + 1, false]))
  );

  // Derive lamp states from real-time gate overlay
  // 0 = OFF, 1 = BLINK (mainFull only), 2 = ON (both full)
  const lampStates = {};
  for (let i = 1; i <= GATE_COUNT; i++) {
    const gs = gateOverlay[i];
    if (gs && gs.mainFull && gs.bufferFull) {
      lampStates[i] = 2;
    } else if (gs && gs.mainFull) {
      lampStates[i] = 1;
    } else {
      lampStates[i] = 0;
    }
  }

  const toggleGate = useCallback((g) => setGateOpen((p) => ({ ...p, [g]: !p[g] })), []);
  const toggleBuffer = useCallback((g) => setBufferOpen((p) => ({ ...p, [g]: !p[g] })), []);
  const setRowGates = useCallback((row, val) => setGateOpen((p) => { const n = { ...p }; row.forEach((g) => { n[g] = val; }); return n; }), []);
  const setRowBuffers = useCallback((row, val) => setBufferOpen((p) => { const n = { ...p }; row.forEach((g) => { n[g] = val; }); return n; }), []);

  const allGateOpen = (row) => row.every((g) => gateOpen[g]);
  const allBufferOpen = (row) => row.every((g) => bufferOpen[g]);

  const sectionTitleSx = { color: colors.tealAccent[500], mb: 2 };

  const { w: cW, h: cH, scale } = containerDims;

  return (
    <Box m="20px" sx={{ height: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column' }}>
      <Header title="Maintenance" subtitle="Machine maintenance and manual controls" />

      <Box ref={containerRef} sx={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        <Box sx={{
          position: 'absolute', top: 0, left: 0,
          width: cW > 0 ? `${cW / scale}px` : '100%',
          height: cH > 0 ? `${cH / scale}px` : '100%',
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          display: 'flex', flexDirection: 'column',
        }}>

        {/* Top: Mode + Machine Controls */}
        <Box display="flex" gap={16} mb={5} alignItems="flex-start" sx={{ flexShrink: 0 }}>
          <Box sx={{ minWidth: 240 }}>
            <Typography variant="h4" fontWeight="bold" sx={sectionTitleSx}>Machine Mode</Typography>
            <ToggleButtonGroup
              value={machineMode} exclusive
              disabled={isRunning}
              onChange={(_, v) => { if (v) setMachineMode(v); }}
              sx={{
                "& .MuiToggleButton-root": {
                  fontWeight: "bold", fontSize: "0.85rem", px: 3, py: 1, textTransform: "none",
                  color: colors.primary[700], borderColor: colors.primary[400],
                  "&.Mui-selected": { backgroundColor: colors.tealAccent[500], color: "#fff", "&:hover": { backgroundColor: colors.tealAccent[600] } },
                },
              }}
            >
              <ToggleButton value="normal">Normal</ToggleButton>
              <ToggleButton value="washing">Washing</ToggleButton>
            </ToggleButtonGroup>
          </Box>
          <Box sx={{ flex: 1 }}>
            <MachineControls layout="horizontal" machineStateOverride={maintMachineHook} activeRecipesCount={activeRecipeCount} styles={{ stateBadge: { px: 1.5, py: 0.4, borderRadius: 1.5, fontSize: "0.75rem" } }} />
          </Box>
        </Box>

        {/* Gate & Buffer Controls */}
        <Box sx={{ flex: 1, minHeight: 0 }}>
          <Typography variant="h4" fontWeight="bold" sx={sectionTitleSx}>Arms &amp; Buffer Controls</Typography>

          <Box sx={{ backgroundColor: isDark ? colors.primary[200] : colors.primary[100], borderRadius: 2, p: 3, border: `1px solid ${isDark ? colors.primary[400] : colors.primary[300]}` }}>

            {/* ===== TOP: G1–G4 LABELS ===== */}
            <Box display="flex" mb={1.5}>
              <GateLabelRow gates={TOP_ROW} colors={colors} />
              <Box sx={{ width: SIDE_WIDTH }} />
            </Box>

            {/* ===== TOP: BUFFERS (posts→button) ===== */}
            <Box display="flex" alignItems="stretch" mb={2.5}>
              <Box display="flex" flex={1} justifyContent="center">
                {TOP_ROW.map((g) => (
                  <BufferColumn key={`bt-${g}`} gate={g} isOpen={bufferOpen[g]} onToggle={toggleBuffer}
                    lampState={lampStates[g]}
                    colors={colors} isDark={isDark} position="top" disabled={isRunning} />
                ))}
              </Box>
              <SideBtn align="flex-end">
                <RowControlButton label="Top Buffers" allOpen={allBufferOpen(TOP_ROW)} onToggle={() => setRowBuffers(TOP_ROW, !allBufferOpen(TOP_ROW))} colors={colors} disabled={isRunning} />
              </SideBtn>
            </Box>

            {/* ===== TOP: ARMS (button→arm image pointing down) ===== */}
            <Box display="flex" alignItems="stretch" mb={0.5}>
              <Box display="flex" flex={1} justifyContent="center">
                {TOP_ROW.map((g) => (
                  <GateArm key={`ga-${g}`} gate={g} isOpen={gateOpen[g]} onToggle={toggleGate} colors={colors} isDark={isDark} position="top" disabled={isRunning} />
                ))}
              </Box>
              <SideBtn align="flex-start">
                <RowControlButton label="Top Arms" allOpen={allGateOpen(TOP_ROW)} onToggle={() => setRowGates(TOP_ROW, !allGateOpen(TOP_ROW))} colors={colors} disabled={isRunning} />
              </SideBtn>
            </Box>

            {/* ===== BOTTOM: ARMS (arm image pointing up→button) ===== */}
            <Box display="flex" alignItems="stretch" mb={2.5}>
              <Box display="flex" flex={1} justifyContent="center">
                {BOTTOM_ROW.map((g) => (
                  <GateArm key={`ga-${g}`} gate={g} isOpen={gateOpen[g]} onToggle={toggleGate} colors={colors} isDark={isDark} position="bottom" disabled={isRunning} />
                ))}
              </Box>
              <SideBtn align="flex-end">
                <RowControlButton label="Bottom Arms" allOpen={allGateOpen(BOTTOM_ROW)} onToggle={() => setRowGates(BOTTOM_ROW, !allGateOpen(BOTTOM_ROW))} colors={colors} disabled={isRunning} />
              </SideBtn>
            </Box>

            {/* ===== BOTTOM: BUFFERS (button→posts) ===== */}
            <Box display="flex" alignItems="stretch" mb={1.5}>
              <Box display="flex" flex={1} justifyContent="center">
                {BOTTOM_ROW.map((g) => (
                  <BufferColumn key={`bb-${g}`} gate={g} isOpen={bufferOpen[g]} onToggle={toggleBuffer}
                    lampState={lampStates[g]}
                    colors={colors} isDark={isDark} position="bottom" disabled={isRunning} />
                ))}
              </Box>
              <SideBtn align="flex-start">
                <RowControlButton label="Bottom Buffers" allOpen={allBufferOpen(BOTTOM_ROW)} onToggle={() => setRowBuffers(BOTTOM_ROW, !allBufferOpen(BOTTOM_ROW))} colors={colors} disabled={isRunning} />
              </SideBtn>
            </Box>

            {/* ===== BOTTOM: G5–G8 LABELS ===== */}
            <Box display="flex">
              <GateLabelRow gates={BOTTOM_ROW} colors={colors} />
              <Box sx={{ width: SIDE_WIDTH }} />
            </Box>

          </Box>
        </Box>

        </Box>
      </Box>
    </Box>
  );
};

export default Maintenance;
