import API from './api';

export async function listRecipes() {
  const { data } = await API.get('/programs/recipes');
  return data;
}

export async function createRecipe(payload) {
  const { data } = await API.post('/programs/recipes', payload);
  return data;
}

export async function listPrograms() {
  const { data } = await API.get('/programs');
  return data; // [{id,name,gates:[{gate,recipe_id}]}]
}

export async function createProgram(payload) {
  const { data } = await API.post('/programs', payload);
  return data;
}