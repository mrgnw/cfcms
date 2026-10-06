import { codeBlockSchema } from '@milkdown/kit/preset/commonmark';

const codeBlockWithMeta = codeBlockSchema.extendSchema((prev) => (ctx) => {
	const base = prev(ctx);
	return {
		...base,
		attrs: { ...base.attrs, meta: { default: '', validate: 'string' } },
		parseMarkdown: {
			match: base.parseMarkdown.match,
			runner: (state, node, type) => {
				const value = node.value as string;
				state.openNode(type, { language: node.lang ?? '', meta: node.meta ?? '' });
				if (value) state.addText(value);
				state.closeNode();
			}
		},
		toMarkdown: {
			match: base.toMarkdown.match,
			runner: (state, node) => {
				state.addNode('code', undefined, node.content.firstChild?.text || '', {
					lang: node.attrs.language,
					meta: node.attrs.meta || null
				});
			}
		}
	};
});

export const fenceMeta = codeBlockWithMeta;
