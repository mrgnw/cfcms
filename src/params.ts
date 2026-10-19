import { defineParams } from '@sveltejs/kit/params';
import { isPostId } from './lib/post-id.ts';
import { isStage } from './lib/types.ts';

const matchPostId = (param: string) => isPostId(param);

export const params = defineParams({
	postId: (param) => (matchPostId(param) ? param : undefined),
	stage: (param) => (isStage(param) ? param : undefined)
});
