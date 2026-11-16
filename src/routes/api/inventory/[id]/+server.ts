import { error } from '@sveltejs/kit';
import { isPostId } from '#lib/post-id.js';
import { getInventoryPost } from '#lib/server/inventory.js';

export const GET = async ({ params }) => {
	if (!isPostId(params.id)) throw error(400, 'id must be a post id');
	return Response.json(getInventoryPost(params.id));
};
