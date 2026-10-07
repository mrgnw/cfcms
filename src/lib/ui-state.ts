import { createContext } from 'svelte';
import type { PostFilter } from '$lib/types';

export type UiState = { sidebarOpen: boolean; filter: PostFilter };

export const [getUiState, setUiState] = createContext<UiState>();
