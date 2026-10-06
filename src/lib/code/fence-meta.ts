import { codeBlockSchema } from '@milkdown/kit/preset/commonmark';
import { $prose } from '@milkdown/kit/utils';
import { Plugin } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';

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

const metaLabel = $prose(
	() =>
		new Plugin({
			props: {
				decorations: (state) => {
					const decorations: Decoration[] = [];
					state.doc.descendants((node, pos) => {
						if (node.type.name === 'code_block' && node.attrs.meta)
							decorations.push(Decoration.node(pos, pos + node.nodeSize, { 'data-meta': node.attrs.meta }));
					});
					return DecorationSet.create(state.doc, decorations);
				}
			}
		})
);

export const fenceMeta = [codeBlockWithMeta, metaLabel].flat();
