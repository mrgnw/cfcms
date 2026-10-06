// no 0/o, 1/l/i, 2/z, 5/s, u/v: characters people misread when copying an id by eye
export const postIdAlphabet = '346789abcdefghijkmnpqrtwxyz';
export const postIdLength = 6;

const postIdPattern = new RegExp(`^[${postIdAlphabet}]{${postIdLength}}$`);

export const isPostId = (value: string) => postIdPattern.test(value);

// rejection sampling keeps every character equally likely
const unbiasedLimit = Math.floor(256 / postIdAlphabet.length) * postIdAlphabet.length;

export const randomPostId = () => {
	let id = '';
	while (id.length < postIdLength) {
		for (const byte of crypto.getRandomValues(new Uint8Array(postIdLength))) {
			if (byte < unbiasedLimit && id.length < postIdLength) id += postIdAlphabet[byte % postIdAlphabet.length];
		}
	}
	return id;
};
