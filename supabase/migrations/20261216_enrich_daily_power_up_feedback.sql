-- Replace the original one-line Daily Power-Up bank feedback with a usable
-- review structure. Existing generated Power-Ups keep their question snapshot;
-- the client has a matching legacy guide for those. Every new Power-Up created
-- from this bank receives a concrete method and check from the outset.

update public.foundation_questions
set answer_explanation = case skill
  when 'Addition' then format('1. Add the quantities in the question: %s.\n2. Check your total against the answer choices. The correct total is %s.', question, correct_answer)
  when 'Subtraction' then format('1. Start with the larger amount and take away the amount after the minus sign: %s.\n2. Check the difference. The correct answer is %s.', question, correct_answer)
  when 'Multiplication' then format('1. Multiply the two factors shown in the question: %s.\n2. Check the product. The correct answer is %s.', question, correct_answer)
  when 'Division' then format('1. Divide the first quantity by the second quantity: %s.\n2. Check by multiplying the quotient back. The correct answer is %s.', question, correct_answer)
  when 'Integer Operations' then format('1. Keep the signs while working through: %s.\n2. Apply the integer sign rule and check that the result is %s.', question, correct_answer)
  when 'Decimals' then format('1. Line up decimal places before calculating: %s.\n2. Check the decimal point and value. The correct answer is %s.', question, correct_answer)
  when 'Fractions' then format('1. Identify whether the denominators already match in: %s.\n2. Combine the fractions correctly and simplify if needed. The correct answer is %s.', question, correct_answer)
  when 'Percent' then format('1. Change the percent in this question to a decimal, then multiply by the whole amount: %s.\n2. Check the result. The correct answer is %s.', question, correct_answer)
  when 'Ratio' then format('1. Find how the known part of the ratio changes in: %s.\n2. Multiply or divide both parts by the same factor. The correct answer is %s.', question, correct_answer)
  when 'Rate' then format('1. Use rate = quantity ÷ time for: %s.\n2. Include the correct unit. The correct answer is %s.', question, correct_answer)
  when 'Proportion' then format('1. Keep both ratios equivalent in: %s.\n2. Use the same scale factor or cross-multiply. The correct answer is %s.', question, correct_answer)
  when 'Measurement & Unit Conversion' then format('1. Write the unit conversion needed by: %s.\n2. Multiply or divide by the conversion factor. The correct answer is %s.', question, correct_answer)
  when 'Order of Operations' then format('1. Work in order: parentheses, exponents, multiplication/division, then addition/subtraction: %s.\n2. Check the final value. The correct answer is %s.', question, correct_answer)
  when 'Linear Equations' then format('1. Undo the number added or subtracted from x in: %s.\n2. Divide by the coefficient of x. The correct answer is %s.', question, correct_answer)
  when 'Linear Inequalities' then format('1. Isolate x by undoing the constant, then divide by its coefficient: %s.\n2. Keep the inequality direction unless multiplying or dividing by a negative. The correct answer is %s.', question, correct_answer)
  when 'Substitution' then format('1. Replace the variable with its given value in: %s.\n2. Calculate using the order of operations. The correct answer is %s.', question, correct_answer)
  when 'Variables' then format('1. Replace the variable with the value given in: %s.\n2. Calculate the expression. The correct answer is %s.', question, correct_answer)
  when 'Coordinate Plane' then format('1. Remember that an ordered pair is written (x, y): %s.\n2. Read the requested coordinate. The correct answer is %s.', question, correct_answer)
  when 'Patterns' then format('1. Compare nearby terms to find the pattern rule: %s.\n2. Use that same rule one more time. The correct answer is %s.', question, correct_answer)
  when 'Basic Geometry' then format('1. Choose the geometry rule needed by: %s.\n2. Substitute the given measurement and calculate. The correct answer is %s.', question, correct_answer)
  when 'Comparing & Ordering Numbers' then format('1. Compare the values from the greatest place value first: %s.\n2. Choose the symbol that makes the comparison true. The correct answer is %s.', question, correct_answer)
  when 'Place Value' then format('1. Locate the named digit in: %s.\n2. Use its place to find its value. The correct answer is %s.', question, correct_answer)
  when 'Number Sense' then format('1. Use the number clue in: %s.\n2. Check the rule before choosing. The correct answer is %s.', question, correct_answer)
  when 'Prime & Composite Numbers' then format('1. Check which whole numbers divide the number in: %s.\n2. A prime has exactly two factors; a composite has more. The correct answer is %s.', question, correct_answer)
  when 'Factors' then format('1. Test which choice divides the number in: %s with no remainder.\n2. The correct factor is %s.', question, correct_answer)
  when 'Multiples' then format('1. Check whether the choice can be made by multiplying the given number by a whole number: %s.\n2. The correct multiple is %s.', question, correct_answer)
  when 'GCF' then format('1. List the factors shared by both numbers in: %s.\n2. Choose the greatest shared factor. The correct answer is %s.', question, correct_answer)
  when 'LCM' then format('1. List multiples of both numbers in: %s.\n2. Choose the smallest multiple they share. The correct answer is %s.', question, correct_answer)
  when 'Algebraic Expressions' then format('1. Translate each phrase into an operation in: %s.\n2. Keep the variable attached to its coefficient. The correct answer is %s.', question, correct_answer)
  when 'Properties of Operations' then format('1. Compare the two sides of: %s.\n2. Identify the rule that explains the change. The correct answer is %s.', question, correct_answer)
  when 'Problem Solving' then format('1. Identify what changes in the situation: %s.\n2. Choose the operation that models it, then check. The correct answer is %s.', question, correct_answer)
  else format('1. Read the question carefully: %s.\n2. Apply the stated math rule and check the correct answer: %s.', question, correct_answer)
end,
student_feedback = format('Use the worked steps above. The key idea in this question is %s, and the checked answer is %s.', skill, correct_answer),
updated_at = now()
where review_status = 'APPROVED'
  and is_active;

-- SQL string literals above use a visible \n marker for readability; store an
-- actual line break so the student review renders the two steps separately.
update public.foundation_questions
set answer_explanation = replace(answer_explanation, '\n', chr(10)),
    updated_at = now()
where review_status = 'APPROVED'
  and is_active
  and answer_explanation like '%\n%';

-- A new Power-Up must never be created from the legacy one-line fallback.
do $$
declare v_remaining integer;
begin
  select count(*) into v_remaining
  from public.foundation_questions
  where review_status = 'APPROVED'
    and is_active
    and position(chr(10) || '2. ' in answer_explanation) = 0;
  if v_remaining > 0 then
    raise exception 'Daily Power-Up feedback enrichment incomplete: % approved questions still have no worked check', v_remaining;
  end if;
end;
$$;
