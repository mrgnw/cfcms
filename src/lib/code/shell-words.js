// @ts-nocheck
// twinkleplop's bash grammar splits a shell word into many tokens (`-LsSf` is
// `-` + `LsSf`, a URL is a dozen pieces) and never marks command names. This
// pass regroups adjacent tokens into words and recolours them the way shiki did:
// command name as a function, flags as constants, other bare arguments as strings.

const BARE = new Set(["identifier", "operator", "punctuation", "number", "builtin"])
const SEPARATORS = new Set(["|", "||", "&&", ";", "&", "];", "|&"])
const PIPES = new Set(["|", "||", "|&"])

function readWords(input, tokens) {
	const words = []
	for (let i = 0; i < tokens.length; i += 3) {
		const start = tokens[i + 1]
		const previous = words.at(-1)
		// comment tokens swallow their trailing newline, so look back one character
		const gap = previous ? input.slice(tokens[previous.last + 2] - 1, start) : ""
		const separator = SEPARATORS.has(input.slice(start, tokens[i + 2]))
		const joinsPrevious = previous && !previous.separator && !separator && gap.length === 1 && gap !== "\n"
		if (joinsPrevious) {
			previous.last = i
		} else {
			words.push({ first: i, last: i, newline: gap.includes("\n"), separator })
		}
	}
	return words
}

function typeId(types, name) {
	const id = types.indexOf(name)
	if (id !== -1) return id
	types.push(name)
	return types.length - 1
}

export function shellWords(input, result) {
	const tokens = result.tokens.slice()
	const types = result.token_types.slice()
	const id = {
		function: typeId(types, "function"),
		constant: typeId(types, "constant"),
		string: typeId(types, "string"),
		operator: typeId(types, "operator"),
	}

	const typeOf = (i) => types[tokens[i]]
	const textOf = (i) => input.slice(tokens[i + 1], tokens[i + 2])
	const retype = (word, type) => {
		for (let i = word.first; i <= word.last; i += 3) tokens[i] = type
	}

	let commandPosition = true
	for (const word of readWords(input, tokens)) {
		if (word.newline) commandPosition = true

		const single = word.first === word.last
		const text = input.slice(tokens[word.first + 1], tokens[word.last + 2])

		if (single && typeOf(word.first) === "punctuation" && SEPARATORS.has(text)) {
			if (PIPES.has(text)) tokens[word.first] = id.operator
			commandPosition = true
			continue
		}

		if (single && typeOf(word.first) === "keyword") {
			commandPosition = true
			continue
		}

		let bare = true
		for (let i = word.first; i <= word.last; i += 3) bare &&= BARE.has(typeOf(i))

		if (commandPosition) {
			const assignment = word.last > word.first && typeOf(word.first) === "identifier" && textOf(word.first + 3) === "="
			if (assignment) continue
			const builtin = single && typeOf(word.first) === "builtin"
			if (bare && !builtin) retype(word, id.function)
			commandPosition = false
			continue
		}

		if (!bare) continue
		if (/[<>]/.test(text)) continue
		retype(word, text.startsWith("-") ? id.constant : id.string)
	}

	return { ...result, tokens, token_types: types }
}
