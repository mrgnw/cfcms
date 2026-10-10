const datePattern = /^(\d{4})-(\d{2})-(\d{2})/;
const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function shortDate(date: string | undefined, currentYear: number): string | null {
	const match = date?.match(datePattern);
	if (!match) return null;

	const [, year, month, day] = match;
	if (year === '1970') return null;
	if (Number(year) !== currentYear) return year;
	return `${monthNames[Number(month) - 1]} ${Number(day)}`;
}
