import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from '@codemirror/view';
import { grammar as bashGrammar, reclassifiers as bashReclassifiers } from '@twinkleplop/bash';
import { create_language, type LanguageFn } from '@twinkleplop/core';
import { tokenize as css } from '@twinkleplop/css';
import { tokenize as diff } from '@twinkleplop/diff';
import { tokenize as dockerfile } from '@twinkleplop/dockerfile';
import { tokenize as dotenv } from '@twinkleplop/dotenv';
import { tokenize as go } from '@twinkleplop/go';
import { tokenize as graphql } from '@twinkleplop/graphql';
import { tokenize as html } from '@twinkleplop/html';
import { tokenize as http } from '@twinkleplop/http';
import { tokenize as ini } from '@twinkleplop/ini';
import { tokenize as javascript } from '@twinkleplop/javascript';
import { tokenize as json } from '@twinkleplop/json';
import { tokenize as jsonc } from '@twinkleplop/jsonc';
import { tokenize as markdown } from '@twinkleplop/markdown';
import { tokenize as powershell } from '@twinkleplop/powershell';
import { tokenize as python } from '@twinkleplop/python';
import { tokenize as rust } from '@twinkleplop/rust';
import { tokenize as shellsession } from '@twinkleplop/shellsession';
import { tokenize as sql } from '@twinkleplop/sql';
import { tokenize as svelte } from '@twinkleplop/svelte';
import { tokenize as toml } from '@twinkleplop/toml';
import { tokenize as tsx } from '@twinkleplop/tsx';
import { tokenize as typescript } from '@twinkleplop/typescript';
import { tokenize as yaml } from '@twinkleplop/yaml';
import { shellWords } from '$blog/shell-words.js';

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

function language(name: string, alias: string[], tokenize?: LanguageFn) {
	const support = tokenize ? new LanguageSupport(plainText, highlighter(tokenize)) : new LanguageSupport(plainText);
	return LanguageDescription.of({ name, alias, support });
}

const shell = create_language(bashGrammar, [...bashReclassifiers, shellWords])();

export const languages = [
	language('Bash', ['bash', 'sh', 'shell', 'zsh'], shell),
	language('Caddy', ['caddy']),
	language('CSS', ['css'], css()),
	language('Diff', ['diff'], diff()),
	language('Dockerfile', ['dockerfile', 'docker'], dockerfile()),
	language('dotenv', ['dotenv', 'env'], dotenv()),
	language('Go', ['go', 'golang'], go()),
	language('GraphQL', ['graphql', 'gql'], graphql()),
	language('HTML', ['html'], html()),
	language('HTTP', ['http'], http()),
	language('INI', ['ini'], ini()),
	language('JavaScript', ['js', 'javascript', 'mjs', 'cjs'], javascript()),
	language('JSON', ['json'], json()),
	language('JSONC', ['jsonc'], jsonc()),
	language('Lua', ['lua']),
	language('Markdown', ['markdown', 'md'], markdown()),
	language('Nginx', ['nginx']),
	language('PowerShell', ['powershell', 'ps1', 'pwsh'], powershell()),
	language('Python', ['python', 'py'], python()),
	language('Rust', ['rust', 'rs'], rust()),
	language('Shell session', ['console', 'shellsession', 'sh-session'], shellsession()),
	language('SQL', ['sql'], sql()),
	language('Svelte', ['svelte'], svelte()),
	language('Text', ['text']),
	language('TOML', ['toml'], toml()),
	language('TSX', ['tsx'], tsx()),
	language('TypeScript', ['ts', 'typescript'], typescript()),
	language('YAML', ['yaml', 'yml'], yaml())
];
