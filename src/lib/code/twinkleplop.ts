import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from '@codemirror/view';
import type { LanguageFn } from '@twinkleplop/core';

function decorations(tokenize: LanguageFn, text: string): DecorationSet {
	const { tokens, token_types } = tokenize(text);
	const marks = token_types.map((type) => Decoration.mark({ class: type }));
	const ranges = [];
	for (let i = 0; i < tokens.length; i += 3) {
		const [type, start, end] = [tokens[i], tokens[i + 1], tokens[i + 2]];
		if (start < end) ranges.push(marks[type].range(start, end));
	}
	return Decoration.set(ranges, true);
}

function highlighter(tokenize: LanguageFn): Extension {
	const plugin = ViewPlugin.define(
		(view) => ({
			decorations: decorations(tokenize, view.state.doc.toString()),
			update(update) {
				if (update.docChanged) this.decorations = decorations(tokenize, update.state.doc.toString());
			}
		}),
		{ decorations: (plugin) => plugin.decorations }
	);
	return [plugin, EditorView.contentAttributes.of({ class: 'twinkleplop' })];
}

const tint = (percent: number) => `color-mix(in srgb, var(--twp-identifier) ${percent}%, transparent)`;

export const theme = EditorView.theme({
	'.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--twp-identifier)' },
	'.cm-gutters': { backgroundColor: 'transparent', color: 'var(--twp-comment)', border: 'none' },
	'.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'transparent' },
	'&.cm-focused .cm-activeLine, &.cm-focused .cm-activeLineGutter': { backgroundColor: tint(6) },
	'&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': {
		backgroundColor: tint(18)
	}
});

const plainText = StreamLanguage.define({
	token(stream) {
		stream.skipToEnd();
		return null;
	}
});

function language(name: string, alias: string[], load: () => Promise<LanguageFn>) {
	return LanguageDescription.of({
		name,
		alias,
		load: async () => new LanguageSupport(plainText, highlighter(await load()))
	});
}

async function shell(): Promise<LanguageFn> {
	const [{ create_language }, { grammar, reclassifiers }, { shellWords }] = await Promise.all([
		import('@twinkleplop/core'),
		import('@twinkleplop/bash'),
		import('./shell-words.js')
	]);
	return create_language(grammar, [...reclassifiers, shellWords])();
}

export const languages = [
	language('Bash', ['bash', 'sh', 'shell', 'zsh'], shell),
	language('Python', ['python', 'py'], async () => (await import('@twinkleplop/python')).tokenize()),
	language('Markdown', ['markdown', 'md'], async () => (await import('@twinkleplop/markdown')).tokenize()),
	language('YAML', ['yaml', 'yml'], async () => (await import('@twinkleplop/yaml')).tokenize()),
	language('Diff', ['diff'], async () => (await import('@twinkleplop/diff')).tokenize()),
	language('HTML', ['html'], async () => (await import('@twinkleplop/html')).tokenize()),
	language('INI', ['ini'], async () => (await import('@twinkleplop/ini')).tokenize()),
	language('JSON', ['json'], async () => (await import('@twinkleplop/json')).tokenize()),
	language('JSONC', ['jsonc'], async () => (await import('@twinkleplop/jsonc')).tokenize()),
	language('Svelte', ['svelte'], async () => (await import('@twinkleplop/svelte')).tokenize()),
	language('TOML', ['toml'], async () => (await import('@twinkleplop/toml')).tokenize())
];
