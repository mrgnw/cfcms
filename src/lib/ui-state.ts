import { createContext } from 'svelte';

export type UiState = { sidebarOpen: boolean };

export const [getUiState, setUiState] = createContext<UiState>();

export function rememberSidebar(open: boolean) {
	document.cookie = `sidebar=${open ? 'open' : 'closed'}; path=/; max-age=31536000; SameSite=Lax`;
}
