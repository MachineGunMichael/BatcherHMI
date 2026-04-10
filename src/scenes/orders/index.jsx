import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Button,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  useTheme,
  Collapse,
  Alert,
  CircularProgress,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Tooltip,
  LinearProgress,
  Autocomplete,
} from '@mui/material';
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs from 'dayjs';
import { tokens } from '../../theme';
import { useAuth } from '../../auth/AuthContext';
import Header from '../../components/Header';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import RefreshIcon from '@mui/icons-material/Refresh';
import VisibilityIcon from '@mui/icons-material/Visibility';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5001';

const OrdersPage = () => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [expandedOrder, setExpandedOrder] = useState(null);
  
  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState(null);
  
  // Form state
  const [formData, setFormData] = useState({
    recipe_id: '',
    piece_min_weight_g: '',
    piece_max_weight_g: '',
    batch_min_weight_g: '',
    batch_max_weight_g: '',
    batch_type: 'NA',
    batch_value: '',
    requested_batches: '',
    due_date: '',
  });

  // Status colors using theme colors
  const statusConfig = {
    received: { color: colors.purpleAccent[500], label: 'Received' },
    assigned: { color: colors.orangeAccent[500], label: 'Queued' },
    'in-production': { color: colors.tealAccent[500], label: 'Assigned' },
    halted: { color: colors.redAccent[500], label: 'Halted' },
    completed: { color: colors.tealAccent[500], label: 'Completed' },
    'in-transit': { color: colors.orangeAccent[300], label: 'In Transit' },
    arrived: { color: colors.grey[500], label: 'Arrived' },
  };

  const fetchCustomers = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/customers`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setCustomers(data.customers || []);
      }
    } catch (err) {
      console.error('Failed to fetch customers:', err);
    }
  }, [isAdmin]);

  const fetchOrders = useCallback(async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      
      const response = await fetch(`${API_URL}/api/orders`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (!response.ok) throw new Error('Failed to fetch orders');
      
      const data = await response.json();
      setOrders(data.orders || []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchRecipes = useCallback(async (customerId) => {
    try {
      const token = localStorage.getItem('token');
      let url;
      if (customerId) {
        url = `${API_URL}/api/customers/${customerId}/recipes`;
      } else {
        url = `${API_URL}/api/settings/recipes`;
      }
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (response.ok) {
        const data = await response.json();
        setRecipes(data.recipes || []);
      }
    } catch (err) {
      console.error('Failed to fetch recipes:', err);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
    fetchCustomers();
  }, [fetchOrders, fetchCustomers]);

  useEffect(() => {
    if (selectedCustomer) {
      fetchRecipes(selectedCustomer);
    } else {
      fetchRecipes();
    }
  }, [selectedCustomer, fetchRecipes]);

  // Filter orders by selected customer (admin only)
  const filteredOrders = isAdmin && selectedCustomer
    ? orders.filter(o => o.customer_id === parseInt(selectedCustomer))
    : orders;

  // Separate active and history
  const activeOrders = filteredOrders.filter(o => !['completed', 'arrived'].includes(o.status));
  const orderHistory = filteredOrders.filter(o => ['completed', 'arrived'].includes(o.status));

  const handleCreateOrder = () => {
    setEditingOrder(null);
    setFormData({
      recipe_id: '',
      piece_min_weight_g: '',
      piece_max_weight_g: '',
      batch_min_weight_g: '',
      batch_max_weight_g: '',
      batch_type: 'NA',
      batch_value: '',
      requested_batches: '',
      due_date: '',
    });
    setDialogOpen(true);
  };

  const handleEditOrder = (order) => {
    if (order.status !== 'received') return;
    setEditingOrder(order);
    setFormData({
      recipe_id: order.recipe_id,
      piece_min_weight_g: order.piece_min_weight_g,
      piece_max_weight_g: order.piece_max_weight_g,
      batch_min_weight_g: order.batch_min_weight_g || '',
      batch_max_weight_g: order.batch_max_weight_g || '',
      batch_type: order.batch_type || 'NA',
      batch_value: order.batch_value || '',
      requested_batches: order.requested_batches,
      due_date: order.due_date ? order.due_date.split('T')[0] : '',
    });
    setDialogOpen(true);
  };

  const handleDeleteOrder = async (orderId) => {
    if (!window.confirm('Are you sure you want to cancel this order?')) return;
    
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/orders/${orderId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to cancel order');
      }
      
      setSuccessMessage('Order cancelled successfully');
      setTimeout(() => setSuccessMessage(''), 3000);
      fetchOrders();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSubmit = async () => {
    try {
      const token = localStorage.getItem('token');
      const url = editingOrder 
        ? `${API_URL}/api/orders/${editingOrder.id}`
        : `${API_URL}/api/orders`;
      
      const method = editingOrder ? 'PUT' : 'POST';
      
      const body = {
        ...formData,
        piece_min_weight_g: parseFloat(formData.piece_min_weight_g),
        piece_max_weight_g: parseFloat(formData.piece_max_weight_g),
        batch_min_weight_g: formData.batch_min_weight_g ? parseFloat(formData.batch_min_weight_g) : null,
        batch_max_weight_g: formData.batch_max_weight_g ? parseFloat(formData.batch_max_weight_g) : null,
        batch_value: formData.batch_value ? parseInt(formData.batch_value) : null,
        requested_batches: parseInt(formData.requested_batches),
        due_date: formData.due_date || null,
      };

      // Add customer_id for admin creating order
      if (isAdmin && !editingOrder && selectedCustomer) {
        body.customer_id = parseInt(selectedCustomer);
      }
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to save order');
      }
      
      setDialogOpen(false);
      setSuccessMessage(editingOrder ? 'Order updated successfully' : 'Order created successfully');
      setTimeout(() => setSuccessMessage(''), 3000);
      fetchOrders();
    } catch (err) {
      setError(err.message);
    }
  };

  const parseRecipeName = (name) => {
    if (!name || !name.startsWith('R_')) return null;
    try {
      const parts = name.split('_');
      return {
        pieceMin: parseInt(parts[1]) || 0,
        pieceMax: parseInt(parts[2]) || 0,
        batchMin: parseInt(parts[3]) || 0,
        batchMax: parseInt(parts[4]) || 0,
        countType: parts[5] === 'NA' ? 'NA' : (parts[5] || 'NA'),
        countVal: parts[6] === 'NA' || parts[6] === '0' ? '' : (parseInt(parts[6]) || ''),
      };
    } catch { return null; }
  };

  const handleRecipeSelect = (recipe) => {
    if (!recipe) {
      setFormData({
        ...formData,
        recipe_id: '',
        piece_min_weight_g: '',
        piece_max_weight_g: '',
        batch_min_weight_g: '',
        batch_max_weight_g: '',
        batch_type: 'NA',
        batch_value: '',
      });
      return;
    }

    const parsed = parseRecipeName(recipe.name);
    const val = (dbVal, parsedVal) => (dbVal != null && dbVal !== '') ? dbVal : (parsedVal || '');
    setFormData({
      ...formData,
      recipe_id: recipe.id,
      piece_min_weight_g: val(recipe.piece_min_weight_g, parsed?.pieceMin),
      piece_max_weight_g: val(recipe.piece_max_weight_g, parsed?.pieceMax),
      batch_min_weight_g: val(recipe.batch_min_weight_g, parsed?.batchMin),
      batch_max_weight_g: val(recipe.batch_max_weight_g, parsed?.batchMax),
      batch_type: parsed?.countType || 'NA',
      batch_value: parsed?.countVal || '',
    });
  };

  const handleToggleCustomerRecipeFavorite = async (recipeId, e) => {
    e.stopPropagation();
    if (!selectedCustomer) return;
    try {
      const token = localStorage.getItem('token');
      await fetch(`${API_URL}/api/customers/${selectedCustomer}/recipes/${recipeId}/favorite`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchRecipes(selectedCustomer);
    } catch (err) {
      console.error('Failed to toggle recipe favorite:', err);
    }
  };

  const handleDeleteRecipeFromCustomer = async (recipeId, recipeName, e) => {
    e.stopPropagation();
    if (!selectedCustomer) return;
    if (!window.confirm(`Remove recipe "${recipeName}" from this customer's list?`)) return;
    try {
      const token = localStorage.getItem('token');
      await fetch(`${API_URL}/api/customers/${selectedCustomer}/recipes/${recipeId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchRecipes(selectedCustomer);
    } catch (err) {
      console.error('Failed to remove recipe from customer:', err);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  };

  const getProgressPercent = (order) => {
    if (!order.requested_batches) return 0;
    return Math.min(100, (order.completed_batches / order.requested_batches) * 100);
  };

  // ============================================================
  // TABLE STYLING - Control colors for dark and light modes here
  // ============================================================
  const isDarkMode = theme.palette.mode === 'dark';
  
  // TABLE HEADER styling
  const tableHeaderSx = {
    fontWeight: 'bold',
    color: isDarkMode ? colors.grey[800] : colors.grey[800],
    borderBottom: `2px solid ${isDarkMode ? colors.grey[500] : colors.grey[300]}`,
    backgroundColor: isDarkMode ? colors.primary[200] : colors.primary[200],
    py: 1.5,
  };

  // TABLE ROW CELL styling
  const tableCellSx = {
    borderBottom: `1px solid ${isDarkMode ? colors.grey[400] : colors.grey[200]}`,
    color: isDarkMode ? colors.primary[800] : 'inherit',                     // Row text color
    py: 1.5,
  };
  
  // TABLE ROW HOVER styling (applied in TableRow sx prop)
  const tableRowHoverSx = {
    '&:hover': { 
      backgroundColor: isDarkMode ? colors.primary[500] : colors.grey[100], // Hover background
      '& .MuiTableCell-root': {
        color: isDarkMode ? colors.grey[800] : 'inherit',                   // Hover text color
      }
    },
    cursor: 'pointer',
  };
  
  // DETAILS BOX styling (expanded collapse section)
  const detailsBoxSx = {
    p: 2, 
    bgcolor: isDarkMode ? colors.primary[400] : colors.grey[100],           // Details box background
    borderRadius: 1, 
    my: 1,
  };
  
  // Details box text colors
  const detailsTitleColor = isDarkMode ? colors.grey[800] : colors.grey[800];
  const detailsLabelColor = isDarkMode ? colors.grey[100] : colors.grey[600];
  const detailsValueColor = isDarkMode ? colors.grey[800] : 'inherit';

  const formatDateTimeParts = (ts) => {
    if (!ts) return null;
    const d = new Date(ts);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return { date: `${dd}/${mm}/${yyyy}`, time };
  };

  const formatDuration = (startTs, endTs) => {
    if (!startTs || !endTs) return '-';
    const ms = new Date(endTs) - new Date(startTs);
    if (ms < 0) return '-';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const colW = { expand: '4%', orderId: '7%', customer: '13%', batches: '8%', progress: '14%', dueDate: '10%', status: '9%', col9: '8%', col10: '8%' };

  const renderActiveOrdersTable = (ordersList, title = '') => (
    <Box mb={4}>
      <Typography variant="h5" fontWeight="bold" color={colors.tealAccent[500]} mb={2}>
        {title} ({ordersList.length})
      </Typography>
      
      <Paper 
        elevation={0} 
        sx={{ 
          border: `1px solid ${isDarkMode ? 'inherit' : colors.grey[300]}`,
          borderRadius: '8px',
          overflow: 'hidden',
          backgroundColor: isDarkMode ? colors.primary[300] : 'inherit',
        }}
      >
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ ...tableHeaderSx, width: colW.expand }} />
                <TableCell sx={{ ...tableHeaderSx, width: colW.orderId }}>Order #</TableCell>
                {isAdmin && <TableCell sx={{ ...tableHeaderSx, width: colW.customer }}>Customer</TableCell>}
                <TableCell sx={tableHeaderSx}>Recipe</TableCell>
                <TableCell sx={{ ...tableHeaderSx, width: colW.batches }}>Batches</TableCell>
                <TableCell sx={{ ...tableHeaderSx, width: colW.progress }}>Progress</TableCell>
                <TableCell sx={{ ...tableHeaderSx, width: colW.dueDate }}>Due Date</TableCell>
                <TableCell sx={{ ...tableHeaderSx, width: colW.status }}>Status</TableCell>
                <TableCell sx={{ ...tableHeaderSx, width: colW.col9 }}>Gates</TableCell>
                <TableCell sx={{ ...tableHeaderSx, width: colW.col10 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {ordersList.map((order) => (
                <>
                  <TableRow 
                    key={order.id} 
                    hover
                    sx={tableRowHoverSx}
                    onClick={() => setExpandedOrder(expandedOrder === order.id ? null : order.id)}
                  >
                    <TableCell sx={tableCellSx}>
                      <IconButton size="small">
                        {expandedOrder === order.id ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                      </IconButton>
                    </TableCell>
                    <TableCell sx={tableCellSx}>
                      <Typography fontWeight="600" color={colors.primary[800]}>
                        #{order.id}
                      </Typography>
                    </TableCell>
                    {isAdmin && (
                      <TableCell sx={tableCellSx}>
                        <Typography variant="body2">{order.customer_name}</Typography>
                      </TableCell>
                    )}
                    <TableCell sx={tableCellSx}>
                      <Typography variant="body2" fontWeight="500">
                        {order.recipe_display_name || order.recipe_name}
                      </Typography>
                    </TableCell>
                    <TableCell sx={tableCellSx}>
                      <Typography variant="body2">
                        {order.completed_batches} / {order.requested_batches}
                      </Typography>
                    </TableCell>
                    <TableCell sx={tableCellSx}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <LinearProgress 
                          variant="determinate" 
                          value={getProgressPercent(order)} 
                          sx={{ 
                            flex: 1, 
                            height: 8, 
                            borderRadius: 4,
                            backgroundColor: colors.grey[300],
                            '& .MuiLinearProgress-bar': {
                              backgroundColor: colors.tealAccent[500],
                              borderRadius: 4,
                            }
                          }}
                        />
                        <Typography variant="caption" color={colors.grey[600]}>
                          {Math.round(getProgressPercent(order))}%
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell sx={tableCellSx}>
                      <Typography variant="body2">{formatDate(order.due_date)}</Typography>
                    </TableCell>
                    <TableCell sx={tableCellSx}>
                      <Chip 
                        label={statusConfig[order.status]?.label || order.status} 
                        size="small"
                        sx={{ 
                          bgcolor: statusConfig[order.status]?.color || colors.grey[400],
                          color: '#fff',
                          fontWeight: 'bold',
                          fontSize: '11px',
                        }}
                      />
                    </TableCell>
                    <TableCell sx={tableCellSx}>
                      <Typography variant="body2">
                        {JSON.parse(order.assigned_gates || '[]').join(', ') || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell sx={tableCellSx} onClick={(e) => e.stopPropagation()}>
                      {order.status === 'received' ? (
                        <Box display="flex" gap={0.5}>
                          <Tooltip title="Edit">
                            <IconButton 
                              size="small" 
                              onClick={() => handleEditOrder(order)}
                              sx={{ color: colors.tealAccent[500] }}
                            >
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Cancel">
                            <IconButton 
                              size="small" 
                              onClick={() => handleDeleteOrder(order.id)}
                              sx={{ color: colors.redAccent[500] }}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      ) : (
                        <Tooltip title="View Details">
                          <IconButton size="small" sx={{ color: colors.grey[500] }}>
                            <VisibilityIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell 
                      colSpan={isAdmin ? 11 : 10} 
                      sx={{ py: 0, borderBottom: expandedOrder === order.id ? `1px solid ${colors.grey[200]}` : 'none' }}
                    >
                      <Collapse in={expandedOrder === order.id}>
                        <Box sx={detailsBoxSx}>
                          <Typography variant="subtitle2" fontWeight="bold" color={detailsTitleColor} mb={1}>
                            Configuration Details
                          </Typography>
                          <Box display="grid" gridTemplateColumns="repeat(4, 1fr)" gap={2}>
                            <Box>
                              <Typography variant="caption" color={detailsLabelColor}>Piece Weight Range</Typography>
                              <Typography variant="body2" fontWeight="500" color={detailsValueColor}>
                                {order.piece_min_weight_g}g - {order.piece_max_weight_g}g
                              </Typography>
                            </Box>
                            <Box>
                              <Typography variant="caption" color={detailsLabelColor}>Batch Weight Range</Typography>
                              <Typography variant="body2" fontWeight="500" color={detailsValueColor}>
                                {order.batch_min_weight_g || '-'}g - {order.batch_max_weight_g || '-'}g
                              </Typography>
                            </Box>
                            <Box>
                              <Typography variant="caption" color={detailsLabelColor}>Type / Value</Typography>
                              <Typography variant="body2" fontWeight="500" color={detailsValueColor}>
                                {order.batch_type || 'NA'} / {order.batch_value || '-'}
                              </Typography>
                            </Box>
                            <Box>
                              <Typography variant="caption" color={detailsLabelColor}>Created</Typography>
                              <Typography variant="body2" fontWeight="500" color={detailsValueColor}>{formatDate(order.created_at)}</Typography>
                            </Box>
                          </Box>
                          
                          {order.status !== 'received' && (
                            <Box mt={2}>
                              <Typography variant="subtitle2" fontWeight="bold" color={detailsTitleColor} mb={1}>
                                Production Configuration
                              </Typography>
                              <Box display="grid" gridTemplateColumns="repeat(4, 1fr)" gap={2}>
                                <Box>
                                  <Typography variant="caption" color={detailsLabelColor}>Piece Weight</Typography>
                                  <Typography variant="body2" fontWeight="500" color={detailsValueColor}>
                                    {order.prod_piece_min_weight_g}g - {order.prod_piece_max_weight_g}g
                                  </Typography>
                                </Box>
                                <Box>
                                  <Typography variant="caption" color={detailsLabelColor}>Batch Weight</Typography>
                                  <Typography variant="body2" fontWeight="500" color={detailsValueColor}>
                                    {order.prod_batch_min_weight_g || '-'}g - {order.prod_batch_max_weight_g || '-'}g
                                  </Typography>
                                </Box>
                                <Box>
                                  <Typography variant="caption" color={detailsLabelColor}>Type / Value</Typography>
                                  <Typography variant="body2" fontWeight="500" color={detailsValueColor}>
                                    {order.prod_batch_type || 'NA'} / {order.prod_batch_value || '-'}
                                  </Typography>
                                </Box>
                              </Box>
                            </Box>
                          )}
                        </Box>
                      </Collapse>
                    </TableCell>
                  </TableRow>
                </>
              ))}
              {ordersList.length === 0 && (
                <TableRow>
                  <TableCell 
                    colSpan={isAdmin ? 11 : 10} 
                    align="center" 
                    sx={{ py: 4 }}
                  >
                    <Typography color={colors.grey[500]}>No orders found</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );

  const renderOrderHistoryTable = (ordersList, title = '') => (
    <Box mb={4}>
      <Typography variant="h5" fontWeight="bold" color={colors.tealAccent[500]} mb={2}>
        {title} ({ordersList.length})
      </Typography>
      
      <Paper 
        elevation={0} 
        sx={{ 
          border: `1px solid ${isDarkMode ? 'inherit' : colors.grey[300]}`,
          borderRadius: '8px',
          overflow: 'hidden',
          backgroundColor: isDarkMode ? colors.primary[300] : 'inherit',
        }}
      >
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ ...tableHeaderSx, width: colW.expand }} />
                <TableCell sx={{ ...tableHeaderSx, width: colW.orderId }}>Order #</TableCell>
                {isAdmin && <TableCell sx={{ ...tableHeaderSx, width: colW.customer }}>Customer</TableCell>}
                <TableCell sx={tableHeaderSx}>Recipe</TableCell>
                <TableCell sx={{ ...tableHeaderSx, width: colW.batches }}>Batches</TableCell>
                <TableCell sx={{ ...tableHeaderSx, width: colW.progress }}>Progress</TableCell>
                <TableCell sx={{ ...tableHeaderSx, width: colW.dueDate }}>Due Date</TableCell>
                <TableCell sx={{ ...tableHeaderSx, width: colW.status }}>Status</TableCell>
                <TableCell sx={{ ...tableHeaderSx, width: colW.col9 }}>Started</TableCell>
                <TableCell sx={{ ...tableHeaderSx, width: colW.col10 }}>Duration</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {ordersList.map((order) => (
                <>
                  <TableRow 
                    key={order.id} 
                    hover
                    sx={tableRowHoverSx}
                    onClick={() => setExpandedOrder(expandedOrder === order.id ? null : order.id)}
                  >
                    <TableCell sx={tableCellSx}>
                      <IconButton size="small">
                        {expandedOrder === order.id ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                      </IconButton>
                    </TableCell>
                    <TableCell sx={tableCellSx}>
                      <Typography fontWeight="600" color={colors.primary[800]}>
                        #{order.id}
                      </Typography>
                    </TableCell>
                    {isAdmin && (
                      <TableCell sx={tableCellSx}>
                        <Typography variant="body2">{order.customer_name}</Typography>
                      </TableCell>
                    )}
                    <TableCell sx={tableCellSx}>
                      <Typography variant="body2" fontWeight="500">
                        {order.recipe_display_name || order.recipe_name}
                      </Typography>
                    </TableCell>
                    <TableCell sx={tableCellSx}>
                      <Typography variant="body2">
                        {order.completed_batches} / {order.requested_batches}
                      </Typography>
                    </TableCell>
                    <TableCell sx={tableCellSx}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <LinearProgress 
                          variant="determinate" 
                          value={getProgressPercent(order)} 
                          sx={{ 
                            flex: 1, 
                            height: 8, 
                            borderRadius: 4,
                            backgroundColor: colors.grey[300],
                            '& .MuiLinearProgress-bar': {
                              backgroundColor: colors.tealAccent[500],
                              borderRadius: 4,
                            }
                          }}
                        />
                        <Typography variant="caption" color={colors.grey[600]}>
                          {Math.round(getProgressPercent(order))}%
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell sx={tableCellSx}>
                      <Typography variant="body2">{formatDate(order.due_date)}</Typography>
                    </TableCell>
                    <TableCell sx={tableCellSx}>
                      <Chip 
                        label={statusConfig[order.status]?.label || order.status} 
                        size="small"
                        sx={{ 
                          bgcolor: statusConfig[order.status]?.color || colors.grey[400],
                          color: '#fff',
                          fontWeight: 'bold',
                          fontSize: '11px',
                        }}
                      />
                    </TableCell>
                    <TableCell sx={tableCellSx}>
                      {(() => {
                        const parts = formatDateTimeParts(order.started_at);
                        if (!parts) return <Typography variant="body2">-</Typography>;
                        return (
                          <>
                            <Typography variant="body2">{parts.date}</Typography>
                            <Typography variant="body2" color="text.secondary">{parts.time}</Typography>
                          </>
                        );
                      })()}
                    </TableCell>
                    <TableCell sx={tableCellSx}>
                      <Typography variant="body2">
                        {formatDuration(order.started_at, order.finished_at)}
                      </Typography>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell 
                      colSpan={isAdmin ? 11 : 10} 
                      sx={{ py: 0, borderBottom: expandedOrder === order.id ? `1px solid ${colors.grey[200]}` : 'none' }}
                    >
                      <Collapse in={expandedOrder === order.id}>
                        <Box sx={detailsBoxSx}>
                          <Typography variant="subtitle2" fontWeight="bold" color={detailsTitleColor} mb={1}>
                            Configuration Details
                          </Typography>
                          <Box display="grid" gridTemplateColumns="repeat(4, 1fr)" gap={2}>
                            <Box>
                              <Typography variant="caption" color={detailsLabelColor}>Piece Weight Range</Typography>
                              <Typography variant="body2" fontWeight="500" color={detailsValueColor}>
                                {order.piece_min_weight_g}g - {order.piece_max_weight_g}g
                              </Typography>
                            </Box>
                            <Box>
                              <Typography variant="caption" color={detailsLabelColor}>Batch Weight Range</Typography>
                              <Typography variant="body2" fontWeight="500" color={detailsValueColor}>
                                {order.batch_min_weight_g || '-'}g - {order.batch_max_weight_g || '-'}g
                              </Typography>
                            </Box>
                            <Box>
                              <Typography variant="caption" color={detailsLabelColor}>Type / Value</Typography>
                              <Typography variant="body2" fontWeight="500" color={detailsValueColor}>
                                {order.batch_type || 'NA'} / {order.batch_value || '-'}
                              </Typography>
                            </Box>
                            <Box>
                              <Typography variant="caption" color={detailsLabelColor}>Created</Typography>
                              <Typography variant="body2" fontWeight="500" color={detailsValueColor}>{formatDate(order.created_at)}</Typography>
                            </Box>
                          </Box>
                          
                          <Box mt={2}>
                            <Typography variant="subtitle2" fontWeight="bold" color={detailsTitleColor} mb={1}>
                              Production Configuration
                            </Typography>
                            <Box display="grid" gridTemplateColumns="repeat(4, 1fr)" gap={2}>
                              <Box>
                                <Typography variant="caption" color={detailsLabelColor}>Piece Weight</Typography>
                                <Typography variant="body2" fontWeight="500" color={detailsValueColor}>
                                  {order.prod_piece_min_weight_g}g - {order.prod_piece_max_weight_g}g
                                </Typography>
                              </Box>
                              <Box>
                                <Typography variant="caption" color={detailsLabelColor}>Batch Weight</Typography>
                                <Typography variant="body2" fontWeight="500" color={detailsValueColor}>
                                  {order.prod_batch_min_weight_g || '-'}g - {order.prod_batch_max_weight_g || '-'}g
                                </Typography>
                              </Box>
                              <Box>
                                <Typography variant="caption" color={detailsLabelColor}>Type / Value</Typography>
                                <Typography variant="body2" fontWeight="500" color={detailsValueColor}>
                                  {order.prod_batch_type || 'NA'} / {order.prod_batch_value || '-'}
                                </Typography>
                              </Box>
                              <Box>
                                <Typography variant="caption" color={detailsLabelColor}>Finished</Typography>
                                {(() => {
                                  const parts = formatDateTimeParts(order.finished_at);
                                  if (!parts) return <Typography variant="body2" fontWeight="500" color={detailsValueColor}>-</Typography>;
                                  return <Typography variant="body2" fontWeight="500" color={detailsValueColor}>{parts.date} {parts.time}</Typography>;
                                })()}
                              </Box>
                            </Box>
                          </Box>
                        </Box>
                      </Collapse>
                    </TableCell>
                  </TableRow>
                </>
              ))}
              {ordersList.length === 0 && (
                <TableRow>
                  <TableCell 
                    colSpan={isAdmin ? 11 : 10} 
                    align="center" 
                    sx={{ py: 4 }}
                  >
                    <Typography color={colors.grey[500]}>No orders found</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="400px">
        <CircularProgress sx={{ color: colors.tealAccent[500] }} />
      </Box>
    );
  }

  return (
    <Box m="20px">
      <Header title="Orders" subtitle="Manage production orders" />

      {/* Admin customer selector */}
      {isAdmin && (
        <Box mb={3} display="flex" alignItems="center" gap={2}>
          <Autocomplete
            options={[{ id: '', name: 'All Customers' }, ...customers]}
            getOptionLabel={(option) => option.name || ''}
            value={
              selectedCustomer
                ? customers.find(c => String(c.id) === String(selectedCustomer)) || null
                : { id: '', name: 'All Customers' }
            }
            onChange={(_, newValue) => {
              setSelectedCustomer(newValue?.id ? String(newValue.id) : '');
            }}
            isOptionEqualToValue={(option, value) => String(option.id) === String(value.id)}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Select Customer"
                color="secondary"
              />
            )}
            sx={{ minWidth: 280 }}
            disableClearable
            size="small"
          />
          
          <IconButton onClick={fetchOrders} sx={{ color: colors.grey[600] }}>
            <RefreshIcon />
          </IconButton>
          
          <Box flex={1} />
          
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleCreateOrder}
            disabled={isAdmin && !selectedCustomer}
            sx={{
              bgcolor: colors.tealAccent[500],
              color: '#fff',
              '&:hover': { bgcolor: colors.tealAccent[600] },
              '&:disabled': { bgcolor: colors.grey[300] },
            }}
          >
            New Order
          </Button>
        </Box>
      )}

      {/* Customer view - just show new order button */}
      {!isAdmin && (
        <Box mb={3} display="flex" justifyContent="flex-end" gap={2}>
          <IconButton onClick={fetchOrders} sx={{ color: colors.grey[600] }}>
            <RefreshIcon />
          </IconButton>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleCreateOrder}
            sx={{
              bgcolor: colors.tealAccent[500],
              color: '#fff',
              '&:hover': { bgcolor: colors.tealAccent[600] },
            }}
          >
            New Order
          </Button>
        </Box>
      )}

      {/* Messages */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {successMessage && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccessMessage('')}>
          {successMessage}
        </Alert>
      )}

      {/* Active Orders */}
      {renderActiveOrdersTable(activeOrders, 'Active Orders')}

      {/* Order History */}
      {renderOrderHistoryTable(orderHistory, 'Order History')}

      {/* Create/Edit Order Dialog */}
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <Dialog 
          open={dialogOpen} 
          onClose={() => setDialogOpen(false)}
          maxWidth="md"
          fullWidth
          PaperProps={{
            sx: { borderRadius: '12px', maxHeight: '90vh' }
          }}
        >
          <DialogTitle sx={{ fontWeight: 'bold', color: colors.tealAccent[500] }}>
            {editingOrder ? 'Edit Order' : 'Place New Order'}
          </DialogTitle>
          <DialogContent sx={{ overflowY: 'auto' }}>
            <Box display="grid" gridTemplateColumns="1fr 1fr" gap={2.5} sx={{ mt: 2 }}>
              <Autocomplete
                options={recipes}
                getOptionLabel={(option) =>
                  option.display_name
                    ? `${option.display_name} (${option.name})`
                    : option.name
                }
                renderOption={(props, option) => {
                  const { key, ...otherProps } = props;
                  return (
                    <li key={option.id} {...otherProps} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
                        {option.is_favorite ? (
                          <StarIcon sx={{ color: colors.tealAccent[500], fontSize: '18px', mr: 1 }} />
                        ) : null}
                        <Typography noWrap sx={{ flex: 1 }}>
                          {option.display_name
                            ? `${option.display_name} (${option.name})`
                            : option.name
                          }
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', ml: 1, flexShrink: 0 }}>
                        <Tooltip title={option.is_favorite ? "Remove from favorites" : "Add to favorites"}>
                          <IconButton
                            size="small"
                            onClick={(e) => handleToggleCustomerRecipeFavorite(option.id, e)}
                            sx={{ p: 0.5 }}
                          >
                            {option.is_favorite ? (
                              <StarIcon sx={{ fontSize: '18px', color: colors.tealAccent[500] }} />
                            ) : (
                              <StarBorderIcon sx={{ fontSize: '18px', color: colors.grey[500] }} />
                            )}
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Remove recipe from customer">
                          <IconButton
                            size="small"
                            onClick={(e) => handleDeleteRecipeFromCustomer(option.id, option.display_name || option.name, e)}
                            sx={{ p: 0.5 }}
                          >
                            <DeleteOutlineIcon sx={{ fontSize: '18px', color: colors.redAccent[500] }} />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </li>
                  );
                }}
                value={formData.recipe_id ? recipes.find(r => r.id === formData.recipe_id) || null : null}
                onChange={(_, newValue) => handleRecipeSelect(newValue)}
                disabled={!!editingOrder}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Recipe"
                    color="secondary"
                    placeholder="Type to search (e.g., R_15_)"
                  />
                )}
                fullWidth
              />
              
              <TextField
                label="Requested Batches"
                type="number"
                color="secondary"
                value={formData.requested_batches}
                onChange={(e) => setFormData({ ...formData, requested_batches: e.target.value })}
                fullWidth
                required
              />
              
              <TextField
                label="Piece Min Weight (g)"
                type="number"
                color="secondary"
                value={formData.piece_min_weight_g}
                onChange={(e) => setFormData({ ...formData, piece_min_weight_g: e.target.value })}
                fullWidth
                required
              />
              
              <TextField
                label="Piece Max Weight (g)"
                type="number"
                color="secondary"
                value={formData.piece_max_weight_g}
                onChange={(e) => setFormData({ ...formData, piece_max_weight_g: e.target.value })}
                fullWidth
                required
              />
              
              <TextField
                label="Batch Min Weight (g)"
                type="number"
                color="secondary"
                value={formData.batch_min_weight_g}
                onChange={(e) => setFormData({ ...formData, batch_min_weight_g: e.target.value })}
                fullWidth
              />
              
              <TextField
                label="Batch Max Weight (g)"
                type="number"
                color="secondary"
                value={formData.batch_max_weight_g}
                onChange={(e) => setFormData({ ...formData, batch_max_weight_g: e.target.value })}
                fullWidth
              />
              
              <FormControl fullWidth color="secondary">
                <InputLabel color="secondary">Batch Type</InputLabel>
                <Select
                  value={formData.batch_type}
                  onChange={(e) => setFormData({ ...formData, batch_type: e.target.value })}
                  label="Batch Type"
                  color="secondary"
                >
                  <MenuItem value="NA">NA</MenuItem>
                  <MenuItem value="min">Min</MenuItem>
                  <MenuItem value="max">Max</MenuItem>
                  <MenuItem value="exact">Exact</MenuItem>
                </Select>
              </FormControl>
              
              <TextField
                label="Batch Value"
                type="number"
                color="secondary"
                value={formData.batch_value}
                onChange={(e) => setFormData({ ...formData, batch_value: e.target.value })}
                fullWidth
                disabled={formData.batch_type === 'NA'}
              />
              
              <DatePicker
                label="Due Date"
                value={formData.due_date ? dayjs(formData.due_date) : null}
                onChange={(newValue) => setFormData({ ...formData, due_date: newValue ? newValue.format('YYYY-MM-DD') : '' })}
                slotProps={{
                  textField: {
                    fullWidth: true,
                    color: 'secondary',
                  },
                }}
              />
            </Box>
          </DialogContent>
          <DialogActions sx={{ p: 2, gap: 1 }}>
            <Button 
              onClick={() => setDialogOpen(false)}
              variant="contained"
              sx={{ 
                bgcolor: colors.grey[500],
                color: '#fff',
                '&:hover': { bgcolor: colors.grey[600] },
              }}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleSubmit} 
              variant="contained"
              color="secondary"
            >
              {editingOrder ? 'Update Order' : 'Create Order'}
            </Button>
          </DialogActions>
        </Dialog>
      </LocalizationProvider>
    </Box>
  );
};

export default OrdersPage;
