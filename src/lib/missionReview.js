// Only explain triangle classification when the numbers actually support the saved answer.
export function triangleSideSteps(item, correctAnswer) {
  const match = String(item || '').trim().match(/^(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)$/);
  const category = String(correctAnswer || '').trim().toLowerCase().match(/^(right|acute|obtuse)(?:\s+triangle)?$/)?.[1];
  if (!match || !category) return null;
  const [a, b, c] = match.slice(1).map(Number).sort((x, y) => x - y);
  if (a <= 0 || a + b <= c) return null;
  const left = a * a + b * b;
  const right = c * c;
  const actual = Math.abs(left - right) < 1e-9 ? 'right' : left > right ? 'acute' : 'obtuse';
  if (actual !== category) return null;
  const comparison = actual === 'right' ? 'equal to' : actual === 'acute' ? 'greater than' : 'less than';
  const symbol = actual === 'right' ? '=' : actual === 'acute' ? '>' : '<';
  return [
    `The longest side is ${c}. Square the two shorter sides: ${a}² + ${b}² = ${a * a} + ${b * b} = ${left}.`,
    `Square the longest side: ${c}² = ${right}.`,
    `Compare them: ${left} ${symbol} ${right}. The first total is ${comparison} the longest side’s square, so this is a ${actual} triangle.`,
  ];
}
