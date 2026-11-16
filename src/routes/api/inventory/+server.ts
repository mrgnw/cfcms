import { error } from '@sveltejs/kit';
import { isPostId } from '#lib/post-id.js';
import { inventoryPageLimit, listInventory } from '#lib/server/inventory.js';

export const GET = async ({ url }) => {
	const rawLimit = url.searchParams.get('limit') ?? '50';
	const after = url.searchParams.get('after');
	if (!/^[1-9]\d{0,2}$/.test(rawLimit) || Number(rawLimit) > inventoryPageLimit) {
		throw error(400, 'limit must be an integer from 1 to 100');
	}
	if (after !== null && !isPostId(after)) throw error(400, 'after must be a post id');
	return Response.json(listInventory(Number(rawLimit), after));
};
