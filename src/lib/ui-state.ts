import { createContext } from 'svelte';

export type UiState = { sidebarOpen: boolean };

export const [getUiState, setUiState] = createContext<UiState>();
