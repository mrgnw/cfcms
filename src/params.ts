import { defineParams } from '@sveltejs/kit/params';
import { isPostId } from './lib/post-id.ts';

const matchPostId = (param: string) => isPostId(param);

export const params = defineParams({
	postId: (param) => (matchPostId(param) ? param : undefined)
});
