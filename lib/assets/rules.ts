export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
 return aStart < bEnd && bStart < aEnd;
}
