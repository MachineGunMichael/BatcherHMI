import API from './api';

export async function getCurrentSettings() {
  const { data } = await API.get('/settings');
  return data; // {version, json:{program_id,gates,...}}
}

export async function updateSettings(expectedVersion, newSettings) {
  const { data } = await API.post('/settings', { expectedVersion, newSettings });
  return data; // {ok:true, version, change_id}
}