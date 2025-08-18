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


const PlanAssist = () => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);

  // Get context with more explicit error handling and logging
  const context = useAppContext();
  

  
  return (
    <Box m="20px">
      <Header title="PlanAssist" subtitle="Production planner assistant" />


    </Box>
  );
};

export default PlanAssist;