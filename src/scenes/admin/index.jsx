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
  Alert,
  CircularProgress,
  Tabs,
  Tab,
  Tooltip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import { tokens } from '../../theme';
import Header from '../../components/Header';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import RefreshIcon from '@mui/icons-material/Refresh';
import PersonIcon from '@mui/icons-material/Person';
import BusinessIcon from '@mui/icons-material/Business';

const API_URL = process.env.REACT_APP_API_URL || '';

const AdminPage = () => {
  const theme = useTheme();
  const colors = tokens(theme.palette.mode);
  
  const [tabValue, setTabValue] = useState(0);
  const [customers, setCustomers] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  
  // Customer dialog state
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [customerForm, setCustomerForm] = useState({
    name: '',
    address: '',
    contact_email: '',
    contact_phone: '',
    notes: '',
  });
  
  // User dialog state
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [userForm, setUserForm] = useState({
    username: '',
    password: '',
    role: 'operator',
    name: '',
    customer_id: '',
  });

  // Role colors using theme
  const roleConfig = {
    admin: { color: colors.redAccent[500], label: 'Admin' },
    manager: { color: colors.tealAccent[500], label: 'Manager' },
    operator: { color: colors.orangeAccent[500], label: 'Operator' },
    customer: { color: colors.purpleAccent[500], label: 'Customer' },
  };

  const fetchCustomers = useCallback(async () => {
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
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setUsers(data.users || []);
      }
    } catch (err) {
      console.error('Failed to fetch users:', err);
    }
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchCustomers(), fetchUsers()]);
    setLoading(false);
  }, [fetchCustomers, fetchUsers]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Customer handlers
  const handleCreateCustomer = () => {
    setEditingCustomer(null);
    setCustomerForm({ name: '', address: '', contact_email: '', contact_phone: '', notes: '' });
    setCustomerDialogOpen(true);
  };

  const handleEditCustomer = (customer) => {
    setEditingCustomer(customer);
    setCustomerForm({
      name: customer.name,
      address: customer.address || '',
      contact_email: customer.contact_email || '',
      contact_phone: customer.contact_phone || '',
      notes: customer.notes || '',
    });
    setCustomerDialogOpen(true);
  };

  const handleDeleteCustomer = async (customerId) => {
    if (!window.confirm('Are you sure you want to delete this customer? This will also delete all their orders.')) return;
    
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/customers/${customerId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to delete customer');
      }
      
      setSuccessMessage('Customer deleted successfully');
      setTimeout(() => setSuccessMessage(''), 3000);
      fetchCustomers();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSubmitCustomer = async () => {
    try {
      const token = localStorage.getItem('token');
      const url = editingCustomer 
        ? `${API_URL}/api/customers/${editingCustomer.id}`
        : `${API_URL}/api/customers`;
      
      const response = await fetch(url, {
        method: editingCustomer ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(customerForm),
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to save customer');
      }
      
      setCustomerDialogOpen(false);
      setSuccessMessage(editingCustomer ? 'Customer updated' : 'Customer created');
      setTimeout(() => setSuccessMessage(''), 3000);
      fetchCustomers();
    } catch (err) {
      setError(err.message);
    }
  };

  // User handlers
  const handleCreateUser = () => {
    setEditingUser(null);
    setUserForm({ username: '', password: '', role: 'operator', name: '', customer_id: '' });
    setUserDialogOpen(true);
  };

  const handleEditUser = (user) => {
    setEditingUser(user);
    setUserForm({
      username: user.username,
      password: '', // Don't show password
      role: user.role,
      name: user.name,
      customer_id: user.customer_id || '',
    });
    setUserDialogOpen(true);
  };

  const handleDeleteUser = async (userId) => {
    if (!window.confirm('Are you sure you want to delete this user?')) return;
    
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/users/${userId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to delete user');
      }
      
      setSuccessMessage('User deleted successfully');
      setTimeout(() => setSuccessMessage(''), 3000);
      fetchUsers();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSubmitUser = async () => {
    try {
      const token = localStorage.getItem('token');
      const url = editingUser 
        ? `${API_URL}/api/users/${editingUser.id}`
        : `${API_URL}/api/users`;
      
      const body = { ...userForm };
      if (editingUser && !body.password) {
        delete body.password; // Don't send empty password on edit
      }
      if (body.role !== 'customer') {
        delete body.customer_id;
      }
      
      const response = await fetch(url, {
        method: editingUser ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to save user');
      }
      
      setUserDialogOpen(false);
      setSuccessMessage(editingUser ? 'User updated' : 'User created');
      setTimeout(() => setSuccessMessage(''), 3000);
      fetchUsers();
    } catch (err) {
      setError(err.message);
    }
  };

  const isDarkMode = theme.palette.mode === 'dark';

  // Table styling
  const tableHeaderSx = {
    fontWeight: 'bold',
    color: isDarkMode ? colors.grey[800] : colors.grey[800],
    borderBottom: `2px solid ${isDarkMode ? colors.grey[500] : colors.grey[300]}`,
    backgroundColor: isDarkMode ? colors.primary[200] : colors.primary[200],
    py: 1.5,
  };

  const tableCellSx = {
    borderBottom: `1px solid ${isDarkMode ? colors.grey[400] : colors.grey[200]}`,
    color: isDarkMode ? colors.primary[800] : 'inherit',
    py: 1.5,
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString();
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height="400px">
        <CircularProgress sx={{ color: colors.tealAccent[500] }} />
      </Box>
    );
  }

  return (
    <Box m="20px">
      <Header title="Administration" subtitle="Manage customers and users" />

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

      {/* Tabs */}
      <Paper 
        elevation={0} 
        sx={{ 
          border: `1px solid ${isDarkMode ? colors.grey[600] : colors.grey[300]}`,
          borderRadius: '8px',
          mb: 3,
        }}
      >
        <Tabs 
          value={tabValue} 
          onChange={(e, v) => setTabValue(v)}
          sx={{
            borderBottom: `1px solid ${isDarkMode ? colors.grey[600] : colors.grey[300]}`,
            '& .MuiTab-root': {
              textTransform: 'none',
              fontWeight: 600,
              fontSize: '14px',
              color: isDarkMode ? colors.grey[500] : colors.grey[500],
            },
            '& .Mui-selected': {
              color: `${colors.tealAccent[500]} !important`,
            },
            '& .MuiTabs-indicator': {
              backgroundColor: colors.tealAccent[500],
              height: 3,
              borderRadius: '3px 3px 0 0',
            },
          }}
        >
          <Tab icon={<BusinessIcon />} iconPosition="start" label={`Customers (${customers.length})`} />
          <Tab icon={<PersonIcon />} iconPosition="start" label={`Users (${users.length})`} />
        </Tabs>

        <Box p={2}>
          {/* Customers Tab */}
          {tabValue === 0 && (
            <>
              <Box display="flex" justifyContent="flex-end" mb={2} gap={1}>
                <IconButton onClick={fetchCustomers} sx={{ color: colors.grey[600] }}>
                  <RefreshIcon />
                </IconButton>
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={handleCreateCustomer}
                  sx={{
                    bgcolor: colors.tealAccent[500],
                    color: '#fff',
                    '&:hover': { bgcolor: colors.tealAccent[600] },
                  }}
                >
                  Add Customer
                </Button>
              </Box>

              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={tableHeaderSx}>ID</TableCell>
                      <TableCell sx={tableHeaderSx}>Name</TableCell>
                      <TableCell sx={tableHeaderSx}>Email</TableCell>
                      <TableCell sx={tableHeaderSx}>Phone</TableCell>
                      <TableCell sx={tableHeaderSx}>Orders</TableCell>
                      <TableCell sx={tableHeaderSx}>Created</TableCell>
                      <TableCell sx={{ ...tableHeaderSx, width: 100 }}>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {customers.map((customer) => (
                      <TableRow key={customer.id} hover>
                        <TableCell sx={tableCellSx}>
                          <Typography fontWeight="600">
                            #{customer.id}
                          </Typography>
                        </TableCell>
                        <TableCell sx={tableCellSx}>
                          <Typography fontWeight="500">{customer.name}</Typography>
                        </TableCell>
                        <TableCell sx={tableCellSx}>{customer.contact_email || '-'}</TableCell>
                        <TableCell sx={tableCellSx}>{customer.contact_phone || '-'}</TableCell>
                        <TableCell sx={tableCellSx}>
                          <Chip 
                            label={`${customer.active_orders || 0} active / ${customer.total_orders || 0} total`}
                            size="small"
                            sx={{ 
                              bgcolor: colors.grey[200],
                              color: colors.grey[700],
                              fontSize: '11px',
                            }}
                          />
                        </TableCell>
                        <TableCell sx={tableCellSx}>{formatDate(customer.created_at)}</TableCell>
                        <TableCell sx={tableCellSx}>
                          <Box display="flex" gap={0.5}>
                            <Tooltip title="Edit">
                              <IconButton 
                                size="small" 
                                onClick={() => handleEditCustomer(customer)}
                                sx={{ color: colors.tealAccent[600] }}
                              >
                                <EditIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Delete">
                              <IconButton 
                                size="small" 
                                onClick={() => handleDeleteCustomer(customer.id)}
                                sx={{ color: colors.redAccent[500] }}
                              >
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </Box>
                        </TableCell>
                      </TableRow>
                    ))}
                    {customers.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                          <Typography color={colors.grey[500]}>No customers found</Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          )}

          {/* Users Tab */}
          {tabValue === 1 && (
            <>
              <Box display="flex" justifyContent="flex-end" mb={2} gap={1}>
                <IconButton onClick={fetchUsers} sx={{ color: colors.grey[600] }}>
                  <RefreshIcon />
                </IconButton>
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  onClick={handleCreateUser}
                  sx={{
                    bgcolor: colors.tealAccent[500],
                    color: '#fff',
                    '&:hover': { bgcolor: colors.tealAccent[600] },
                  }}
                >
                  Add User
                </Button>
              </Box>

              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={tableHeaderSx}>ID</TableCell>
                      <TableCell sx={tableHeaderSx}>Username</TableCell>
                      <TableCell sx={tableHeaderSx}>Name</TableCell>
                      <TableCell sx={tableHeaderSx}>Role</TableCell>
                      <TableCell sx={tableHeaderSx}>Customer Link</TableCell>
                      <TableCell sx={tableHeaderSx}>Created</TableCell>
                      <TableCell sx={{ ...tableHeaderSx, width: 100 }}>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {users.map((user) => {
                      const linkedCustomer = customers.find(c => c.id === user.customer_id);
                      return (
                        <TableRow key={user.id} hover>
                          <TableCell sx={tableCellSx}>
                            <Typography fontWeight="600">
                              #{user.id}
                            </Typography>
                          </TableCell>
                          <TableCell sx={tableCellSx}>
                            <Typography fontWeight="500">{user.username}</Typography>
                          </TableCell>
                          <TableCell sx={tableCellSx}>{user.name}</TableCell>
                          <TableCell sx={tableCellSx}>
                            <Chip 
                              label={roleConfig[user.role]?.label || user.role}
                              size="small"
                              sx={{ 
                                bgcolor: roleConfig[user.role]?.color || colors.grey[400],
                                color: '#fff',
                                fontWeight: 'bold',
                                fontSize: '11px',
                              }}
                            />
                          </TableCell>
                          <TableCell sx={tableCellSx}>
                            {linkedCustomer ? linkedCustomer.name : '-'}
                          </TableCell>
                          <TableCell sx={tableCellSx}>{formatDate(user.created_at)}</TableCell>
                          <TableCell sx={tableCellSx}>
                            <Box display="flex" gap={0.5}>
                              <Tooltip title="Edit">
                                <IconButton 
                                  size="small" 
                                  onClick={() => handleEditUser(user)}
                                  sx={{ color: colors.tealAccent[600] }}
                                >
                                  <EditIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Delete">
                                <IconButton 
                                  size="small" 
                                  onClick={() => handleDeleteUser(user.id)}
                                  sx={{ color: colors.redAccent[500] }}
                                >
                                  <DeleteIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </Box>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {users.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                          <Typography color={colors.grey[500]}>No users found</Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          )}
        </Box>
      </Paper>

      {/* Customer Dialog */}
      <Dialog 
        open={customerDialogOpen} 
        onClose={() => setCustomerDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { borderRadius: '12px' } }}
      >
        <DialogTitle sx={{ fontWeight: 'bold', color: colors.tealAccent[500] }}>
          {editingCustomer ? 'Edit Customer' : 'Add Customer'}
        </DialogTitle>
        <DialogContent sx={{ overflowY: 'auto' }}>
          <Box display="flex" flexDirection="column" gap={2.5} sx={{ mt: 2 }}>
            <TextField
              label="Company Name"
              color="secondary"
              value={customerForm.name}
              onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })}
              fullWidth
              required
            />
            <TextField
              label="Address"
              color="secondary"
              value={customerForm.address}
              onChange={(e) => setCustomerForm({ ...customerForm, address: e.target.value })}
              fullWidth
              multiline
              rows={2}
            />
            <TextField
              label="Email"
              type="email"
              color="secondary"
              value={customerForm.contact_email}
              onChange={(e) => setCustomerForm({ ...customerForm, contact_email: e.target.value })}
              fullWidth
            />
            <TextField
              label="Phone"
              color="secondary"
              value={customerForm.contact_phone}
              onChange={(e) => setCustomerForm({ ...customerForm, contact_phone: e.target.value })}
              fullWidth
            />
            <TextField
              label="Notes"
              color="secondary"
              value={customerForm.notes}
              onChange={(e) => setCustomerForm({ ...customerForm, notes: e.target.value })}
              fullWidth
              multiline
              rows={2}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2, gap: 1 }}>
          <Button 
            onClick={() => setCustomerDialogOpen(false)} 
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
            onClick={handleSubmitCustomer} 
            variant="contained"
            color="secondary"
            disabled={!customerForm.name}
          >
            {editingCustomer ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* User Dialog */}
      <Dialog 
        open={userDialogOpen} 
        onClose={() => setUserDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { borderRadius: '12px' } }}
      >
        <DialogTitle sx={{ fontWeight: 'bold', color: colors.tealAccent[500] }}>
          {editingUser ? 'Edit User' : 'Add User'}
        </DialogTitle>
        <DialogContent sx={{ overflowY: 'auto' }}>
          <Box display="flex" flexDirection="column" gap={2.5} sx={{ mt: 2 }}>
            <TextField
              label="Username"
              color="secondary"
              value={userForm.username}
              onChange={(e) => setUserForm({ ...userForm, username: e.target.value })}
              fullWidth
              required
              disabled={!!editingUser}
            />
            <TextField
              label={editingUser ? "New Password (leave blank to keep)" : "Password"}
              type="password"
              color="secondary"
              value={userForm.password}
              onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
              fullWidth
              required={!editingUser}
            />
            <TextField
              label="Display Name"
              color="secondary"
              value={userForm.name}
              onChange={(e) => setUserForm({ ...userForm, name: e.target.value })}
              fullWidth
              required
            />
            <FormControl fullWidth color="secondary">
              <InputLabel color="secondary">Role</InputLabel>
              <Select
                value={userForm.role}
                onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
                label="Role"
                color="secondary"
              >
                <MenuItem value="admin">Admin</MenuItem>
                <MenuItem value="manager">Manager</MenuItem>
                <MenuItem value="operator">Operator</MenuItem>
                <MenuItem value="customer">Customer</MenuItem>
              </Select>
            </FormControl>
            {userForm.role === 'customer' && (
              <FormControl fullWidth required color="secondary">
                <InputLabel color="secondary">Linked Customer</InputLabel>
                <Select
                  value={userForm.customer_id}
                  onChange={(e) => setUserForm({ ...userForm, customer_id: e.target.value })}
                  label="Linked Customer"
                  color="secondary"
                >
                  {customers.map((customer) => (
                    <MenuItem key={customer.id} value={customer.id}>
                      {customer.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 2, gap: 1 }}>
          <Button 
            onClick={() => setUserDialogOpen(false)} 
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
            onClick={handleSubmitUser} 
            variant="contained"
            color="secondary"
            disabled={!userForm.username || !userForm.name || (!editingUser && !userForm.password)}
          >
            {editingUser ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default AdminPage;
