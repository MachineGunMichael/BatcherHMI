import React from 'react';
import { 
  Card, 
  CardContent, 
  Typography, 
  Grid, 
  Box,
  Chip,
  Divider,
  useTheme
} from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import BalanceIcon from '@mui/icons-material/Balance';
import FactoryIcon from '@mui/icons-material/Factory';
import { tokens } from '../../theme';

const SimResultCard = ({ data }) => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  
  // Default data structure if no real data is provided yet
  const simulationData = data || {
    throughput: { value: 0, change: 0 },
    giveaway: { value: 0, change: 0 },
    rejects: { value: 0, change: 0 },
    recommendations: []
  };
  
  // Helper to determine icon and color based on trend
  const getTrendDetails = (change) => {
    if (change > 0) {
      return { 
        icon: <TrendingUpIcon />, 
        color: change > 0 ? colors.greenAccent[500] : colors.redAccent[500] 
      };
    } else if (change < 0) {
      return { 
        icon: <TrendingDownIcon />, 
        color: change < 0 ? colors.greenAccent[500] : colors.redAccent[500] 
      };
    }
    return { icon: null, color: 'inherit' };
  };

  return (
    <Card variant="outlined" sx={{ mb: 2 }}>
      <CardContent>
        <Typography variant="h5" gutterBottom>
          Simulation Insights
        </Typography>
        
        <Grid container spacing={2} sx={{ mb: 2 }}>
          {/* Throughput */}
          <Grid item xs={4}>
            <Box sx={{ textAlign: 'center' }}>
              <FactoryIcon sx={{ fontSize: 28, color: colors.blueAccent[400], mb: 1 }} />
              <Typography variant="body2" color="textSecondary">Throughput</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', mt: 0.5 }}>
                <Typography variant="h5">{simulationData.throughput.value.toFixed(1)}</Typography>
                {simulationData.throughput.change !== 0 && (
                  <Typography 
                    variant="caption" 
                    sx={{ 
                      ml: 1, 
                      display: 'flex', 
                      alignItems: 'center',
                      color: getTrendDetails(simulationData.throughput.change).color
                    }}
                  >
                    {getTrendDetails(simulationData.throughput.change).icon}
                    {simulationData.throughput.change > 0 ? '+' : ''}
                    {simulationData.throughput.change.toFixed(1)}%
                  </Typography>
                )}
              </Box>
            </Box>
          </Grid>
          
          {/* Giveaway */}
          <Grid item xs={4}>
            <Box sx={{ textAlign: 'center' }}>
              <BalanceIcon sx={{ fontSize: 28, color: colors.blueAccent[400], mb: 1 }} />
              <Typography variant="body2" color="textSecondary">Give-away</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', mt: 0.5 }}>
                <Typography variant="h5">{simulationData.giveaway.value.toFixed(2)}%</Typography>
                {simulationData.giveaway.change !== 0 && (
                  <Typography 
                    variant="caption" 
                    sx={{ 
                      ml: 1, 
                      display: 'flex', 
                      alignItems: 'center',
                      color: getTrendDetails(-simulationData.giveaway.change).color // Negative change is good
                    }}
                  >
                    {getTrendDetails(-simulationData.giveaway.change).icon}
                    {simulationData.giveaway.change > 0 ? '+' : ''}
                    {simulationData.giveaway.change.toFixed(2)}%
                  </Typography>
                )}
              </Box>
            </Box>
          </Grid>
          
          {/* Rejects */}
          <Grid item xs={4}>
            <Box sx={{ textAlign: 'center' }}>
              <Box sx={{ fontSize: 28, color: colors.blueAccent[400], mb: 1 }}>✗</Box>
              <Typography variant="body2" color="textSecondary">Rejects</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', mt: 0.5 }}>
                <Typography variant="h5">{simulationData.rejects.value.toFixed(2)}%</Typography>
                {simulationData.rejects.change !== 0 && (
                  <Typography 
                    variant="caption" 
                    sx={{ 
                      ml: 1, 
                      display: 'flex', 
                      alignItems: 'center',
                      color: getTrendDetails(-simulationData.rejects.change).color // Negative change is good
                    }}
                  >
                    {getTrendDetails(-simulationData.rejects.change).icon}
                    {simulationData.rejects.change > 0 ? '+' : ''}
                    {simulationData.rejects.change.toFixed(2)}%
                  </Typography>
                )}
              </Box>
            </Box>
          </Grid>
        </Grid>
        
        <Divider sx={{ my: 2 }} />
        
        <Typography variant="h6" gutterBottom>Recommendations</Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {simulationData.recommendations && simulationData.recommendations.map((rec, idx) => (
            <Chip 
              key={idx} 
              label={rec} 
              variant="outlined" 
              color="primary" 
            />
          ))}
          {(!simulationData.recommendations || simulationData.recommendations.length === 0) && (
            <Typography variant="body2" color="textSecondary">
              No specific recommendations available
            </Typography>
          )}
        </Box>
      </CardContent>
    </Card>
  );
};

export default SimResultCard;
