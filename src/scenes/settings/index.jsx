import React, { useState, useEffect } from "react";
import {
  Box,
  Button,
  TextField,
  Typography,
  useTheme,
  FormControl,
  FormLabel,
  RadioGroup,
  FormControlLabel,
  Radio,
  Select,
  MenuItem,
  InputLabel,
  Checkbox,
} from "@mui/material";
import Header from "../../components/Header";
import { tokens } from "../../theme";
import { useAppContext } from "../../context/AppContext";

// Mock definitions for pre-specified programs
const presetPrograms = {
  alpha: {
    name: "Alpha Program",
    params: {
      pieceMinWeight: 10,
      pieceMaxWeight: 20,
      batchMinWeight: 100,
      batchMaxWeight: 200,
      minSize: 1,
      maxSize: 5,
    },
    gates: [1, 2],
  },
  beta: {
    name: "Beta Program",
    params: {
      pieceMinWeight: 15,
      pieceMaxWeight: 30,
      batchMinWeight: 150,
      batchMaxWeight: 300,
      minSize: 2,
      maxSize: 6,
    },
    gates: [3, 4, 5],
  },
  gamma: {
    name: "Gamma Program",
    params: {
      pieceMinWeight: 20,
      pieceMaxWeight: 40,
      batchMinWeight: 200,
      batchMaxWeight: 400,
      minSize: 3,
      maxSize: 7,
    },
    gates: [6, 7, 8],
  },
};

// Mapping for display labels
const fieldLabels = {
  pieceMinWeight: "Piece Min Weight (g)",
  pieceMaxWeight: "Piece Max Weight (g)",
  batchMinWeight: "Batch Min Weight (g)",
  batchMaxWeight: "Batch Max Weight (g)",
  minSize: "Min Size (count)",
  maxSize: "Max Size (count)",
};

const Settings = () => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);

  // Use context state instead of local state
  const { 
    settingsMode, 
    setSettingsMode, 
    assignedPrograms, 
    setAssignedPrograms 
  } = useAppContext();

  // Keep local states for form fields
  const [selectedProgram, setSelectedProgram] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualValues, setManualValues] = useState({
    pieceMinWeight: "",
    pieceMaxWeight: "",
    batchMinWeight: "",
    batchMaxWeight: "",
    minSize: "",
    maxSize: "",
  });
  const [manualGates, setManualGates] = useState([]);
  const [sendSubmitted, setSendSubmitted] = useState(false);
  const [addError, setAddError] = useState(false);

  // Clear the success message after 5 seconds
  useEffect(() => {
    let timer;
    if (sendSubmitted) {
      timer = setTimeout(() => setSendSubmitted(false), 5000);
    }
    return () => clearTimeout(timer);
  }, [sendSubmitted]);

  // Updated handlers to use context state
  const handleModeChange = (e) => {
    setSettingsMode(e.target.value);
    setAddError(false);
  };

  // Keep these handlers for local state
  const handleProgramChange = (e) => setSelectedProgram(e.target.value);
  const handleManualName = (e) => setManualName(e.target.value);
  const handleManualChange = (field) => (e) =>
    setManualValues({ ...manualValues, [field]: e.target.value });
  const toggleGate = (gate) => () =>
    setManualGates((prev) =>
      prev.includes(gate) ? prev.filter((g) => g !== gate) : [...prev, gate]
    );

  // Update these handlers to use context state for assignedPrograms
  const handleAddPreset = () => {
    if (!selectedProgram) return;
    const prog = presetPrograms[selectedProgram];
    setAssignedPrograms([
      ...assignedPrograms,
      { type: "preset", name: prog.name, params: prog.params, gates: prog.gates },
    ]);
    setSelectedProgram("");
  };

  const handleAddManual = () => {
    const allFilled =
      manualName &&
      Object.values(manualValues).every((v) => v !== "") &&
      manualGates.length > 0;
    if (!allFilled) {
      setAddError(true);
      return;
    }
    setAssignedPrograms([
      ...assignedPrograms,
      { type: "manual", name: manualName, params: manualValues, gates: manualGates },
    ]);
    setManualName("");
    setManualValues({
      pieceMinWeight: "",
      pieceMaxWeight: "",
      batchMinWeight: "",
      batchMaxWeight: "",
      minSize: "",
      maxSize: "",
    });
    setManualGates([]);
    setAddError(false);
  };

  const handleRemove = (index) => () => {
    setAssignedPrograms(assignedPrograms.filter((_, i) => i !== index));
  };

  const handleSendPrograms = () => setSendSubmitted(true);

  // Disable logic remains the same, but uses context state
  const usedPresetKeys = assignedPrograms
    .filter((p) => p.type === "preset")
    .map((p) =>
      Object.keys(presetPrograms).find((key) => presetPrograms[key].name === p.name)
    );
  const usedGates = assignedPrograms.flatMap((p) => p.gates);

  return (
    <Box m="20px">
      <Header title="Settings" subtitle="Set up production settings" />

      <Box mt="70px" display="flex" gap={4}>
        {/* Left: Configuration Form */}
        <Box flex={1} maxWidth="600px">
          <FormControl component="fieldset" fullWidth>
            <FormLabel component="legend">
              <Typography
                variant="h4"
                fontWeight="bold"
                sx={{ mb: 2, color: colors.tealAccent[500] }}
              >
                Program Selection
              </Typography>
            </FormLabel>
            <RadioGroup row value={settingsMode} onChange={handleModeChange} name="program-mode">
              <FormControlLabel
                value="preset"
                control={<Radio color="secondary" />}
                label="Pre‑specified Program"
              />
              <FormControlLabel
                value="manual"
                control={<Radio color="secondary" />}
                label="Manual Setup"
              />
            </RadioGroup>
          </FormControl>

          {/* Preset Programs */}
          {settingsMode === "preset" && (
            <Box mt={2} display="flex" flexDirection="column" gap={2}>
              <FormControl fullWidth>
                <InputLabel id="preset-label" color="secondary">
                  Select Program
                </InputLabel>
                <Select
                  labelId="preset-label"
                  value={selectedProgram}
                  label="Select Program"
                  onChange={handleProgramChange}
                  color="secondary"
                >
                  {Object.keys(presetPrograms).map((key) => (
                    <MenuItem
                      key={key}
                      value={key}
                      disabled={
                        usedPresetKeys.includes(key) ||
                        presetPrograms[key].gates.some((g) => usedGates.includes(g))
                      }
                    >
                      {presetPrograms[key].name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button variant="contained" color="secondary" onClick={handleAddPreset}>
                Add Program
              </Button>
            </Box>
          )}

          {/* Manual Setup */}
          {settingsMode === "manual" && (
            <Box mt={2} display="flex" flexDirection="column" gap={2}>
              <TextField
                label="Program Name"
                value={manualName}
                onChange={handleManualName}
                color="secondary"
                error={addError && !manualName}
                fullWidth
              />
              <Typography variant="h6">Select Gates:</Typography>
              <Box display="grid" gridTemplateColumns="repeat(4, 1fr)" gap={1}>
                {Array.from({ length: 8 }, (_, i) => i + 1).map((gate) => (
                  <FormControlLabel
                    key={gate}
                    control={
                      <Checkbox
                        checked={manualGates.includes(gate)}
                        onChange={toggleGate(gate)}
                        disabled={usedGates.includes(gate)}
                        color="secondary"
                      />
                    }
                    label={`Gate ${gate}`}
                  />
                ))}
              </Box>
              {Object.entries(fieldLabels).map(([field, label]) => (
                <TextField
                  key={field}
                  label={label}
                  type="number"
                  color="secondary"
                  fullWidth
                  value={manualValues[field]}
                  onChange={handleManualChange(field)}
                  error={addError && manualValues[field] === ""}
                />
              ))}
              <Button variant="contained" color="secondary" onClick={handleAddManual}>
                Add Program
              </Button>
              {addError && (
                <Typography variant="body2" sx={{ color: colors.redAccent[500], mt: 1 }}>
                  Please fill in all fields
                </Typography>
              )}
            </Box>
          )}
        </Box>

        {/* Right: Assigned Programs Display */}
        <Box
          flex={1}
          sx={{
            overflowY: "auto",
            maxHeight: "calc(100vh - 200px)",
            pr: 2,
          }}
        >
          <Typography
            variant="h4"
            fontWeight="bold"
            sx={{ mb: 2, color: colors.tealAccent[500] }}
          >
            Assigned Programs
          </Typography>

          {assignedPrograms.length === 0 ? (
            <Typography>No programs assigned.</Typography>
          ) : (
            assignedPrograms.map((p, i) => (
              <Box
                key={i}
                mb={2}
                p={2}
                sx={{ backgroundColor: colors.primary[200], borderRadius: 1 }}
              >
                <Box display="flex" justifyContent="space-between" alignItems="center">
                  <Typography color="secondary" variant="h5" fontWeight="bold">{p.name}</Typography>
                  <Button sx={{ color: colors.redAccent[500] }} size="small" onClick={handleRemove(i)}>
                    Remove
                  </Button>
                </Box>

                {/* Three-column grid for details */}
                <Box display="grid" gridTemplateColumns="repeat(3, 1fr)" gap={2} mt={1}>
                  <Typography variant="body2">
                    <strong>Gates:</strong> {p.gates.join(", ")}
                  </Typography>
                  {Object.entries(p.params).map(([key, value]) => (
                    <Typography key={key} variant="body2">
                      <strong>{fieldLabels[key]}:</strong> {value}
                    </Typography>
                  ))}
                </Box>
              </Box>
            ))
          )}

          {assignedPrograms.length > 0 && (
            <Button variant="contained" color="secondary" onClick={handleSendPrograms}>
              Send Programs
            </Button>
          )}

          {sendSubmitted && (
            <Typography variant="body1" sx={{ color: colors.tealAccent[400], mt: 2 }}>
              Programs successfully sent to the machine.
            </Typography>
          )}
        </Box>
      </Box>
    </Box>
  );
};

export default Settings;