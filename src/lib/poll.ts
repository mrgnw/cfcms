export const startPoll = (tick: () => void, ms: number) => {
	const run = () => {
		if (!document.hidden) tick();
	};
	const timer = setInterval(run, ms);
	document.addEventListener('visibilitychange', run);
	return () => {
		clearInterval(timer);
		document.removeEventListener('visibilitychange', run);
	};
};
