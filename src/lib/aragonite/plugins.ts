import { detailsPlugin } from '@voithos-labs/aragonite/plugins/details';
import { footnotesPlugin } from '@voithos-labs/aragonite/plugins/footnotes';
import { mermaidPlugin, type MermaidRenderer } from '@voithos-labs/aragonite/plugins/mermaid';
import { slashCommandsPlugin } from '@voithos-labs/aragonite/plugins/slash-commands';

// Pele colours its SVG from --pele-* CSS variables, so the editor theme needs no re-render.
const peleRenderer: MermaidRenderer = async (code, id) => {
	const { renderAsync } = await import('pele/lazy');
	const { svg } = await renderAsync(code, { idPrefix: id });
	return svg;
};

// Aragonite installs plugins once per process, first set wins, so every editor shares this array.
export const plugins = [
	slashCommandsPlugin(),
	footnotesPlugin(),
	detailsPlugin(),
	mermaidPlugin({ renderer: peleRenderer })
];
