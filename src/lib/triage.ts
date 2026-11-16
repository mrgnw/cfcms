import { triageFields, type PostListItem, type TriageField } from '#lib/types.js';

export type TriageValues = Record<TriageField, string>;

export const triageOf = (post: Pick<PostListItem, 'nextStep' | 'effort'>): TriageValues => ({
	nextStep: post.nextStep ?? '',
	effort: post.effort ?? ''
});

export type TriageReply =
	| { kind: 'saved'; value: string; rev: number }
	| { kind: 'conflict'; current: string; rev: number }
	| { kind: 'failed' };

export type TriageProblem = { kind: 'conflict'; theirs: string } | { kind: 'failed' };

export type TriageView = {
	shown: TriageValues;
	saved: TriageValues;
	problems: Partial<Record<TriageField, TriageProblem>>;
	saving: boolean;
};

type Send = (field: TriageField, value: string, base: string) => Promise<TriageReply>;

// Client side of the per-field compare-and-set. Saves run one at a time in order, a conflict
// holds that field until the writer picks Keep mine or Use theirs, a failed or malformed reply
// never stops later saves, and a poll older than the newest rev heard is ignored.
export class TriageSync {
	#shown: TriageValues;
	#saved: TriageValues;
	#problems: Partial<Record<TriageField, TriageProblem>> = {};
	#pending = 0;
	#queue: Promise<void> = Promise.resolve();
	#rev: number;
	#send: Send;
	#onChange: (view: TriageView) => void;
	#onSaved: () => void;

	constructor(
		initial: TriageValues,
		rev: number,
		send: Send,
		onChange: (view: TriageView) => void,
		onSaved: () => void = () => {}
	) {
		this.#shown = { ...initial };
		this.#saved = { ...initial };
		this.#rev = rev;
		this.#send = send;
		this.#onChange = onChange;
		this.#onSaved = onSaved;
	}

	view(): TriageView {
		return {
			shown: { ...this.#shown },
			saved: { ...this.#saved },
			problems: { ...this.#problems },
			saving: this.#pending > 0
		};
	}

	edit(field: TriageField, value: string) {
		this.#shown[field] = value;
		this.#notify();
	}

	save(field: TriageField) {
		if (this.#problems[field]?.kind === 'conflict') return;
		return this.#enqueue(field);
	}

	keepMine(field: TriageField) {
		delete this.#problems[field];
		return this.#enqueue(field);
	}

	useTheirs(field: TriageField) {
		this.#shown[field] = this.#saved[field];
		delete this.#problems[field];
		this.#notify();
	}

	// A poll replaces only fields with no unsaved edit and no open problem, and only when it is
	// at least as new as everything this session has heard, so an older poll cannot undo a save.
	receive(values: TriageValues, rev: number) {
		if (rev < this.#rev) return;
		this.#rev = rev;
		for (const field of triageFields) {
			if (this.#problems[field] || this.#shown[field] !== this.#saved[field]) continue;
			this.#saved[field] = values[field];
			this.#shown[field] = values[field];
		}
		this.#notify();
	}

	#enqueue(field: TriageField) {
		this.#pending += 1;
		this.#notify();
		this.#queue = this.#queue.then(() => this.#run(field));
		return this.#queue;
	}

	async #run(field: TriageField) {
		try {
			await this.#sendField(field);
		} catch {
			this.#problems[field] = { kind: 'failed' };
		}
		this.#pending -= 1;
		this.#notify();
	}

	async #sendField(field: TriageField) {
		if (this.#problems[field]?.kind === 'conflict') return;
		const value = this.#shown[field];
		const base = this.#saved[field];
		if (value === base) {
			delete this.#problems[field];
			return;
		}

		const reply = await this.#send(field, value, base);
		if (reply.kind === 'saved') {
			this.#saved[field] = reply.value;
			if (this.#shown[field] === value) this.#shown[field] = reply.value;
			this.#rev = Math.max(this.#rev, reply.rev);
			delete this.#problems[field];
			queueMicrotask(this.#onSaved);
		} else if (reply.kind === 'conflict') {
			this.#saved[field] = reply.current;
			this.#rev = Math.max(this.#rev, reply.rev);
			this.#problems[field] = { kind: 'conflict', theirs: reply.current };
		} else {
			this.#problems[field] = { kind: 'failed' };
		}
	}

	#notify() {
		this.#onChange(this.view());
	}
}
