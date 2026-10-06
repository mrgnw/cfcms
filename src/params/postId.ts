import type { ParamMatcher } from '@sveltejs/kit';
import { isPostId } from '$lib/post-id';

export const match = ((param: string) => isPostId(param)) satisfies ParamMatcher;
