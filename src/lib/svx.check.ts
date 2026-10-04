import assert from 'node:assert/strict';
import { renderSvx, slugKey, svxSlug, svxToPostFrontmatter } from './svx.ts';

const frontmatter = `title: 'Write less code (especially with LLM''s)'
date: 2025-02-01
tags: [svelte, ai]
publish: true
pin: true
slug: write-less-code-especially-with-llms
description: "LLMs are great at generating code. That's the problem."
updated: 2025-03-01`;

const svx = renderSvx(frontmatter, '\n\nBody text.\n\n');
assert.equal(
	svx,
	`---
title: "Write less code (especially with LLM's)"
date: "2025-02-01"
tag: "svelte"
pinned: true
published: true
description: "LLMs are great at generating code. That's the problem."
updated: 2025-03-01
---

Body text.
`
);

assert.equal(renderSvx('title: Plain\ndate: 2024-01-01\ntags: []\npublish: false', 'x'), `---
title: "Plain"
date: "2024-01-01"
published: true
---

x
`);

assert.equal(svxSlug("drafts/write less code (especially with llm's).md", frontmatter), 'write-less-code-especially-with-llms');
assert.equal(svxSlug("drafts/write less code (especially with llm's).md", 'title: x'), 'write-less-code-especially-with-llm-s');
assert.equal(svxSlug('drafts/python_patterns.md', ''), 'python-patterns');
assert.equal(svxSlug('x.md', 'slug: ../../etc/passwd'), 'etc-passwd');
assert.equal(renderSvx('title: yes\ndate: \ntags: []\npublish: true', 'b'), '---\ntitle: "yes"\ndate: "1970-01-01"\npublished: true\n---\n\nb\n');
assert.equal(slugKey("write less code (especially with llm's)"), slugKey('write-less-code-especially-with-llms'));
assert.notEqual(slugKey('uv'), slugKey('uv-python-scripts'));

const mapped = svxToPostFrontmatter(
	'title: "Gear"\ndate: "2024-08-01"\ndescription: "Stuff"\npublished: true\ntag: "gear"\npinned: false',
	'gear'
);
assert.equal(mapped, 'title: "Gear"\ndate: "2024-08-01"\ntags: ["gear"]\npublish: true\nslug: gear\ndescription: "Stuff"');
assert.equal(renderSvx(mapped, 'b'), '---\ntitle: "Gear"\ndate: "2024-08-01"\ntag: "gear"\npublished: true\ndescription: "Stuff"\n---\n\nb\n');

console.log('svx.check ok');
