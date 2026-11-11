import { detailsPlugin } from '@voithos-labs/aragonite-details';
import { footnotesPlugin } from '@voithos-labs/aragonite-footnotes';
import { mermaidPlugin, type MermaidRenderer } from '@voithos-labs/aragonite-mermaid';
import { slashCommandsPlugin } from '@voithos-labs/aragonite-slash-commands';

// The blog's desktop post column, so a diagram is laid out here as readers on desktop see it.
const BLOG_COLUMN_WIDTH = 560;

// Pele colours its SVG from --pele-* CSS variables, so the editor theme needs no re-render.
const peleRenderer: MermaidRenderer = async (code, id) => {
	const { renderAsync } = await import('pele/lazy');
	const { svg } = await renderAsync(code, { idPrefix: id, maxWidth: BLOG_COLUMN_WIDTH });
	return svg;
};

// Aragonite installs plugins once per process, first set wins, so every editor shares this array.
export const plugins = [
	slashCommandsPlugin(),
	footnotesPlugin(),
	detailsPlugin(),
	mermaidPlugin({ renderer: peleRenderer })
];
