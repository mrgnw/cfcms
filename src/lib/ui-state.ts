import { createContext } from 'svelte';
import type { PostFilter } from '$lib/types';

export type UiState = { sidebarOpen: boolean; newTitle: string; filter: PostFilter };

export const [getUiState, setUiState] = createContext<UiState>();
