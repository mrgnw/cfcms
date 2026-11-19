export function focusOnBlankTap(
	onTap: (x: number, y: number) => void,
	isBlank: (target: EventTarget | null, area: HTMLElement) => boolean = (target, area) => target === area
) {
	return (area: HTMLElement) => {
		let armed = false;
		const down = (e: PointerEvent) => {
			armed = e.isPrimary && e.button === 0 && isBlank(e.target, area);
		};
		const up = (e: PointerEvent) => {
			if (!isBlank(e.target, area)) armed = false;
		};
		const cancel = () => {
			armed = false;
		};
		const click = (e: MouseEvent) => {
			const tapped = armed && e.button === 0 && isBlank(e.target, area);
			armed = false;
			if (tapped) onTap(e.clientX, e.clientY);
		};
		area.addEventListener('pointerdown', down);
		area.addEventListener('pointerup', up);
		area.addEventListener('pointercancel', cancel);
		area.addEventListener('click', click);
		return () => {
			area.removeEventListener('pointerdown', down);
			area.removeEventListener('pointerup', up);
			area.removeEventListener('pointercancel', cancel);
			area.removeEventListener('click', click);
		};
	};
}
