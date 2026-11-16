import { triageFields, type PostListItem, type TriageField } from '#lib/types.js';

export type TriageValues = Record<TriageField, string>;

export const triageOf = (post: Pick<PostListItem, 'nextStep' | 'effort'>): TriageValues => ({
	nextStep: post.nextStep ?? '',
	effort: post.effort ?? ''
});

// Takes values another session saved, but only into fields this session has not edited.
// An edited field keeps its old base, so its save is refused rather than overwriting theirs.
export const adoptIncoming = (saved: TriageValues, shown: TriageValues, incoming: TriageValues) => {
	const next = { saved: { ...saved }, shown: { ...shown } };
	for (const field of triageFields) {
		if (shown[field] !== saved[field]) continue;
		next.saved[field] = incoming[field];
		next.shown[field] = incoming[field];
	}
	return next;
};
