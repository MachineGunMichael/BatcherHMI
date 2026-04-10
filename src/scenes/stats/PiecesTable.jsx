import React, { useState, useEffect, useCallback, useRef, useLayoutEffect } from "react";
import {
  Box,
  Typography,
  useTheme,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
} from "@mui/material";
import CheckIcon from "@mui/icons-material/Check";
import { tokens } from "../../theme";

const API_BASE = process.env.REACT_APP_API_BASE || "";

const PiecesTable = () => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  const isDarkMode = theme.palette.mode === "dark";

  const [pieces, setPieces] = useState([]);
  const [loading, setLoading] = useState(true);
  const bodyRef = useRef(null);
  const [scrollbarW, setScrollbarW] = useState(0);

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el) {
      const sw = el.offsetWidth - el.clientWidth;
      if (sw !== scrollbarW) setScrollbarW(sw);
    }
  });

  // ============================================================
  // STATUS COLORS — edit these to change Batched/Rejected badge appearance
  // ============================================================
  const statusColors = {
    batchedText: isDarkMode ? `${colors.primary[800]}` : colors.tealAccent[500],
    batchedBg: isDarkMode ? `${colors.tealAccent[500]}` : `${colors.tealAccent[500]}22`,
    rejectedText: isDarkMode ? `${colors.primary[800]}` : colors.redAccent[500],
    rejectedBg: isDarkMode ? `${colors.redAccent[500]}` : `${colors.redAccent[500]}22`,
  };
  // ============================================================

  const tableHeaderSx = {
    fontWeight: "bold",
    color: isDarkMode ? colors.grey[800] : colors.grey[800],
    borderBottom: `2px solid ${isDarkMode ? colors.grey[500] : colors.grey[300]}`,
    backgroundColor: `${isDarkMode ? colors.primary[200] : colors.primary[200]} !important`,
    py: 1,
    px: 1,
    fontSize: "0.8rem",
    whiteSpace: "nowrap",
  };

  const tableCellSx = {
    borderBottom: `1px solid ${isDarkMode ? colors.grey[400] : colors.grey[200]}`,
    color: isDarkMode ? colors.primary[800] : "inherit",
    py: 0.75,
    px: 1,
    fontSize: "0.8rem",
  };

  const tableRowHoverSx = {
    "&:hover": {
      backgroundColor: isDarkMode ? colors.primary[500] : colors.grey[100],
      "& .MuiTableCell-root": {
        color: isDarkMode ? colors.grey[800] : "inherit",
      },
    },
  };

  const colWidths = ["7%", "9%", "7%", "8%", "7%", "7%", "7%", "7%", "5%", "7%", "5%"];

  const fetchPieces = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const resp = await fetch(`${API_BASE}/api/stats/pieces-log?limit=2000`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.ok) {
        const data = await resp.json();
        setPieces(data);
      }
    } catch (err) {
      console.error("Failed to fetch pieces:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPieces();
    const interval = setInterval(fetchPieces, 5000);
    return () => clearInterval(interval);
  }, [fetchPieces]);

  const formatDate = (ts) => {
    if (!ts) return "-";
    const d = new Date(ts);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}/${mm}/${yy}`;
  };

  const formatTime = (ts) => {
    if (!ts) return "-";
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    const ms = String(d.getMilliseconds()).padStart(3, "0");
    return `${hh}:${mm}:${ss}.${ms}`;
  };

  const formatMs = (ms) => {
    if (ms == null) return "-";
    return ms.toLocaleString(undefined, { maximumFractionDigits: 1 });
  };

  if (loading && pieces.length === 0) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" py={8}>
        <CircularProgress sx={{ color: colors.tealAccent[500] }} />
      </Box>
    );
  }

  const headerLabels = [
    "Date", "Time", "Δt (ms)", "Loc Δt (ms)", "Status",
    "Piece ID", "Weight (g)", "Length (mm)", "Gate", "Calc (ms)", "Last",
  ];

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "calc(100vh - 240px)" }}>
      <Typography
        variant="h5"
        fontWeight="bold"
        color={isDarkMode ? colors.primary[800] : colors.primary[800]}
        mb={1}
      >
        Last {pieces.length.toLocaleString()} Pieces
      </Typography>

      <Paper
        elevation={0}
        sx={{
          border: `1px solid ${isDarkMode ? "inherit" : colors.grey[300]}`,
          borderRadius: "8px",
          overflow: "hidden",
          backgroundColor: isDarkMode ? colors.primary[300] : "inherit",
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Box sx={{ flexShrink: 0, overflowX: "hidden", backgroundColor: isDarkMode ? colors.primary[200] : colors.primary[200] }}>
          <Table size="small" sx={{ tableLayout: "fixed", width: scrollbarW ? `calc(100% - ${scrollbarW}px)` : "100%" }}>
            <colgroup>
              {colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
            </colgroup>
            <TableHead>
              <TableRow>
                {headerLabels.map((label, i) => (
                  <TableCell
                    key={label}
                    align={i === headerLabels.length - 1 ? "center" : "left"}
                    sx={tableHeaderSx}
                  >
                    {label}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
          </Table>
        </Box>
        <Box ref={bodyRef} sx={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
          <Table size="small" sx={{ tableLayout: "fixed" }}>
            <colgroup>
              {colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
            </colgroup>
            <TableBody>
              {pieces.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} align="center" sx={{ py: 4 }}>
                    <Typography variant="body2" color={colors.grey[500]}>
                      No pieces recorded yet
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                pieces.map((p) => (
                  <TableRow key={p.id} sx={tableRowHoverSx}>
                    <TableCell sx={tableCellSx}>{formatDate(p.created_at)}</TableCell>
                    <TableCell sx={tableCellSx}>{formatTime(p.created_at)}</TableCell>
                    <TableCell sx={tableCellSx}>{formatMs(p.delta_ms)}</TableCell>
                    <TableCell sx={tableCellSx}>{formatMs(p.location_delta_ms)}</TableCell>
                    <TableCell sx={tableCellSx}>
                      <Box
                        component="span"
                        sx={{
                          px: 1,
                          py: 0.25,
                          borderRadius: "4px",
                          fontSize: "0.75rem",
                          fontWeight: "bold",
                          backgroundColor: p.status === "batched" ? statusColors.batchedBg : statusColors.rejectedBg,
                          color: p.status === "batched" ? statusColors.batchedText : statusColors.rejectedText,
                        }}
                      >
                        {p.status === "batched" ? "Batched" : "Rejected"}
                      </Box>
                    </TableCell>
                    <TableCell sx={tableCellSx}>{p.piece_id}</TableCell>
                    <TableCell sx={tableCellSx}>{p.weight_g?.toFixed(1)}</TableCell>
                    <TableCell sx={tableCellSx}>{p.length_mm != null ? p.length_mm.toFixed(1) : "-"}</TableCell>
                    <TableCell sx={tableCellSx}>
                      {p.gate === 0 ? (
                        <Typography
                          component="span"
                          sx={{ fontSize: "0.8rem", color: colors.redAccent[500] }}
                        >
                          REJ
                        </Typography>
                      ) : (
                        p.gate
                      )}
                    </TableCell>
                    <TableCell sx={tableCellSx}>
                      {p.calculation_time_ms != null ? p.calculation_time_ms.toFixed(2) : "-"}
                    </TableCell>
                    <TableCell sx={{ ...tableCellSx, textAlign: "center" }}>
                      {p.is_last_piece ? (
                        <CheckIcon sx={{ fontSize: 18, color: colors.tealAccent[500] }} />
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Box>
      </Paper>

    </Box>
  );
};

export default PiecesTable;
