import { useEffect, useMemo, useRef, useState } from "react";

import ClayCard from "@/components/ClayCard";
import ClayButton from "@/components/ClayButton";
import ClayChip from "@/components/ClayChip";
import DragDropMatch from "@/components/student/DragDropMatch";
import FillInTheBlank from "@/components/student/FillInTheBlank";
import MissionImage from "@/components/student/MissionImage";
import { Loader2, RotateCcw } from "lucide-react";
import { getMissionSubmissionReview, startMissionRetry, submitMission } from '@/lib/secureActions';
import { formatMissionDeadline, isMissionLocked } from '@/lib/missionProgress';
import { playCorrectAnswer, playIncorrectAnswer, primeAudio } from '@/lib/gacha';
import { triangleSideSteps } from '@/lib/missionReview';

function displayAnswer(question, value, type) {
  if (value === undefined || value === null) return "No answer";
  if (type === 'true_false') return value ? 'True' : 'False';
  return question?.options?.[Number(value)] ?? String(value);
}

function questionBlanks(question, questionIndex) {
  return Array.from(String(question?.prompt || '').matchAll(/\{\{([^}]+)\}\}/g)).map((match) => `${questionIndex}:${match[1].trim()}`);
}

// Daily Math Power-Ups created from the original foundation bank have a short
// rule but not always a saved worked solution.  When the prompt is a simple
// integer operation, turn the actual numbers into a small, readable solution
// instead of leaving learners with a generic "ask your teacher" message.
function integerOperationGuide(prompt, studentAnswer) {
  const match = String(prompt || "").match(/^\s*What is\s*\(?(-?\d+(?:\.\d+)?)\)?\s*([+−\-×x÷/])\s*\(?(-?\d+(?:\.\d+)?)\)?\s*\?\s*$/i);
  if (!match) return null;
  const [, leftText, operator, rightText] = match;
  const left = Number(leftText);
  const right = Number(rightText);
  if (!Number.isFinite(left) || !Number.isFinite(right) || (/[÷/]/.test(operator) && right === 0)) return null;

  const shownOperator = operator === "-" ? "−" : operator === "x" ? "×" : operator === "/" ? "÷" : operator;
  const expression = `${left} ${shownOperator} ${right}`;
  let answer;
  let steps;
  let remember;

  if (operator === "×" || operator.toLowerCase() === "x") {
    const magnitude = Math.abs(left) * Math.abs(right);
    answer = left * right;
    const differentSigns = (left < 0) !== (right < 0);
    steps = [
      `Multiply the number parts first: ${Math.abs(left)} × ${Math.abs(right)} = ${magnitude}.`,
      `The signs are ${differentSigns ? "different" : "the same"}, so the answer is ${differentSigns ? "negative" : "positive"}: ${answer}.`,
    ];
    remember = "For multiplication, multiply the number parts first. Same signs make a positive; different signs make a negative.";
  } else if (operator === "÷" || operator === "/") {
    const magnitude = Math.abs(left) / Math.abs(right);
    answer = left / right;
    const differentSigns = (left < 0) !== (right < 0);
    steps = [
      `Divide the number parts first: ${Math.abs(left)} ÷ ${Math.abs(right)} = ${magnitude}.`,
      `The signs are ${differentSigns ? "different" : "the same"}, so the answer is ${differentSigns ? "negative" : "positive"}: ${answer}.`,
    ];
    remember = "For division, divide the number parts first. Same signs make a positive; different signs make a negative.";
  } else if (operator === "+") {
    answer = left + right;
    steps = [`Add the signed numbers: ${expression} = ${answer}.`, `The answer is ${answer} because the signs and values were kept as written.`];
    remember = "When adding integers, keep each number's sign and combine the values carefully.";
  } else {
    answer = left - right;
    steps = [`Change subtraction to adding the opposite: ${left} − (${right}) = ${left} + (${-right}).`, `Now add: ${left} + (${-right}) = ${answer}.`];
    remember = "Subtracting a number means adding its opposite.";
  }

  const selected = String(studentAnswer ?? "").trim();
  return {
    solution_steps: steps,
    why_wrong: selected && selected !== String(answer)
      ? `${selected} is not correct because ${expression} = ${answer}. Follow the two steps above before choosing your answer.`
      : "Use the two steps above to check the operation and its sign.",
    remember,
  };
}

function unitConversionGuide(prompt, studentAnswer) {
  const match = String(prompt || "").match(/^\s*How many\s+([a-z]+)\s+are in\s+(\d+)\s+([a-z]+)\s*\?\s*$/i);
  if (!match) return null;
  const [, targetUnitRaw, amountText, sourceUnitRaw] = match;
  const targetUnit = targetUnitRaw.toLowerCase();
  const sourceUnit = sourceUnitRaw.toLowerCase();
  const amount = Number(amountText);
  const factors = {
    "kilometers:meters": 1000,
    "kilograms:grams": 1000,
    "meters:centimeters": 100,
    "hours:minutes": 60,
  };
  const factor = factors[`${sourceUnit}:${targetUnit}`];
  if (!factor || !Number.isFinite(amount)) return null;

  const answer = amount * factor;
  const selected = String(studentAnswer ?? "").trim();
  const singularSource = amount === 1 ? sourceUnit.slice(0, -1) : sourceUnit;
  const singularTarget = targetUnit.slice(0, -1);
  return {
    solution_steps: [
      `Use the conversion: 1 ${singularSource} = ${factor} ${targetUnit}.`,
      `Multiply ${amount} by ${factor}: ${amount} × ${factor} = ${answer} ${targetUnit}.`,
    ],
    why_wrong: selected && selected !== String(answer)
      ? `${selected} is not correct because each ${singularSource} contains ${factor} ${targetUnit}. Multiply ${amount} by ${factor} to get ${answer}.`
      : `Each ${singularSource} contains ${factor} ${targetUnit}, so the total is ${amount} × ${factor} = ${answer}.`,
    remember: `When changing ${sourceUnit} to smaller ${targetUnit}, multiply by the number of ${singularTarget}s in one ${singularSource}.`,
  };
}

function detailedMathGuide(prompt, skill, correctAnswer, studentAnswer) {
  const question = String(prompt || "").trim();
  const selected = String(studentAnswer ?? "").trim();
  const incorrect = (reason) => selected && selected !== String(correctAnswer) ? `${selected} is not correct. ${reason}` : reason;
  const arithmetic = integerOperationGuide(question, studentAnswer);
  if (arithmetic) return arithmetic;
  const conversion = unitConversionGuide(question, studentAnswer);
  if (conversion) return conversion;

  let match = question.match(/^What is\s+(\d+)\/(\d+)\s*([+−-])\s*(\d+)\/(\d+)\?$/i);
  if (match && match[2] === match[5]) {
    const [, left, denominator, operator, right] = match;
    const numerator = operator === "+" ? Number(left) + Number(right) : Number(left) - Number(right);
    return {
      solution_steps: [`The denominators match, so keep ${denominator} as the denominator.`, `${left} ${operator} ${right} = ${numerator}, so the answer is ${numerator}/${denominator}.`],
      why_wrong: incorrect(`Only the numerators change when the denominators are the same: ${left} ${operator} ${right} = ${numerator}.`),
      remember: "With like denominators, add or subtract the numerators and keep the denominator.",
    };
  }

  match = question.match(/^A [^\d]*₱(\d+(?:\.\d+)?) [^.]*? discounted by (\d+(?:\.\d+)?)%\. How much is the discount\?$/i);
  if (match) {
    const [, whole, percent] = match;
    const result = Number(whole) * (Number(percent) / 100);
    return {
      solution_steps: [`Change ${percent}% to a decimal: ${percent} ÷ 100 = ${Number(percent) / 100}.`, `Multiply the price by the decimal: ${whole} × ${Number(percent) / 100} = ${result}.`],
      why_wrong: incorrect(`The discount is ${percent}% of ₱${whole}, so calculate ${whole} × ${Number(percent) / 100} = ${result}.`),
      remember: "To find a percentage of an amount, change the percent to a decimal and multiply.",
    };
  }

  match = question.match(/^What is the perimeter of a square with side length (\d+(?:\.\d+)?)\s*([^?]*)\?$/i);
  if (match) {
    const [, side, unit] = match;
    const result = Number(side) * 4;
    return {
      solution_steps: ["A square has 4 equal sides.", `Multiply the side length by 4: ${side} × 4 = ${result}${unit || ""}.`],
      why_wrong: incorrect(`Perimeter means all four sides added together: ${side} + ${side} + ${side} + ${side} = ${result}.`),
      remember: "For a square, perimeter = 4 × side length.",
    };
  }

  match = question.match(/^What is the ([xy])-coordinate of \((-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\)\?$/i);
  if (match) {
    const [, axis, x, y] = match;
    const answer = axis.toLowerCase() === "x" ? x : y;
    return {
      solution_steps: ["An ordered pair is written as (x, y).", `The ${axis}-coordinate is the ${axis.toLowerCase() === "x" ? "first" : "second"} number: ${answer}.`],
      why_wrong: incorrect(`In (${x}, ${y}), the ${axis}-coordinate is ${answer}.`),
      remember: "Read coordinates in order: x first, then y.",
    };
  }

  match = question.match(/^What is the next number:\s*([\d,\s-]+),\s*__\?$/i);
  if (match) {
    const values = match[1].split(",").map((value) => Number(value.trim())).filter(Number.isFinite);
    const differences = values.slice(1).map((value, index) => value - values[index]);
    if (values.length >= 2 && differences.every((difference) => difference === differences[0])) {
      const next = values.at(-1) + differences[0];
      const direction = differences[0] >= 0 ? "add" : "subtract";
      return {
        solution_steps: [`The pattern changes by ${differences[0]} each time.`, `${direction === "add" ? values.at(-1) + " + " + differences[0] : values.at(-1) + " − " + Math.abs(differences[0])} = ${next}.`],
        why_wrong: incorrect(`Continue the same change of ${differences[0]} from ${values.at(-1)} to get ${next}.`),
        remember: "Compare nearby terms to find the rule, then use the same rule one more time.",
      };
    }
  }

  match = question.match(/^Solve:\s*(-?\d+)x\s*([+−-])\s*(\d+)\s*=\s*(-?\d+)\.?$/i);
  if (match) {
    const [, coefficientText, sign, constantText, totalText] = match;
    const coefficient = Number(coefficientText);
    const constant = Number(constantText) * (sign === "+" ? 1 : -1);
    const total = Number(totalText);
    const isolated = total - constant;
    const answer = isolated / coefficient;
    return {
      solution_steps: [`Undo ${constant >= 0 ? "the + " + constant : "the − " + Math.abs(constant)} on both sides: ${coefficient}x = ${isolated}.`, `Divide both sides by ${coefficient}: x = ${isolated} ÷ ${coefficient} = ${answer}.`],
      why_wrong: incorrect(`First isolate ${coefficient}x, then divide by ${coefficient}; this gives x = ${answer}.`),
      remember: "Undo addition or subtraction first, then divide by the coefficient.",
    };
  }

  match = question.match(/^If x = (-?\d+(?:\.\d+)?), (?:evaluate|what is)\s+(-?\d*)x(?:\s*([+−-])\s*(\d+(?:\.\d+)?))?\?$/i);
  if (match) {
    const [, valueText, coefficientText, sign, constantText] = match;
    const value = Number(valueText);
    const coefficient = Number(coefficientText || 1);
    const constant = constantText ? Number(constantText) * (sign === "+" ? 1 : -1) : 0;
    const product = coefficient * value;
    const answer = product + constant;
    return {
      solution_steps: [`Replace x with ${value}: ${coefficient} × ${value}${constant ? ` ${constant >= 0 ? "+" : "−"} ${Math.abs(constant)}` : ""}.`, `Calculate: ${product}${constant ? ` ${constant >= 0 ? "+" : "−"} ${Math.abs(constant)} = ${answer}` : ""}.`],
      why_wrong: incorrect(`Substitute ${value} for x before calculating; the result is ${answer}.`),
      remember: "Substitution means replacing the variable with its given value before doing the arithmetic.",
    };
  }

  match = question.match(/^A [^.]* has (\d+(?:\.\d+)?) [^.]* and uses (\d+(?:\.\d+)?)[^.]*\. How many remain\?$/i);
  if (match) {
    const [, start, used] = match;
    const answer = Number(start) - Number(used);
    return {
      solution_steps: [`Start with ${start}.`, `Take away ${used}: ${start} − ${used} = ${answer}.`],
      why_wrong: incorrect(`“Uses” means take away, so subtract ${used} from ${start}.`),
      remember: "When an amount is used or removed, subtract it from the starting amount.",
    };
  }

  if (/even or odd/i.test(question)) {
    const number = question.match(/\b(\d+)\b/)?.[1];
    if (number) {
      const lastDigit = Number(number.at(-1));
      const answer = lastDigit % 2 === 0 ? "even" : "odd";
      return {
        solution_steps: [`Look at the last digit of ${number}: it is ${lastDigit}.`, `${lastDigit} is ${answer}, so ${number} is ${answer}.`],
        why_wrong: incorrect(`A number is even only when its last digit is 0, 2, 4, 6, or 8. ${number} ends in ${lastDigit}.`),
        remember: "To check even or odd, look only at the last digit.",
      };
    }
  }

  if (/Comparing & Ordering Numbers/i.test(skill || "")) {
    match = question.match(/(\d+(?:\.\d+)?)\s*__\s*(\d+(?:\.\d+)?)/);
    if (match) {
      const [, left, right] = match;
      return {
        solution_steps: [`Compare ${left} and ${right} from the leftmost digit.`, `${left} is ${Number(left) < Number(right) ? "less than" : Number(left) > Number(right) ? "greater than" : "equal to"} ${right}, so use ${correctAnswer}.`],
        why_wrong: incorrect(`Compare the values, not just the last digit: ${left} ${correctAnswer} ${right}.`),
        remember: "Compare numbers from the greatest place value first.",
      };
    }
  }

  return null;
}

// ai_content is a text column, but RPC payloads can hand back an already-parsed
// object. Accept either instead of blanking the mission when the shape drifts.
function parseAiContent(raw) {
  if (raw && typeof raw === "object") return raw;
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
}

function readDraft(key) {
  try {
    const raw = window.localStorage.getItem(key);
    const draft = raw ? JSON.parse(raw) : null;
    return draft && typeof draft.answers === "object" ? draft : null;
  } catch {
    return null;
  }
}

function SolutionGuide({ item, correctAnswer, correct, studentAnswer }) {
  const explanation = typeof item.explanation === "string" ? item.explanation.trim() : "";
  const redundantAnswer = /^The correct answer is [A-D]\. .+\. Why\? .+$/i.test(explanation);
  const suppliedSteps = Array.isArray(item.solution_steps)
    ? item.solution_steps.map((step) => String(step || "").trim()).filter(Boolean)
    : [];
  const explanationSteps = explanation
    ? explanation.split(/\r?\n+/).map((step) => step.replace(/^\s*\d+\.\s*/, "").trim()).filter(Boolean)
    : [];
  const workedTriangle = triangleSideSteps(item.item, correctAnswer);
  const workedGuide = detailedMathGuide(item.prompt || item.question, item.skill, correctAnswer, studentAnswer);
  const genericExplanation = item.item && (explanation === `${item.item} belongs in ${correctAnswer}.` || explanation === "Read the complete sentence and choose the word that makes its meaning correct.");
  const steps = workedTriangle || workedGuide?.solution_steps || (suppliedSteps.length ? suppliedSteps : explanation && !redundantAnswer && !genericExplanation ? explanationSteps : []);
  const remember = item.remember || workedGuide?.remember || (typeof item.feedback === "string" ? item.feedback.replace(/^Try again\. Read the question slowly and check the steps\. Remember:\s*/i, "") : "");
  const whyWrong = String(item.why_wrong || item.misconception || workedGuide?.why_wrong || "").trim();
  return <div className="mt-3 rounded-xl border border-ink/10 bg-white/70 p-3 text-xs text-ink/85">
    <p className="font-display font-extrabold text-ink">How to solve it</p>
    {correct && <p className="mt-1 leading-relaxed text-ink/70">You got it right. Review these steps so you can use the same method on the next question.</p>}
    {steps.length ? <ol className="mt-2 list-decimal space-y-1 pl-4 leading-relaxed">
      {steps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}
      <li><b>Check:</b> the correct answer is <b>{correctAnswer}</b>.</li>
    </ol> : <p className="mt-2 leading-relaxed">A worked explanation was not saved for this question. Ask your teacher to explain how to reach this answer.</p>}
    {!correct && <p className="mt-3 rounded-lg bg-clay-coral/10 px-2 py-1.5 leading-relaxed"><span className="font-display font-bold text-ink">Why your answer needs a change:</span> {whyWrong || `Compare your answer with “${correctAnswer}” and use the worked steps above to check the rule or clue.`}</p>}
    {remember && <p className="mt-3 border-t border-ink/10 pt-2 leading-relaxed"><span className="font-display font-bold text-ink">Remember:</span> {remember}</p>}
  </div>;
}

export default function MissionAssessment({ mission, group, existing, onDone }) {
  const content = parseAiContent(mission.ai_content);
  const originalQuestions = useMemo(() => Array.isArray(content.questions) ? content.questions : [], [mission.ai_content]);
  const draftKey = `uniclass:mission-draft:${mission.id}:${group.id}`;
  const initialDraft = useMemo(() => readDraft(draftKey), [draftKey]);
  const [questions, setQuestions] = useState(originalQuestions);
  const [answers, setAnswers] = useState(() => initialDraft?.answers || {});
  const [submitting, setSubmitting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryAttemptId, setRetryAttemptId] = useState(null);
  const [submitError, setSubmitError] = useState("");
  const [review, setReview] = useState(null);
  const [result, setResult] = useState(() => existing ? { ...existing } : null);
  const [questionIndex, setQuestionIndex] = useState(() => initialDraft?.questionIndex || 0);
  const [showReview, setShowReview] = useState(() => Boolean(initialDraft?.showReview));
  const [draftRestored, setDraftRestored] = useState(() => Boolean(initialDraft));
  const shouldPlayFeedback = useRef(false);

  useEffect(() => { setQuestions(originalQuestions); }, [originalQuestions]);
  useEffect(() => {
    const draft = existing?.id ? null : readDraft(draftKey);
    setAnswers(draft?.answers || {});
    setQuestionIndex(Math.min(Number(draft?.questionIndex) || 0, Math.max(originalQuestions.length - 1, 0)));
    setShowReview(Boolean(draft?.showReview));
    setDraftRestored(Boolean(draft));
  }, [draftKey, existing?.id, originalQuestions.length]);
  useEffect(() => {
    if (existing?.id || result || retryAttemptId || mission.formative_type === "drag_drop") return;
    try {
      window.localStorage.setItem(draftKey, JSON.stringify({ answers, questionIndex, showReview }));
    } catch {
      // Saving a local convenience draft must never interrupt the assessment.
    }
  }, [answers, draftKey, existing?.id, mission.formative_type, questionIndex, result, retryAttemptId, showReview]);
  useEffect(() => {
    if (!result) return;
    let live = true;
    getMissionSubmissionReview(mission.id, group.id, retryAttemptId).then((data) => {
      if (!live) return;
      setReview(data);
      if (shouldPlayFeedback.current) {
        shouldPlayFeedback.current = false;
        if ((data?.items || []).every((item) => item.correct)) playCorrectAnswer();
        else playIncorrectAnswer();
      }
    }).catch(() => { if (live) setReview(null); });
    return () => { live = false; };
  }, [result, mission.id, mission.formative_type, group.id, retryAttemptId]);

  if (!mission.ai_content) return <ClayCard className="p-4"><p className="text-ink/50 text-sm">Mission content unavailable.</p></ClayCard>;
  if (!existing && isMissionLocked(mission)) return <ClayCard className="p-4"><p className="font-display font-bold text-clay-coral">Mission locked</p><p className="mt-1 text-xs text-ink/60">The deadline was {formatMissionDeadline(mission)}. New answers are no longer accepted.</p></ClayCard>;
  if (mission.formative_type !== "drag_drop" && questions.length === 0) return <ClayCard className="p-4"><p className="text-ink/50 text-sm">This mission has no questions available yet. Ask your teacher to regenerate it.</p></ClayCard>;
  const formativeBrief = (content.learning_target || content.student_instructions || content.estimated_minutes) ? (
    <div className="rounded-xl border-2 border-ink/15 bg-clay-sky/15 p-3 text-sm space-y-1">
      {content.learning_target && <p><span className="font-display font-bold">Your learning target:</span> {content.learning_target}</p>}
      {content.student_instructions && <p><span className="font-display font-bold">Directions:</span> {content.student_instructions}</p>}
      {content.estimated_minutes && <p className="text-xs text-ink/60">Plan for about {content.estimated_minutes} minute{content.estimated_minutes === 1 ? "" : "s"}.</p>}
    </div>
  ) : null;

  async function submit(submittedAnswers) {
    setSubmitting(true); setSubmitError("");
    primeAudio();
    try {
      const submission = await submitMission({ p_mission_id: mission.id, p_group_id: group.id, p_score: 0, p_answers: JSON.stringify(submittedAnswers), p_retry_attempt_id: retryAttemptId });
      try { window.localStorage.removeItem(draftKey); } catch {}
      shouldPlayFeedback.current = true;
      setResult({ ...submission }); onDone();
    } catch (err) { setSubmitError(err?.message || "Your answers could not be submitted. Please try again."); }
    finally { setSubmitting(false); }
  }

  async function beginRetry() {
    setRetrying(true); setSubmitError("");
    try {
      const retry = await startMissionRetry(mission.id, group.id);
      try { window.localStorage.removeItem(draftKey); } catch {}
      setQuestions(retry.questions || []); setRetryAttemptId(retry.attemptId); setAnswers({}); setReview(null); setResult(null); setQuestionIndex(0); setShowReview(false);
    } catch (err) { setSubmitError(err?.message || "A fresh retry could not be started."); }
    finally { setRetrying(false); }
  }

  if (result) {
    const displayMax = mission.formative_type === 'drag_drop' ? (content.left || []).length : mission.formative_type === 'fill_in_blank' ? questions.reduce((total, question, index) => total + questionBlanks(question, index).length, 0) : questions.length;
    const reviewedScore = review?.score ?? result.score;
    const reviewedMax = review?.maxScore ?? displayMax;
    return <ClayCard className="p-4 space-y-4">
      <div className="text-center"><div className="text-4xl mb-2">{reviewedScore >= reviewedMax * 0.8 ? "🎉" : reviewedScore >= reviewedMax * 0.5 ? "🙂" : "😢"}</div><p className="font-display font-bold text-lg">{retryAttemptId ? `Retry result: ${reviewedScore}/${reviewedMax}` : `${reviewedScore}/${reviewedMax}`}</p><ClayChip color="sun">{result.xp_earned ?? Math.round((reviewedScore / reviewedMax) * mission.xp_reward)} XP earned</ClayChip>{!retryAttemptId && <p className="mt-2 text-xs font-semibold text-ink/65">This XP was added to your personal XP wallet.</p>}{retryAttemptId && <p className="mt-2 text-xs text-ink/60">This retry is for feedback and practice only. Your XP stays based on the first attempt.</p>}</div>
      {mission.formative_type !== 'drag_drop' && mission.formative_type !== 'fill_in_blank' && <div className="space-y-2"><p className="font-display font-bold text-sm">Answer review</p>{review?.items?.map((item) => {
        const question = questions[item.index];
        const correctAnswer = displayAnswer(question, item.correct_answer, mission.formative_type);
        const guideItem = { ...question, ...item, solution_steps: question?.solution_steps || item.solution_steps, remember: question?.remember || item.remember, why_wrong: question?.why_wrong || item.why_wrong, misconception: question?.misconception || item.misconception };
        const studentAnswer = displayAnswer(question, item.selected, mission.formative_type);
        return <div key={item.index} className={`rounded-xl border-2 p-3 text-sm ${item.correct ? 'border-clay-lime bg-clay-lime/15' : 'border-clay-coral bg-clay-coral/10'}`}><p className="font-display font-bold">Question {item.index + 1} · {item.correct ? 'Correct — learn from the method' : 'Not quite — learn the method'}</p><p className="mt-1 text-xs text-ink/70">Your answer: <b>{studentAnswer}</b></p><p className="mt-1">Correct answer: <b>{correctAnswer}</b></p><SolutionGuide item={guideItem} correctAnswer={correctAnswer} correct={item.correct} studentAnswer={studentAnswer} /></div>;
      })}</div>}
      {mission.formative_type === 'fill_in_blank' && <div className="space-y-2"><p className="font-display font-bold text-sm">Blank-by-blank review</p>{review?.items?.map((item) => { const question = questions[Number(String(item.item || '').match(/Blank\s+(\d+):/)?.[1])] || {}; const guideItem = { ...question, ...item, solution_steps: question.solution_steps || item.solution_steps, remember: question.remember || item.remember, why_wrong: question.why_wrong || item.why_wrong, misconception: question.misconception || item.misconception }; return <div key={item.item} className={`rounded-xl border-2 p-3 text-sm ${item.correct ? 'border-clay-lime bg-clay-lime/15' : 'border-clay-coral bg-clay-coral/10'}`}><p className="font-display font-bold">{item.item} · {item.correct ? 'Correct' : 'Not quite'}</p><p className="mt-1 text-xs text-ink/70">Your answer: <b>{item.selected || 'No answer'}</b></p><p className="mt-1">Correct answer: <b>{item.correct_answer}</b></p><SolutionGuide item={guideItem} correctAnswer={item.correct_answer} correct={item.correct} /></div>; })}</div>}
      {mission.formative_type === 'drag_drop' && <div className="space-y-2"><p className="font-display font-bold text-sm">Placement feedback</p>{review?.items?.map((item) => (
        <div key={item.item} className={`rounded-xl border-2 p-3 text-sm ${item.correct ? 'border-clay-lime bg-clay-lime/15' : 'border-clay-coral bg-clay-coral/10'}`}>
          <p className="font-display font-bold">{item.item} · {item.correct ? 'Correct placement' : 'Try again'}</p>
          <p className="mt-1 text-xs">Your category: <b>{item.selected || 'No category selected'}</b></p>
          {!item.correct && <p className="mt-1">Correct category: <b>{item.correct_answer}</b></p>}
          <SolutionGuide item={item} correctAnswer={item.correct_answer} correct={item.correct} />
        </div>
      ))}</div>}
      {['true_false', 'multiple_choice'].includes(mission.formative_type) && reviewedScore < reviewedMax && <ClayButton color="sky" size="sm" className="w-full" onClick={beginRetry} disabled={retrying}>{retrying ? <Loader2 className="w-4 h-4 animate-spin" /> : <><RotateCcw className="w-4 h-4" /> Try a fresh variant</>}</ClayButton>}
      {submitError && <p className="rounded-lg bg-clay-coral/15 border-2 border-clay-coral/40 p-3 text-xs font-bold text-clay-coral">{submitError}</p>}
    </ClayCard>;
  }

  if (mission.formative_type === "drag_drop") return <div className="space-y-3">{formativeBrief}<DragDropMatch left={content.left || []} right={content.right || []} answers={{}} onSubmit={(res) => submit(res.placements || {})} submitting={submitting} error={submitError} /></div>;
  if (mission.formative_type === "fill_in_blank") return <div className="space-y-3">{formativeBrief}<FillInTheBlank questions={questions} answers={answers} onChange={setAnswers} onSubmit={submit} submitting={submitting} error={submitError} /></div>;

  const question = questions[questionIndex];
  const answeredCount = Object.keys(answers).length;
  const isLastQuestion = questionIndex === questions.length - 1;

  return <ClayCard className="p-4 space-y-4">
    {formativeBrief}
    <div className="flex items-center justify-between gap-3"><p className="font-display font-bold text-sm">{retryAttemptId ? 'Practice retry' : 'Score attempt'}</p><span className="text-xs font-mono text-ink/60">{answeredCount}/{questions.length} answered</span></div>
    {!retryAttemptId && <p className="-mt-2 text-[11px] text-ink/50">{draftRestored ? 'Your unfinished answers were restored on this device.' : 'Your unfinished answers are saved on this device.'}</p>}
    <div className="h-2 overflow-hidden rounded-full bg-ink/10"><div className="h-full rounded-full bg-clay-purple transition-all" style={{ width: `${((questionIndex + 1) / questions.length) * 100}%` }} /></div>
    {!showReview ? <>
      <div className="space-y-2"><p className="font-body text-sm">{questionIndex + 1}. {question.prompt}</p>
        {question.image_url && <MissionImage src={question.image_url} alt={`Visual for question ${questionIndex + 1}`} />}
        {mission.formative_type === "true_false" ? <div className="flex gap-2">{[true, false].map((value) => <button key={String(value)} type="button" onClick={() => setAnswers({ ...answers, [questionIndex]: value })} className={`clay-btn px-4 py-2 text-sm ${answers[questionIndex] === value ? (value ? "bg-clay-lime text-ink" : "bg-clay-coral text-white") : "bg-cream text-ink/60"}`}>{value ? 'True' : 'False'}</button>)}</div> : <div className="grid grid-cols-2 gap-2">{question.options?.map((option, optionIndex) => <button key={optionIndex} type="button" onClick={() => setAnswers({ ...answers, [questionIndex]: optionIndex })} className={`clay-btn min-h-12 w-full justify-start px-3 py-2 text-left text-sm ${answers[questionIndex] === optionIndex ? "bg-clay-purple text-white" : "bg-cream text-ink"}`}>{option}</button>)}</div>}</div>
      <div className="flex gap-2"><ClayButton color="cream" size="sm" onClick={() => setQuestionIndex((index) => Math.max(0, index - 1))} disabled={questionIndex === 0}>Back</ClayButton><ClayButton color="purple" size="sm" className="ml-auto" onClick={() => isLastQuestion ? setShowReview(true) : setQuestionIndex((index) => index + 1)} disabled={answers[questionIndex] === undefined}>{isLastQuestion ? 'Review answers' : 'Next question'}</ClayButton></div>
    </> : <div className="rounded-xl border-2 border-clay-purple/30 bg-clay-purple/10 p-3"><p className="font-display font-bold">Review every answer</p><p className="mt-1 text-xs text-ink/65">Tap any question to change it before submitting. Your score attempt is submitted once; feedback practice does not change XP.</p><div className="mt-3 space-y-2">{questions.map((reviewQuestion, index) => <button key={index} type="button" onClick={() => { setQuestionIndex(index); setShowReview(false); }} className="flex w-full items-center gap-3 rounded-lg border-2 border-ink/10 bg-white/80 p-2 text-left transition hover:border-clay-purple"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-clay-purple text-xs font-bold text-white">{index + 1}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{reviewQuestion.prompt}</span><span className="mt-0.5 block text-[11px] text-ink/60">Your answer: {displayAnswer(reviewQuestion, answers[index], mission.formative_type)}</span></span><span className="text-xs font-display font-bold text-clay-purple">Edit</span></button>)}</div><div className="mt-3 flex gap-2"><ClayButton color="cream" size="sm" onClick={() => setShowReview(false)}>Back to questions</ClayButton><ClayButton color="lime" size="sm" className="ml-auto" onClick={() => submit(answers)} disabled={submitting}>{submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Submit for secure grading'}</ClayButton></div></div>}
    {submitError && <p className="rounded-lg bg-clay-coral/15 border-2 border-clay-coral/40 p-3 text-xs font-bold text-clay-coral">{submitError}</p>}
  </ClayCard>;
}
